/** Integration check: one REAL smoke episode with the TUI event sink attached. */
import { join } from "node:path";
import { loadConfig, ROOT } from "../config.js";
import { getPiRuntime } from "../provider.js";
import { loadProblems, makeEvalContext } from "../bench/eval.js";
import { openMemory } from "../memory.js";
import { SEED_SCAFFOLD } from "../scaffold.js";
import { solveEpisode } from "../inner/solve.js";
import type { RsiEvent } from "./events.js";

const cfg = loadConfig();
const { inner } = await getPiRuntime(cfg, ROOT);
const problems = loadProblems({ ...cfg, max_turns: 3, eval_cap: 2, episode_timeout_s: 720 }, ROOT, false);
const runDir = join(ROOT, "runs", "tui-emit-check");
const seen: string[] = [];
const res = await solveEpisode({
	cfg: { ...cfg, max_turns: 3, eval_cap: 2, episode_timeout_s: 720 },
	problem: problems[0]!,
	evalCtx: makeEvalContext(cfg, ROOT),
	scaffold: SEED_SCAFFOLD,
	model: inner,
	workspace: join(runDir, "episode"),
	memory: openMemory(runDir),
	tag: "emit-check",
	emit: (ev: RsiEvent) => {
		seen.push(ev.type);
		console.log("EVENT", ev.type, ev.type === "episode_end" ? `fitness=${ev.fitness}` : "");
	},
});
console.log("\nresult:", res.fitness, "| events seen:", [...new Set(seen)].join(","));
const need = ["episode_start", "episode_turn", "episode_end"];
const missing = need.filter((n) => !seen.includes(n));
if (missing.length > 0 || res.fitness == null) {
	console.log("INTEGRATION_FAIL missing:", missing.join(","));
	process.exit(1);
}
console.log("INTEGRATION_OK");
