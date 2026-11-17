/**
 * Run budget planning and live modulation (pure — no I/O, no provider imports).
 *
 * Three layers, one lesson (#16): the model must SEE budgets to respect them, but only
 * code may enforce them.
 *
 *  1. PLAN-TIME FIXED VALUES — `planNodeBudget` designs a differentiated envelope per node
 *     kind when the graph is planned. These fixed values are the guaranteed floor: a node
 *     can always do its minimum job with its planned envelope, whatever happens globally.
 *  2. RUN-LEVEL LEDGER — the engine tracks actual usage (model calls, tool calls, tokens,
 *     wall) against the planned envelopes; `runBudgetView` snapshots the global picture.
 *  3. EXECUTION-TIME MODULATION — when nodes to date have overrun their planned share,
 *     `modulateNodeBudget` TIGHTENS the current node's discovery budget (tools + wall,
 *     never model/output), never below 50% of plan, never for communication kinds — so
 *     later nodes still get their share. Missing data ⇒ no modulation ⇒ full plan (the
 *     fixed value is the failure mode).
 */
import type { WorkNode, WorkNodeBudget, WorkNodeKind } from "./contracts.js";
import { DEV_NODE_BUDGET } from "./graph-spec.js";

/** Multipliers per node kind against the DEV base. Discovery-heavy kinds earn tool calls
 * and wall; planning kinds are trimmed; communication keeps its ×2. */
const PLAN_WEIGHTS: Partial<Record<WorkNodeKind, { wall?: number; model?: number; tools?: number; output?: number }>> = {
	"frame-question": { wall: 0.5, model: 0.75, tools: 0.5, output: 0.5 },
	"value-assessment": { wall: 0.5, model: 0.75, tools: 0.5, output: 0.5 },
	hypothesis: { wall: 0.5, model: 0.75, tools: 0.5, output: 0.5 },
	"data-acquisition": { wall: 1.25, model: 1, tools: 1.5, output: 0.5 },
	"data-audit": { wall: 1, model: 0.75, tools: 1, output: 0.75 },
	// wall ×2 measured: on the alsl gateway one large turn runs 2–4 minutes, and the closing
	// sequence (recall prior evidence → write verifier JSON → submit) alone needs 10–15 min.
	// output ×1.5 measured: the closing move (writing the verifier catalogue via a python
	// resultFile script) is itself a multi-thousand-token generation; a 45k aggregate once
	// truncated every turn into a 58k monologue that voided the whole session.
	"literature-search": { wall: 2, model: 1, tools: 1.5, output: 1.5 },
	"quantitative-analysis": { wall: 1.25, model: 1, tools: 1.25, output: 1 },
	"gis-analysis": { wall: 1.25, model: 1, tools: 1.25, output: 1 },
	sensitivity: { wall: 1.25, model: 1, tools: 1.25, output: 1 },
	verification: { wall: 1, model: 0.75, tools: 1, output: 0.75 },
	synthesis: { wall: 1, model: 1, tools: 0.75, output: 1.25 },
	report: { wall: 2, model: 2, tools: 2, output: 2 },
	presentation: { wall: 1.5, model: 1.5, tools: 1.5, output: 1.5 },
	defense: { wall: 1, model: 1, tools: 1, output: 1 },
};

/** Absolute floors so no envelope modulates into uselessness. */
const BUDGET_FLOORS = { wallMs: 5 * 60 * 1000, maxModelCalls: 6, maxToolCalls: 8, maxOutputTokens: 8_000 };
/** A retry's closing moves (recall prior evidence → write verifier input → submit) need
 * about five model turns (recall → write JSON → submit → one fix → resubmit); measured on
 * the alsl gateway that is ~15 minutes, not 5. */
const CARRY_WALL_FLOOR_MS = 15 * 60 * 1000;

const clampBudget = (budget: WorkNodeBudget): WorkNodeBudget => ({
	wallMs: Math.max(BUDGET_FLOORS.wallMs, Math.round(budget.wallMs)),
	maxModelCalls: Math.max(BUDGET_FLOORS.maxModelCalls, Math.round(budget.maxModelCalls)),
	maxToolCalls: Math.max(BUDGET_FLOORS.maxToolCalls, Math.round(budget.maxToolCalls)),
	maxOutputTokens: Math.max(BUDGET_FLOORS.maxOutputTokens, Math.round(budget.maxOutputTokens)),
	maxAttempts: budget.maxAttempts,
});

