/**
 * Outer loop: propose scaffold edits via the think-first protocol.
 *
 * Every proposal must state mechanism (causal chain), expected_delta (a
 * number), and falsification (what result would disprove it) — encoded in
 * the tool schema, so a guess without a hypothesis cannot even be submitted.
 * Edits are bounded (<= lr atomic ops), the "text learning rate".
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { applyEdits, type Scaffold } from "../scaffold.js";
import { PiHarness, toolOutput } from "../piharness.js";

export const ANGLES = [
	"search strategy",
	"domain knowledge",
	"time and budget discipline",
	"robustness against bad data or edge cases",
	"method upgrade (better estimator)",
] as const;

export interface Proposal {
	edits: unknown[];
	mechanism: string;
	expectedDelta: string;
	falsification: string;
	angle: string;
	child: Scaffold;
}

export interface ProposeContext {
	historySummary: string;
	feedback: string;
	goalSteer: string;
	/** what the suite ACTUALLY contains (genres, task shapes) — proposals must
	 * target the real tasks, not a stale problem-type description */
	suiteSummary: string;
}

export async function propose(
	model: Model<any>,
	scaffold: Scaffold,
	angle: string,
	ctx: ProposeContext,
	timeoutMs = 240_000,
): Promise<Proposal | null> {
	const captured: { p?: { edits: unknown[]; mechanism: string; expected_delta: string; falsification: string } } = {};

	const proposeTool = defineTool({
		name: "propose_edits",
		label: "Propose edits",
		description: "Submit your scaffold improvement proposal. This is the only way to answer.",
		parameters: Type.Object({
			edits: Type.Array(
				Type.Union([
					Type.Object({
						op: Type.Literal("add_tip"),
						text: Type.String(),
						genres: Type.Optional(Type.Array(Type.String(), { description: "scope keys from the suite list; omit ONLY for universal discipline tips — cross-genre tips measured harmful" })),
					}),
					Type.Object({ op: Type.Literal("delete_tip"), index: Type.Integer() }),
					Type.Object({ op: Type.Literal("replace_tip"), index: Type.Integer(), text: Type.String() }),
					Type.Object({ op: Type.Literal("prompt_append"), text: Type.String() }),
					Type.Object({ op: Type.Literal("add_domain_tip"), genre: Type.String(), text: Type.String() }),
					Type.Object({ op: Type.Literal("set_eval_budget"), value: Type.Number() }),
				]),
				{ maxItems: 3, description: "1-3 atomic edits (text learning rate)" },
			),
			mechanism: Type.String({ description: "why these edits should raise private fitness (causal chain)" }),
			expected_delta: Type.String({ description: "numeric expectation, e.g. +0.05 mean fitness" }),
			falsification: Type.String({ description: "what result would disprove this proposal" }),
		}),
		execute: async (_id, params) => {
			captured.p = params;
			return toolOutput("proposal recorded");
		},
	});

	const scaffoldJson = JSON.stringify(
		{ system_prompt: scaffold.system_prompt, tips: scaffold.tips, domain_knowledge: scaffold.domain_knowledge, eval_budget_hint: scaffold.eval_budget_hint },
		null,
		1,
	);

	const prompt =
		`You are improving the strategy of an autonomous geoscience research agent.\n` +
		`THE SUITE THE AGENT IS SCORED ON (propose edits that target THESE tasks):\n${ctx.suiteSummary}\n` +
		`Fitness = mean private score over this suite, in [0,1].\n\n` +
		`CURRENT SCAFFOLD (JSON):\n${scaffoldJson}\n\n` +
		(ctx.historySummary ? `RECENT GENERATION RESULTS:\n${ctx.historySummary}\n\n` : "") +
		(ctx.goalSteer ? `GOAL STEERING:\n${ctx.goalSteer}\n\n` : "") +
		(ctx.feedback ? `OPERATOR FEEDBACK:\n${ctx.feedback}\n\n` : "") +
			`IMPROVEMENT ANGLE: ${angle}\n\n` +
			`Propose AT MOST 3 small, surgical edits via the propose_edits tool. ` +
			`Prefer replacing a weak tip over adding noise. Each tip must be under 30 words. ` +
			`Scope task-specific tips with genres (exact scope keys from the suite list above) — ` +
			`unscoped tips are injected into EVERY task and cross-genre transfer has measured negative.`;

	const harness = new PiHarness({
		model,
		thinkingLevel: "medium",
		cwd: process.cwd(),
		systemPrompt: "You are a precise research-engineering advisor. You always answer by calling the propose_edits tool exactly once.",
		customTools: [proposeTool],
		promptTimeoutMs: timeoutMs,
		stallMs: 120_000,
		builtinTools: [],
	});
	try {
		await harness.init();
		await harness.prompt(prompt);
	} finally {
		harness.dispose();
	}

	if (!captured.p || !captured.p.edits?.length) return null;
	const child = applyEdits(scaffold, captured.p.edits, 3);
	return {
		edits: captured.p.edits,
		mechanism: captured.p.mechanism,
		expectedDelta: captured.p.expected_delta,
		falsification: captured.p.falsification,
		angle,
		child,
	};
}
