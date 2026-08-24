/** Headless check: control-file channel (pause/resume/stop) + extension commands. */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunController } from "../src/loopctl.js";
const GEORSI_RUNS = join(process.cwd(), "runs");

let passed = 0;
let failed = 0;
const check = (n: string, c: boolean, d = ""): void => {
	if (c) { passed++; console.log(`  ok   ${n}`); } else { failed++; console.error(`  FAIL ${n} ${d}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("== control file channel ==");
const work = mkdtempSync(join(tmpdir(), "ctl-"));
const ctlPath = join(work, "control.json");
writeFileSync(ctlPath, "");
const logs: string[] = [];
const c = new RunController((m) => logs.push(m));
c.attachControlFile(ctlPath);

writeFileSync(ctlPath, JSON.stringify({ action: "pause" }));
await sleep(2500);
check("pause applied from file", c.isPaused, logs.join("|"));
check("pause logged", logs.some((l) => l.includes("paused")));
check("command consumed", readFileSync(ctlPath, "utf8").trim() === "");

writeFileSync(ctlPath, JSON.stringify({ action: "resume" }));
await sleep(2500);
check("resume applied", !c.isPaused);

writeFileSync(ctlPath, JSON.stringify({ action: "stop" }));
await sleep(2500);
check("stop applied", c.stopRequested);
check("stop implies resumed (no hang)", !c.isPaused);
c.detachControlFile();

// garbage in the file must be ignored
writeFileSync(ctlPath, "{not json");
const c2 = new RunController(() => {});
c2.attachControlFile(ctlPath);
await sleep(2200);
check("garbage command ignored", !c2.isPaused && !c2.stopRequested);
c2.detachControlFile();

console.log("== prepareRunPaths (dir + control file creation) ==");
const prepName = `prep-${Date.now()}`;
const prep = (await import("../extensions/georsi.js")).prepareRunPaths(prepName);
check("run dir created", existsSync(join(GEORSI_RUNS, prepName)));
check("control file created empty", existsSync(prep.controlPath) && readFileSync(prep.controlPath, "utf8") === "");
rmSync(join(GEORSI_RUNS, prepName), { recursive: true, force: true });

console.log("== extension commands (pause/feedback/status without run) ==");
const notifications: string[] = [];
const entries: { lines: string[] }[] = [];
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

await handler("pause", ctx);
check("pause without active run rejected", notifications.some((m) => m.includes("no active run")));
notifications.length = 0;
await handler("feedback", ctx);
check("feedback without text rejected", notifications.some((m) => m.includes("usage")));
notifications.length = 0;
await handler("status", ctx);
check("status notifies no-active-run", notifications.some((m) => m.includes("no active run")));

rmSync(work, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
