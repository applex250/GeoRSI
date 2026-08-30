/**
 * Critique panel: cheap LLM review BEFORE spending episode compute.
 *
 * Each critic scores every proposal (quality 0-10 + keep vote) given the
 * champion scaffold and prior attempts. Survival rule: mean quality >= 6 and
 * keep votes from at least half the critics. If everything dies, the single
 * highest-scored proposal is salvaged so a generation never runs empty.
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { Proposal } from "./improve.js";
import type { ConfigThinkingLevel } from "../config.js";
import { PiHarness, toolOutput } from "../piharness.js";

export interface CritiqueOutcome {
	survivors: Proposal[];
	scores: { index: number; quality: number; keepVotes: number }[];
}

export function selectTopSurvivors(
	proposals: readonly Proposal[],
	survivors: readonly Proposal[],
	scores: readonly { index: number; quality: number; keepVotes: number }[],
	limit: number,
): Proposal[] {
	return [...survivors]
		.sort((left, right) => {
			const leftScore = scores[proposals.indexOf(left)]?.quality ?? 0;
			const rightScore = scores[proposals.indexOf(right)]?.quality ?? 0;
			return rightScore - leftScore;
		})
		.slice(0, Math.max(1, Math.floor(limit)));
}

export async function critiquePanel(
	model: Model<any>,
	proposals: Proposal[],
	championSummary: string,
	attemptsSummary: string,
	nCritics: number,
	timeoutMs = 150_000,
	thinkingLevel: ConfigThinkingLevel = "low",
): Promise<CritiqueOutcome> {
	const C = Math.max(1, nCritics);
	const qualities: number[][] = Array.from({ length: proposals.length }, () => []);
	const keeps: boolean[][] = Array.from({ length: proposals.length }, () => []);

	const scoreTool = defineTool({
		name: "score_proposals",
		label: "Score proposals",
		description: "Record your review of every proposal. This is the only way to answer.",
		parameters: Type.Object({
			scores: Type.Array(
				Type.Object({
					index: Type.Integer({ description: "proposal index, 1-based as listed" }),
					quality: Type.Number({ minimum: 0, maximum: 10, description: "0-10 expected value" }),
					keep: Type.Boolean({ description: "worth spending an evaluation episode on?" }),
					reason: Type.Optional(Type.String()),
				}),
				{ minItems: 1 },
			),
		}),
		execute: async (_id, params) => {
			for (const s of params.scores) {
				const i = s.index - 1;
				if (i >= 0 && i < proposals.length) {
					qualities[i].push(s.quality);
					keeps[i].push(s.keep);
				}
			}
			return toolOutput("scores recorded");
		},
	});

	const listing = proposals
		.map(
			(p, i) =>
				`[${i + 1}] angle=${p.angle}\n    edits: ${JSON.stringify(p.edits)}\n` +
				`    mechanism: ${p.mechanism}\n    expected: ${p.expectedDelta}\n    falsification: ${p.falsification}`,
		)
		.join("\n");

	const prompt =
		`Champion scaffold:\n${championSummary}\n\n` +
		`Previously tried this run (do not repeat):\n${attemptsSummary || "(none yet)"}\n\n` +
		`PROPOSALS:\n${listing}\n\n` +
		`Score each proposal 0-10 for expected fitness gain (deduct for redundancy with existing tips, ` +
		`vagueness, unfalsifiable mechanism, or rehashing a failed attempt). keep=true only if it deserves ` +
		`an evaluation episode. Answer via score_proposals.`;

	await Promise.all(
		Array.from({ length: C }, () =>
			(async () => {
				const harness = new PiHarness({
					model,
					thinkingLevel,
					cwd: process.cwd(),
					systemPrompt: "You are a harsh but fair review panelist. You always answer by calling score_proposals exactly once.",
					customTools: [scoreTool],
					promptTimeoutMs: timeoutMs,
					stallMs: 90_000,
					builtinTools: [],
				});
				try {
					await harness.init();
					await harness.prompt(prompt);
				} catch {
					// A critic is advisory. Missing/failed panel votes become zero
					// quality; the deterministic fallback still evaluates a proposal.
				} finally {
					harness.dispose();
				}
			})(),
		),
	);

	const scores = proposals.map((_, i) => {
		const q = qualities[i];
		const meanQ = q.length ? q.reduce((a, b) => a + b, 0) / q.length : 0;
		const keepVotes = keeps[i].filter(Boolean).length;
		return { index: i, quality: meanQ, keepVotes };
	});

	const survivors = proposals.filter((_, i) => {
		const s = scores[i]!;
		return s.quality >= 6 && s.keepVotes * 2 >= C;
	});

	if (survivors.length === 0) {
		// Never turn a transient critic outage into a silently wasted generation.
		// The fallback is still evaluated by the real public/private protocol.
		const best = scores.reduce((a, b) => (b.quality > a.quality ? b : a), scores[0]!);
		if (best) survivors.push(proposals[best.index]!);
	}

	return { survivors, scores };
}
