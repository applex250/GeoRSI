/** Verify: research streaming goes ONLY to the bottom panel, zero transcript entries. */
const entries: { type: string; lines: string[] }[] = [];
const widgetCalls: { content?: string[] }[] = [];
const notifications: string[] = [];
const pi: any = {
	registerCommand: () => {},
	registerEntryRenderer: () => {},
	appendEntry: (t: string, data: any) => entries.push({ type: t, lines: data.lines ?? [] }),
	on: () => {},
};
const cmds: Record<string, any> = {};
pi.registerCommand = (n: string, d: any) => { cmds[n] = d; };
(await import("../extensions/georsi.js")).default(pi);
const handler = cmds["research"].handler;
const ctx = {
	ui: {
		notify: (m: string) => notifications.push(m),
		setWidget: (_k: string, c: string[] | undefined) => widgetCalls.push({ content: c }),
	},
};
process.chdir("F:/ttt");
await handler("run", ctx); // returns immediately (detached)

// let the engine stream for a while, then stop it
await new Promise((r) => setTimeout(r, 25000));
const { writeFileSync, readdirSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");
const runsDir = "F:/rsi-lab/runs";
const newest = readdirSync(runsDir).filter((d) => d.startsWith("research-2026")).sort().pop();
if (newest && existsSync(join(runsDir, newest, "control.json"))) {
	writeFileSync(join(runsDir, newest, "control.json"), JSON.stringify({ action: "stop" }));
}
await new Promise((r) => setTimeout(r, 45000));

const stripAnsi = (s: string): string =>
	s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x1b]*(\x07|\x1b\\)/g, "");
const lastWidget = [...widgetCalls].reverse().find((w) => w.content && w.content.length > 1);
const panel = (lastWidget?.content ?? []).map(stripAnsi).join("\n");
const streamed = widgetCalls.some((w) => (w.content ?? []).length > 1);

let passed = 0;
let failed = 0;
const check = (n: string, c: boolean, d = ""): void => {
	if (c) { passed++; console.log(`  ok   ${n}`); } else { failed++; console.error(`  FAIL ${n} ${d}`); }
};
check("main transcript got ZERO research entries", entries.length === 0, JSON.stringify(entries.slice(0, 2)));
check("panel received multi-line content", streamed);
check("panel shows colored tool/system lines", /⚙|RESEARCH|run_python|turn/i.test(panel), panel.slice(0, 200));
check("panel header carries spinner + run name", /georsi/.test(panel) && /research-2026/.test(panel));
check("start notify mentions background", notifications.some((m) => m.includes("background")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