/** Plan-time fixed envelope for one node kind (the 固定值). `report` keeps the historical
 * ×2 communication scale. Weights above DEV_NODE_BUDGET are designed, not learned. */
export function planNodeBudget(kind: WorkNodeKind, base: WorkNodeBudget = DEV_NODE_BUDGET): WorkNodeBudget {
	const weight = PLAN_WEIGHTS[kind] ?? {};
	return clampBudget({
		wallMs: base.wallMs * (weight.wall ?? 1),
		maxModelCalls: base.maxModelCalls * (weight.model ?? 1),
		maxToolCalls: base.maxToolCalls * (weight.tools ?? 1),
		maxOutputTokens: base.maxOutputTokens * (weight.output ?? 1),
		maxAttempts: base.maxAttempts,
	});
}

export interface RunBudgetUsage {
	modelCalls: number;
	toolCalls: number;
	outputTokens: number;
	wallMs: number;
}

const TERMINAL_OR_RAN = new Set(["completed", "failed", "running", "verifying", "blocked"]);

/** Sum of planned envelopes over the given nodes. */
export function plannedUsage(nodes: readonly { budget: WorkNodeBudget; state?: string }[]): RunBudgetUsage {
	let modelCalls = 0;
	let toolCalls = 0;
	let outputTokens = 0;
	let wallMs = 0;
	for (const node of nodes) {
		modelCalls += node.budget.maxModelCalls;
		toolCalls += node.budget.maxToolCalls;
		outputTokens += node.budget.maxOutputTokens;
		wallMs += node.budget.wallMs;
	}
	return { modelCalls, toolCalls, outputTokens, wallMs };
}

/** The live global picture one node sees while it executes. Supplied by the engine. */
export interface RunBudgetView {
	/** Actual run-to-date usage (including this node's spend so far). */
	usage: RunBudgetUsage;
	/** What EARLIER attempts of this very node already spent of its planned envelope. */
	nodeUsed?: RunBudgetUsage;
	/** Planned envelopes of every node not yet completed — this node's share included. */
	plannedRemaining: RunBudgetUsage;
	/** Downstream work in plan order: what still needs budget after/around this node. */
	remainingNodes: Array<{ id: string; kind: string; state: string; plannedToolCalls: number; plannedWallMinutes: number }>;
	/** Tool-call overrun of nodes that already ran (used ÷ planned); null when unknown. */
	pressure: { overrun: number | null };
}

/** Communication kinds are protected from tightening: the run's verdict is written here,
 * and a starved report is a lost run (#39). */
const PROTECTED_KINDS = new Set(["synthesis", "report", "presentation", "defense"]);

export interface BudgetModulation {
	budget: WorkNodeBudget;
	note: string;
}

/** Execution-time modulation: tighten-only, floor 50%, protected kinds untouched, and no
 * data ⇒ null ⇒ the full planned envelope (the fixed value IS the fallback). */
export function modulateNodeBudget(baseline: WorkNodeBudget, kind: string, overrun: number | null): BudgetModulation | null {
	if (overrun === null || !Number.isFinite(overrun) || overrun <= 1.25) return null;
	if (PROTECTED_KINDS.has(kind)) return null;
	const factor = Math.max(0.5, Math.min(1, 1 / overrun));
	const tightened = clampBudget({ ...baseline, maxToolCalls: baseline.maxToolCalls * factor, wallMs: baseline.wallMs * factor });
	if (tightened.maxToolCalls >= baseline.maxToolCalls && tightened.wallMs >= baseline.wallMs) return null;
	return {
		budget: tightened,
		note: `run budget pressure ×${overrun.toFixed(2)} (nodes to date used more than their planned share) — this node's discovery budget is tightened to ${Math.round(factor * 100)}% of plan; finish with the minimum sufficient evidence and leave room for the nodes after you`,
	};
}

/** Model-readable brief injected into the node prompt: own envelope + global ledger +
 * the downstream queue, so the node can pace itself against what is still to come. */
export function runBudgetBrief(budget: WorkNodeBudget, view: RunBudgetView | null, modulationNote: string | null): string {
	const own = `this node's envelope is ${budget.maxToolCalls} tool calls / ${budget.maxModelCalls} model calls / ${Math.round(budget.wallMs / 60_000)} minutes wall${modulationNote ? ` — ${modulationNote}` : ""}`;
	if (!view) return own;
	const downstream = view.remainingNodes.filter((node) => node.state !== "completed");
	const queue = downstream.slice(0, 8).map((node) => `${node.id} [${node.kind}] ${node.plannedToolCalls} calls/${node.plannedWallMinutes}min`).join("; ");
	return [
		own,
		`run to date: ${view.usage.toolCalls}/${view.usage.modelCalls} tool/model calls, ${Math.round(view.usage.outputTokens / 1000)}k tokens, ${Math.round(view.usage.wallMs / 60_000)} min wall`,
		`still to do after this node: ${downstream.length} node(s) planning ~${view.plannedRemaining.toolCalls} tool calls total${queue ? ` (${queue})` : ""}`,
		"Spend only your share — the nodes after you still need theirs; an overrun here tightens THEIR budgets.",
	].join(".\n");
}

