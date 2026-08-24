/**
 * Headless render verification: drives the TUI's pure parts (event reducer,
 * log-line formatting, HeaderPanel/HintBar/PlainBlock rendering) without a
 * terminal. Component.render(width) is pure, so we assert on the ANSI output.
 * Exit code 0 = all checks pass.
 */
import chalk from "chalk";
import { visibleWidth } from "@earendil-works/pi-tui";
import { applyEvent, initialSnapshot, parseCommand, fmtTokens, fmtDur, type RsiEvent } from "./events.js";
import { HeaderPanel, HintBar, darkTheme, eventToLogLines, helpText } from "./components.js";
import { journalToEvents } from "./replay.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// strip ANSI for substring assertions
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const sampleEvents: RsiEvent[] = [
	{ type: "run_start", runName: "t1", generations: 4, problems: ["quake_b", "flood_rp"], inner: "a", outer: "b" },
	{ type: "generation_start", generation: 1, total: 4, best: 0.78, tokens: 1_234_567 },
	{ type: "goal_verdict", generation: 1, onTrack: true, source: "fused", steer: "" },
	{ type: "proposal", generation: 1, angle: "method upgrade", mechanism: "inject domain estimators", expected: "+0.05", quality: 8, survived: true },
	{ type: "episode_start", tag: "g1-quake_b", problem: "quake_b", role: "g1", generation: 1 },
	{ type: "episode_turn", tag: "g1-quake_b", turn: 2, maxTurns: 12, note: "keep going" },
	{ type: "episode_submitted", tag: "g1-quake_b", publicScore: 0.9, best: 0.9, submits: 1, cap: 6 },
	{ type: "episode_end", tag: "g1-quake_b", problem: "quake_b", fitness: 0.96, publicScore: 0.9, secs: 60, error: null },
	{ type: "suite_done", mean: 0.9, perProblem: [{ problem: "quake_b", fitness: 0.96 }, { problem: "flood_rp", fitness: 0.84 }] },
	{ type: "verify", first: 0.9, second: 0.88, avg: 0.89, champion: 0.78 },
	{ type: "champion_change", generation: 1, from: 0.78, to: 0.89, mechanism: "domain tips" },
	{ type: "champion_keep", generation: 2, best: 0.89, stagnation: 1, limit: 3 },
	{ type: "heldout_start", problems: ["poro_perm"] },
	{ type: "heldout_done", mean: 0.9976, results: [{ problem: "poro_perm", fitness: 0.9976 }] },
	{ type: "run_end", best: 0.89, tokens: 9_000_000, reason: "completed" },
	{ type: "error", where: "x", message: "boom" },
];

console.log("== reducer ==");
let snap = initialSnapshot();
for (const ev of sampleEvents) snap = applyEvent(snap, ev);
check("best tracks champion change", snap.best === 0.89);
check("problems carry latest fitness", snap.problems.find((p) => p.problem === "quake_b")?.fitness === 0.96);
check("heldout mean captured", snap.heldoutMean === 0.9976);
check("run ended flag", snap.runEnded && snap.endReason === "completed");
check("episode map populated", snap.episodes.get("g1-quake_b")?.turn === 2);

console.log("== commands ==");
check("plain text is feedback", parseCommand("focus on flood_rp").kind === "feedback");
check("/help parsed", parseCommand("/help").kind === "help");
check("/pause /resume /stop /status", ["/pause", "/resume", "/stop", "/status"].every((c) => parseCommand(c).kind === c.slice(1)));
const fb = parseCommand("/feedback try L-moments");
check("/feedback extracts text", fb.kind === "feedback" && fb.text === "try L-moments");
check("unknown command flagged", parseCommand("/nope").kind === "unknown");
check("empty line not feedback", parseCommand("   ").kind === "unknown");
check("fmtTokens", fmtTokens(1_234_567) === "1.2M" && fmtTokens(950) === "950");
check("fmtDur", fmtDur(65_000) === "1m05s" && fmtDur(3_700_000) === "1h01m");

console.log("== log lines ==");
let overlong = 0;
for (const ev of sampleEvents) {
	const lines = eventToLogLines(ev, darkTheme);
	check(`log lines for ${ev.type}`, lines.length >= 1 && plain(lines[0]!).length > 0);
	for (const l of lines) if (visibleWidth(l) > 200) overlong++;
}
check("no runaway log line width", overlong === 0);

console.log("== header render ==");
const header = new HeaderPanel(snap, darkTheme, { inner: "ox-alpha-free", outer: "hy3" });
const w = 100;
const rows = header.render(w);
check("header renders 4 rows", rows.length === 4);
check("every row within width", rows.every((r) => visibleWidth(r) <= w));
const hdr = rows.map(plain).join("\n");
check("header shows champion", hdr.includes("0.8900"));
check("header shows gen counter", hdr.includes("1/4"));
check("header shows tokens", hdr.includes("9.0M"));
check("header shows heldout", hdr.includes("0.9976"));
check("header shows ended state", hdr.includes("ended"));
check("narrow header still fits", header.render(40).every((r) => visibleWidth(r) <= 40));

console.log("== hint + help ==");
const hint = new HintBar(darkTheme);
check("hint renders within width", hint.render(w).every((r) => visibleWidth(r) <= w));
check("help text mentions FEEDBACK", helpText(darkTheme).some((l) => plain(l).includes("FEEDBACK.md")));

console.log("== replay synthesis (real journal) ==");
const boardPath = join(process.cwd(), "runs", "rsi-live", "board.jsonl");
let replayOk = false;
let replayCount = 0;
try {
	const text = readFileSync(boardPath, "utf8");
	const rowsJ = text
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			try {
				return JSON.parse(l) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter((x): x is Record<string, unknown> => x != null);
	const evs = journalToEvents(rowsJ as never);
	replayCount = evs.length;
	replayOk =
		evs.some((e) => e.type === "champion_change") &&
		evs.some((e) => e.type === "episode_end") &&
		evs.some((e) => e.type === "heldout_done");
} catch {
	console.log("  (skipped: no runs/rsi-live journal in this checkout)");
}
if (replayCount > 0) {
	check(`replay events synthesized (${replayCount})`, replayOk);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
