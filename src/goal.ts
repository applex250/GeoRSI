/**
 * Goal gating: long-horizon planning guardrails for a run that may last days.
 *
 * At gen 0 the outer model writes 3-5 gating criteria (atomic, observable,
 * anchored to the run goal). Each generation a checker fuses a deterministic
 * trend verdict (is fitness actually improving?) with an LLM verdict — either
 * saying on-track counts — and produces a steer text that feeds the next
 * round of proposals. LLM failures degrade to the deterministic verdict, so
 * this subsystem can never block the loop.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ConfigThinkingLevel } from "./config.js";
import { PiHarness, toolOutput } from "./piharness.js";

export interface GoalPlan {
	goal: string;
	criteria: string[];
}

const FALLBACK_CRITERIA = [
	"mean private fitness over the training suite improves across generations",
	"accepted champions generalize: held-out fitness within 0.15 of training fitness",
	"no generation passes without a mechanically-justified proposal",
];

export async function makeGoalPlan(
	model: Model<any>,
	goalText: string,
	timeoutMs = 150_000,
	thinkingLevel: ConfigThinkingLevel = "low",
): Promise<GoalPlan> {
	const captured: { p?: { criteria: string[] } } = {};
	const planTool = defineTool({
		name: "set_criteria",
		label: "Set gating criteria",
		description: "Record 3-5 gating criteria. This is the only way to answer.",
		parameters: Type.Object({
			criteria: Type.Array(Type.String(), { minItems: 3, maxItems: 5 }),
		}),
		execute: async (_id, params) => {
			captured.p = params;
			return toolOutput("criteria recorded");
		},
	});
	const harness = new PiHarness({
		model,
		thinkingLevel,
		cwd: process.cwd(),
		systemPrompt: "You write run-gating criteria. You always answer by calling set_criteria exactly once.",
		customTools: [planTool],
		promptTimeoutMs: timeoutMs,
		stallMs: 90_000,
		builtinTools: [],
	});
	try {
		await harness.init();
		await harness.prompt(
			`RUN GOAL: ${goalText}\n\n` +
				`Write 3-5 gating criteria for a multi-day self-improvement run. Each must be atomic, ` +
				`observable from run artifacts (fitness numbers, journal), and anchored to the goal. ` +
				`Answer via set_criteria.`,
		);
	} finally {
		harness.dispose();
	}
	const criteria = captured.p?.criteria?.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim()) ?? [];
	return { goal: goalText, criteria: criteria.length >= 3 ? criteria.slice(0, 5) : FALLBACK_CRITERIA };
}

export interface GoalVerdict {
	onTrack: boolean;
	steer: string;
	source: "deterministic" | "llm" | "fused";
}

/** Deterministic trend prior: improving over the recent window? */
export function deterministicTrend(fitnessHistory: number[], window = 4): boolean {
	if (fitnessHistory.length < 2) return true;
	const w = fitnessHistory.slice(-window);
	let up = 0;
	for (let i = 1; i < w.length; i++) if (w[i] > w[i - 1]) up += 1;
	return up >= Math.floor((w.length - 1) / 2);
}

export async function checkGoal(
	model: Model<any>,
	plan: GoalPlan,
	fitnessHistory: number[],
	recentSummary: string,
	timeoutMs = 150_000,
	thinkingLevel: ConfigThinkingLevel = "low",
): Promise<GoalVerdict> {
	const det = deterministicTrend(fitnessHistory);
	const captured: { p?: { on_track: boolean; steer: string } } = {};
	const checkTool = defineTool({
		name: "goal_verdict",
		label: "Goal verdict",
		description: "Record the goal check. This is the only way to answer.",
		parameters: Type.Object({
			on_track: Type.Boolean(),
			steer: Type.String({ description: "one concrete instruction for the next generation's proposals" }),
		}),
		execute: async (_id, params) => {
			captured.p = params;
			return toolOutput("verdict recorded");
		},
	});
	const harness = new PiHarness({
		model,
		thinkingLevel,
		cwd: process.cwd(),
		systemPrompt: "You are a run supervisor. You always answer by calling goal_verdict exactly once.",
		customTools: [checkTool],
		promptTimeoutMs: timeoutMs,
		stallMs: 90_000,
		builtinTools: [],
	});
	try {
		await harness.init();
		await harness.prompt(
			`GOAL: ${plan.goal}\nCRITERIA:\n${plan.criteria.map((c) => `- ${c}`).join("\n")}\n\n` +
				`FITNESS HISTORY (chronological): [${fitnessHistory.map((f) => f.toFixed(3)).join(", ")}]\n` +
				`DETERMINISTIC TREND SAYS: ${det ? "on track" : "stalling"}\n\n` +
				`RECENT EVENTS:\n${recentSummary}\n\n` +
				`Judge whether the run is meeting its criteria and write one concrete steer for the next ` +
				`generation. Answer via goal_verdict.`,
		);
	} finally {
		harness.dispose();
	}
	if (!captured.p) {
		return { onTrack: det, steer: det ? "" : "variance is high: favor robust, validated methods over novelty", source: "deterministic" };
	}
	return {
		onTrack: det || captured.p.on_track,
		steer: captured.p.steer?.slice(0, 500) ?? "",
		source: det && captured.p.on_track ? "fused" : "llm",
	};
}

/** Human-in-the-loop: runs/<name>/FEEDBACK.md is re-read every generation. */
export function readFeedback(runDir: string): string {
	const p = join(runDir, "FEEDBACK.md");
	if (!existsSync(p)) return "";
	try {
		return readFileSync(p, "utf8").trim().slice(0, 4000);
	} catch {
		return "";
	}
}
