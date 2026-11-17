/**
 * Budget report (pure): the frontend's view of the three-layer budget system.
 *
 * Joins the plan-time fixed envelopes (plan.json `node.budget`) with the run ledger's
 * per-node `model-call-receipt` / `scientific-tool-receipt` events into
 * planned-vs-used figures per node and for the whole run, plus the same pressure
 * figure the engine uses to tighten downstream nodes. Never throws on partial data:
 * a run that has not planned yet reports zero planned, and unknown dimensions stay 0.
 */
import type { ResearchWorkGraph } from "./contracts.js";
import type { ResearchEvent } from "./event-ledger.js";

export interface BudgetFigures {
	toolCalls: number;
	modelCalls: number;
	outputTokens: number;
	wallMs: number;
}

export interface NodeBudgetReport {
	id: string;
	kind: string;
	title: string;
	state: string;
	attempts: number;
	/** Plan-time fixed value (the floor). */
	planned: BudgetFigures;
	used: BudgetFigures & { totalTokens: number; cachedTokens: number };
	/** used ÷ planned per dimension; null when nothing was planned. */
	ratios: { toolCalls: number | null; modelCalls: number | null; outputTokens: number | null; wallMs: number | null };
	/** Worst dimension bucketed for display: ok < 0.6 ≤ warn < 0.85 ≤ over. */
	level: "ok" | "warn" | "over";
}

export interface RunBudgetReport {
	planned: BudgetFigures;
	used: BudgetFigures & { totalTokens: number; cachedTokens: number };
	/** Planned envelopes of nodes that have not completed yet. */
	remaining: BudgetFigures;
	/** Model spend outside any graph node (classifier, per-round reviews). */
	overhead: { modelCalls: number; totalTokens: number };
	/** Engine pressure formula: tool receipts of nodes that ran ÷ their planned tool calls. */
	pressure: { overrun: number | null; tightening: boolean };
	nodes: NodeBudgetReport[];
	nodesRemaining: number;
}

const RAN_STATES = new Set(["completed", "failed", "running", "verifying", "blocked"]);

function ratio(used: number, planned: number): number | null {
	return planned > 0 ? used / planned : null;
}

function level(ratios: NodeBudgetReport["ratios"]): NodeBudgetReport["level"] {
	const worst = Math.max(...Object.values(ratios).map((value) => value ?? 0));
	return worst >= 0.85 ? "over" : worst >= 0.6 ? "warn" : "ok";
}

function number(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function buildBudgetReport(input: { plan: ResearchWorkGraph | null; events: readonly ResearchEvent[]; nowMs: number }): RunBudgetReport {
	const nodes = input.plan?.nodes ?? [];
	const known = new Set(nodes.map((node) => node.id));
	const perNode = new Map<string, { toolCalls: number; modelCalls: number; outputTokens: number; totalTokens: number; cachedTokens: number; first?: number; last?: number }>();
	const overhead = { modelCalls: 0, totalTokens: 0 };
	let runToolCalls = 0;
	for (const event of input.events) {
		if (event.type !== "scientific-tool-receipt" && event.type !== "model-call-receipt") continue;
		const payload = (event.payload ?? {}) as Record<string, unknown>;
		// context-recall is exempt from tool budgets everywhere (local memory read).
		if (event.type === "scientific-tool-receipt" && payload.toolId === "context-recall") continue;
		if (event.type === "scientific-tool-receipt") runToolCalls += 1;
		if (!event.nodeId || !known.has(event.nodeId)) {
			if (event.type === "model-call-receipt") { overhead.modelCalls += 1; overhead.totalTokens += number(payload.total); }
			continue;
		}
		const entry = perNode.get(event.nodeId) ?? { toolCalls: 0, modelCalls: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 };
		const at = Date.parse(event.timestamp);
		if (Number.isFinite(at)) { entry.first = entry.first === undefined ? at : Math.min(entry.first, at); entry.last = entry.last === undefined ? at : Math.max(entry.last, at); }
		if (event.type === "scientific-tool-receipt") entry.toolCalls += 1;
		else { entry.modelCalls += 1; entry.outputTokens += number(payload.output); entry.totalTokens += number(payload.total); entry.cachedTokens += number(payload.cached); }
		perNode.set(event.nodeId, entry);
	}

	const reports: NodeBudgetReport[] = nodes.map((node) => {
		const entry = perNode.get(node.id) ?? { toolCalls: 0, modelCalls: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 };
		const started = node.startedAt ? Date.parse(node.startedAt) : entry.first;
		const ended = node.completedAt ? Date.parse(node.completedAt) : node.state === "running" || node.state === "verifying" ? input.nowMs : entry.last;
		const wallMs = started !== undefined && ended !== undefined && Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
		const planned: BudgetFigures = { toolCalls: node.budget.maxToolCalls, modelCalls: node.budget.maxModelCalls, outputTokens: node.budget.maxOutputTokens, wallMs: node.budget.wallMs };
		const used = { toolCalls: entry.toolCalls, modelCalls: entry.modelCalls, outputTokens: entry.outputTokens, wallMs, totalTokens: entry.totalTokens, cachedTokens: entry.cachedTokens };
		const ratios = { toolCalls: ratio(used.toolCalls, planned.toolCalls), modelCalls: ratio(used.modelCalls, planned.modelCalls), outputTokens: ratio(used.outputTokens, planned.outputTokens), wallMs: ratio(used.wallMs, planned.wallMs) };
		return { id: node.id, kind: node.kind, title: node.title, state: node.state, attempts: node.attempts, planned, used, ratios, level: level(ratios) };
	});

	const sum = (items: readonly NodeBudgetReport[], pick: (item: NodeBudgetReport) => BudgetFigures): BudgetFigures => items.reduce<BudgetFigures>((acc, item) => {
		const figures = pick(item);
		return { toolCalls: acc.toolCalls + figures.toolCalls, modelCalls: acc.modelCalls + figures.modelCalls, outputTokens: acc.outputTokens + figures.outputTokens, wallMs: acc.wallMs + figures.wallMs };
	}, { toolCalls: 0, modelCalls: 0, outputTokens: 0, wallMs: 0 });

	const planned = sum(reports, (item) => item.planned);
	const usedNodes = sum(reports, (item) => item.used);
	const remainingNodes = reports.filter((item) => item.state !== "completed");
	const ran = reports.filter((item) => RAN_STATES.has(item.state));
	const plannedRanTools = ran.reduce((acc, item) => acc + item.planned.toolCalls, 0);
	const usedRanTools = ran.reduce((acc, item) => acc + item.used.toolCalls, 0);
	const overrun = plannedRanTools > 0 ? usedRanTools / plannedRanTools : null;
	return {
		planned,
		used: {
			toolCalls: runToolCalls,
			modelCalls: usedNodes.modelCalls + overhead.modelCalls,
			outputTokens: usedNodes.outputTokens,
			wallMs: usedNodes.wallMs,
			totalTokens: reports.reduce((acc, item) => acc + item.used.totalTokens, 0) + overhead.totalTokens,
			cachedTokens: reports.reduce((acc, item) => acc + item.used.cachedTokens, 0),
		},
		remaining: sum(remainingNodes, (item) => item.planned),
		overhead,
		pressure: { overrun, tightening: overrun !== null && overrun > 1.25 },
		nodes: reports,
		nodesRemaining: remainingNodes.length,
	};
}
