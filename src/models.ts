/**
 * Unified model-calling layer: ONE place that knows each model's quirks.
 *
 * Single source of truth is config/model-profiles.json (probed 2026-08-25,
 * see docs/MODELS.md). Everything that varies per provider lives there:
 * reasoning parameter style, accepted levels, the dsv4f thinking_budget
 * mechanism, muse's Responses API, vision support. Callers ask in plain
 * terms ("level xhigh", "has image") and this layer translates or refuses.
 *
 * Used by PiHarness (thinkingLevel clamping before session creation),
 * provider (capability bits for models.json), and any direct-call script.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";

export type ThinkingLevel = "off" | "minimal" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ReasoningProfile {
	style: string;
	levels_accepted?: string[];
	levels_rejected?: string[];
	levels_accepted_trusted_history?: string[];
	quality_floor?: string;
	/** model rejects any request that disables reasoning */
	mandatory?: boolean;
	budget_param?: string;
	budget_verified_tokens?: number[];
	status?: string;
	note?: string;
}

export interface ModelProfile {
	endpoint: "zen" | "local";
	api_style: "chat-completions" | "responses";
	stability_class: string;
	vision_raw_api: boolean;
	reasoning: ReasoningProfile;
}

let cache: { version: string; models: Record<string, ModelProfile> } | null = null;

export function loadProfiles(): { version: string; models: Record<string, ModelProfile> } {
	if (cache) return cache;
	const p = join(ROOT, "config", "model-profiles.json");
	if (!existsSync(p)) throw new Error("config/model-profiles.json missing - the unified model layer has no data");
	cache = JSON.parse(readFileSync(p, "utf8"));
	return cache!;
}

export function getProfile(modelId: string): ModelProfile {
	const prof = loadProfiles().models[modelId];
	if (!prof) throw new Error(`no profile for model "${modelId}" in config/model-profiles.json`);
	return prof;
}

const LEVEL_ORDER = ["off", "minimal", "none", "low", "medium", "high", "xhigh", "max"];

/**
 * Translate a wanted thinking level into what THIS model actually accepts.
 * Returns the effective level plus any extra request body params (e.g.
 * dsv4f's thinking_budget) and a note when we had to clamp.
 */
export function resolveThinking(
	modelId: string,
	wanted: ThinkingLevel,
	opts: { budgetTokens?: number } = {},
): { level: ThinkingLevel; extraBody: Record<string, unknown>; clamped: boolean; note: string } {
	const prof = getProfile(modelId);
	const r = prof.reasoning;
	const out: { level: ThinkingLevel; extraBody: Record<string, unknown>; clamped: boolean; note: string } = {
		level: wanted,
		extraBody: {},
		clamped: false,
		note: "",
	};

	if (r.style === "none") {
		// muse: any reasoning parameter is a hard 400
		out.note = `${modelId}: reasoning parameters stripped (profile: none)`;
		return out;
	}

	let level = wanted;
	const accepted = new Set<string>([
		...(r.levels_accepted ?? []),
		...(r.levels_accepted_trusted_history ?? []),
	]);
	const rejected = new Set<string>(r.levels_rejected ?? []);

	if (accepted.size > 0 && !accepted.has(level)) {
		// clamp to nearest accepted level below/above by enum distance
		const ranked = LEVEL_ORDER.filter((l) => accepted.has(l));
		if (ranked.length === 0) {
			out.note = `${modelId}: no accepted levels known; passing "${wanted}" through unverified`;
			return out;
		}
		const wi = LEVEL_ORDER.indexOf(wanted);
		let bestLevel = ranked[0];
		let bestDist = Number.MAX_SAFE_INTEGER;
		for (const l of ranked) {
			const d = Math.abs(LEVEL_ORDER.indexOf(l) - wi);
			if (d < bestDist || (d === bestDist && LEVEL_ORDER.indexOf(l) < wi)) {
				bestDist = d;
				bestLevel = l;
			}
		}
		// quality floor beats proximity: never go below it even if nearer
		const floor = r.quality_floor;
		const floorIdx = floor ? LEVEL_ORDER.indexOf(floor) : -1;
		if (floor && floorIdx >= 0 && LEVEL_ORDER.indexOf(bestLevel) < floorIdx && wi >= floorIdx) {
			bestLevel = floor;
		}
		out.level = bestLevel as ThinkingLevel;
		out.clamped = true;
		out.note = `${modelId}: "${wanted}" not accepted -> clamped to "${out.level}"`;
		level = out.level;
	} else if (rejected.has(level)) {
		// explicit rejection list without an accept list: fall back to medium
		out.level = "medium";
		out.clamped = true;
		out.note = `${modelId}: "${wanted}" explicitly rejected -> using "medium"`;
		level = out.level;
	}

	// dsv4f-style deep-thinking mechanism: real max comes from a token budget,
	// not an effort word
	if (r.budget_param && (level === "xhigh" || level === "max" || opts.budgetTokens)) {
		const tokens = opts.budgetTokens ?? (level === "max" ? 32768 : 16384);
		out.extraBody[r.budget_param] = tokens;
		out.note = `${modelId}: deep thinking via ${r.budget_param}=${tokens}`;
	}

	if ((r.style === "reasoning_effort" || r.style === "effort_plus_budget") && !out.extraBody[r.budget_param ?? ""]) {
		out.extraBody["reasoning_effort"] = level;
	}
	return out;
}

/** Gate image inputs on raw-API support (harness wiring is separate and still text-only everywhere). */
export function assertVisionAllowed(modelId: string, wantsImage: boolean): void {
	if (!wantsImage) return;
	if (!getProfile(modelId).vision_raw_api) {
		throw new Error(`model "${modelId}" does not support image input (see docs/MODELS.md)`);
	}
}

/** Retry/backoff policy derived from stability class + observed transient kinds. */
export function retryPlan(modelId: string): { retries: number; backoffMs: number[] } {
	const cls = getProfile(modelId).stability_class;
	if (cls.startsWith("C")) return { retries: 5, backoffMs: [2000, 5000, 10000, 20000, 30000] };
	if (cls.startsWith("B") || cls.startsWith("D")) return { retries: 5, backoffMs: [2000, 5000, 15000, 30000, 30000] };
	return { retries: 4, backoffMs: [2000, 5000, 10000, 15000] };
}
