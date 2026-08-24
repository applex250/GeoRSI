/** Headless check: collapsed-thinking hyperlink + /research think expansion. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";

let passed = 0;
let failed = 0;
const check = (n: string, c: boolean, d = ""): void => {
	if (c) { passed++; console.log(`  ok   ${n}`); } else { failed++; console.error(`  FAIL ${n} ${d}`); }
};
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");

// --- display state machine: collapsed + hyperlink ---------------------------
const appended: string[][] = [];
const labelHist: string[] = [];
let label = "";
const disp = (await import("../extensions/georsi.js")).createEngineDisplay(
	(lines) => appended.push(lines),
	(l) => { label = l; labelHist.push(l); },
);

const work = mkdtempSync(join(tmpdir(), "think-"));
const streamLog = join(work, "stream.log").replace(/\\/g, "/");
writeFileSync(streamLog, "SYS|stream: " + streamLog + "\nTHINK|alpha thinking.\nTOOLC|ls|path=.\nTHINK|beta thinking.\nSYS|done\n");

disp.pushLine("SYS|stream: " + streamLog);
disp.pushLine("THINK|First block line one.");
disp.pushLine("THINK|First block line two.");
disp.pushLine("TOOLC|ls|path=.");
disp.pushLine("THINK|Second block.");
disp.pushLine("TEXT|All done.");
disp.flushThinking();

const collapsed = appended.filter((e) => plain(e[0] ?? "").includes("thinking ("));
check("two collapsed thinking blocks emitted", collapsed.length === 2, JSON.stringify(appended.map((e) => plain(e[0] ?? "").slice(0, 50))));
check("blocks numbered [#1] [#2]", plain(collapsed[0]![0]).includes("[#1]") && plain(collapsed[1]![0]).includes("[#2]"));
check("collapsed shows char count + preview", plain(collapsed[0]![0]).includes("chars") && plain(collapsed[0]![0]).includes("First block line one"));
check("collapsed line is an OSC8 hyperlink to stream.log", collapsed[0]![0].includes("\x1b]8;;") && collapsed[0]![0].includes(streamLog));
check("click hint present", plain(collapsed[0]![0]).includes("/research think"));
check("label tracks thinking", labelHist.some((l) => l.startsWith("thinking…")));
check("tool line displayed", appended.some((e) => plain(e[0] ?? "").includes("⚙ ls(")));
check("text line white-displayed", appended.some((e) => plain(e[0] ?? "") === "All done."));

// --- live expanded mode -------------------------------------------------------
appended.length = 0;
disp.liveExpanded = true;
disp.pushLine("THINK|expanded mode line.");
check("live expanded streams thinking white", appended.length === 1 && plain(appended[0]![0]).includes("expanded mode line"));
disp.liveExpanded = false;

// --- /research think handler (expansion parse from stream.log) ---------------
const entries: { lines: string[] }[] = [];
const notifications: string[] = [];
const pi: any = {
	registerCommand: () => {},
	registerEntryRenderer: () => {},
	appendEntry: (_t: string, data: any) => entries.push({ lines: data.lines ?? [] }),
};
const cmds: Record<string, any> = {};
pi.registerCommand = (n: string, d: any) => { cmds[n] = d; };
(await import("../extensions/georsi.js")).default(pi);
const handler = cmds["research"].handler;
const ctx = { ui: { notify: (m: string) => notifications.push(m), setWidget: () => {} } };

await handler("think", ctx); // no run recorded in this extension instance
check("think without run is rejected", notifications.some((m) => m.includes("no thinking recorded")), notifications.join("|"));

rmSync(work, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
