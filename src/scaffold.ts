/**
 * Scaffold-as-data: the ONLY artifact the outer loop evolves.
 *
 * A scaffold is plain JSON (system prompt + strategy tips + per-genre domain
 * notes). Evolving data instead of code removes any compile/injection
 * surface: an LLM proposal either applies cleanly or is rejected, and any
 * model can safely rewrite it. (Pattern proven by OpenRSI_self.)
 */

export interface Scaffold {
	system_prompt: string;
	tips: string[];
	/** optional domain notes keyed by problem genre, injected when matching */
	domain_knowledge: Record<string, string[]>;
	/** soft hint for how many public submissions the agent may spend */
	eval_budget_hint: number;
	generation: number;
}

export const SEED_SCAFFOLD: Scaffold = {
	system_prompt: [
		"You are a careful quantitative geoscience researcher working in a scratch workspace.",
		"Method:",
		"1. Think before coding: state what you know, what quantity you must estimate, and the standard method for it.",
		"2. Write analysis scripts to files (write tool) and execute them (run_python tool); inspect real output before concluding.",
		"3. Validate your full pipeline on the provided reference dataset whose truth is public before trusting it on the main dataset.",
		"4. Never report a number you did not compute in executed code.",
		"5. Finish by calling the submit tool with your final answer.",
	].join("\n"),
	tips: [],
	domain_knowledge: {},
	eval_budget_hint: 4,
	generation: 0,
};

export type EditOp =
	| { op: "add_tip"; text: string }
	| { op: "delete_tip"; index: number }
	| { op: "replace_tip"; index: number; text: string }
	| { op: "prompt_append"; text: string }
	| { op: "add_domain_tip"; genre: string; text: string }
	| { op: "set_eval_budget"; value: number };

/** Apply up to `lr` validated edits to a deep copy. Invalid ops are skipped, never throw. */
export function applyEdits(s: Scaffold, edits: unknown[], lr = 3): Scaffold {
	const c: Scaffold = {
		system_prompt: s.system_prompt,
		tips: [...s.tips],
		domain_knowledge: Object.fromEntries(
			Object.entries(s.domain_knowledge).map(([k, v]) => [k, [...v]]),
		),
		eval_budget_hint: s.eval_budget_hint,
		generation: s.generation,
	};
	for (const raw of edits.slice(0, lr)) {
		if (!raw || typeof raw !== "object") continue;
		const e = raw as Record<string, unknown>;
		const text = typeof e.text === "string" ? e.text.slice(0, 400) : "";
		const idx = Number(e.index);
		switch (e.op) {
			case "add_tip":
				if (text) c.tips.push(text);
				break;
			case "delete_tip":
				if (Number.isInteger(idx) && idx >= 0 && idx < c.tips.length) c.tips.splice(idx, 1);
				break;
			case "replace_tip":
				if (text && Number.isInteger(idx) && idx >= 0 && idx < c.tips.length) c.tips[idx] = text;
				break;
			case "prompt_append":
				if (text) c.system_prompt += "\n" + text.slice(0, 600);
				break;
			case "add_domain_tip":
				if (text && typeof e.genre === "string" && e.genre) {
					const g = e.genre.slice(0, 32);
					(c.domain_knowledge[g] ??= []).push(text);
				}
				break;
			case "set_eval_budget": {
				const v = Number(e.value);
				if (Number.isFinite(v)) c.eval_budget_hint = Math.round(Math.min(10, Math.max(1, v)));
				break;
			}
		}
	}
	return c;
}

/** Compose the final system prompt handed to the inner agent. */
export function composeSystemPrompt(s: Scaffold, genre?: string): string {
	let p = s.system_prompt;
	if (s.tips.length > 0) {
		p += "\n\nStrategy notes (learned, in priority order):\n" + s.tips.map((t) => `- ${t}`).join("\n");
	}
	const domain = genre ? (s.domain_knowledge[genre] ?? []) : [];
	if (domain.length > 0) {
		p += `\n\nDomain notes (${genre}):\n` + domain.map((t) => `- ${t}`).join("\n");
	}
	return p;
}