/**
 * Attempt carry-over (pitfall meta-lesson #3: a budget that resets per attempt lives in the
 * wrong layer — a 2-attempt node quietly doubled its fixed value). A retry inherits what the
 * planned envelope has left after earlier attempts: tool calls, model calls and wall are
 * deducted; output tokens are NOT, because a retry still has to emit its full deliverable.
 * Floors (25% of plan, never below the closing minimum) keep the retry able to close out.
 */
export function carryNodeBudgetAcrossAttempts(baseline: WorkNodeBudget, used: RunBudgetUsage | null | undefined): BudgetModulation | null {
	if (!used || (used.toolCalls <= 0 && used.modelCalls <= 0 && used.wallMs <= 0)) return null;
	const floor = (planned: number, absolute: number): number => Math.max(absolute, Math.round(planned * 0.25));
	const budget: WorkNodeBudget = {
		wallMs: Math.max(floor(baseline.wallMs, CARRY_WALL_FLOOR_MS), Math.round(baseline.wallMs - used.wallMs)),
		maxModelCalls: Math.max(floor(baseline.maxModelCalls, BUDGET_FLOORS.maxModelCalls), Math.round(baseline.maxModelCalls - used.modelCalls)),
		maxToolCalls: Math.max(floor(baseline.maxToolCalls, 12), Math.round(baseline.maxToolCalls - used.toolCalls)),
		maxOutputTokens: baseline.maxOutputTokens,
		maxAttempts: baseline.maxAttempts,
	};
	if (budget.wallMs >= baseline.wallMs && budget.maxModelCalls >= baseline.maxModelCalls && budget.maxToolCalls >= baseline.maxToolCalls) return null;
	return {
		budget,
		note: `earlier attempts of this node already spent ${used.toolCalls} tool calls / ${used.modelCalls} model calls / ${Math.round(used.wallMs / 60_000)} min of its planned envelope — ${budget.maxToolCalls} tool calls and ${Math.round(budget.wallMs / 60_000)} min remain (floored so you can still close out). Do NOT repeat earlier discovery: its evidence is already registered (context-recall lists it) — write the verifier input from it and submit`,
	};
}

/** Fold the run ledger into per-node cumulative usage across attempts: tool receipts,
 * model receipts (+ output tokens) and the wall time of every attempt that ended. */
export function foldNodeUsage(events: readonly { type: string; nodeId?: string; timestamp: string; payload?: unknown }[]): Map<string, RunBudgetUsage> {
	const usage = new Map<string, RunBudgetUsage>();
	const started = new Map<string, number>();
	const entry = (nodeId: string): RunBudgetUsage => { const found = usage.get(nodeId); if (found) return found; const fresh = { modelCalls: 0, toolCalls: 0, outputTokens: 0, wallMs: 0 }; usage.set(nodeId, fresh); return fresh; };
	for (const event of events) {
		if (!event.nodeId) continue;
		const at = Date.parse(event.timestamp);
		if (event.type === "scientific-tool-receipt") { if (((event.payload ?? {}) as { toolId?: unknown }).toolId !== "context-recall") entry(event.nodeId).toolCalls += 1; }
		else if (event.type === "model-call-receipt") {
			const payload = (event.payload ?? {}) as { output?: unknown };
			const item = entry(event.nodeId);
			item.modelCalls += 1;
			if (typeof payload.output === "number" && Number.isFinite(payload.output) && payload.output > 0) item.outputTokens += payload.output;
		} else if (event.type === "node-start") { if (Number.isFinite(at)) started.set(event.nodeId, at); }
		else if (event.type === "node-failed" || event.type === "node-verification-failed" || event.type === "node-blocked" || event.type === "node-completed") {
			const from = started.get(event.nodeId);
			if (from !== undefined && Number.isFinite(at)) { entry(event.nodeId).wallMs += Math.max(0, at - from); started.delete(event.nodeId); }
		}
	}
	return usage;
}
