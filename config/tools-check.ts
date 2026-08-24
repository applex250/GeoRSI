/** Optional check (run it yourself): chat-facing tools registration + behavior.
 *  npx tsx config/tools-check.ts      (no LLM, pure mock)
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
const check = (n: string, c: boolean, d = ""): void => {
	if (c) { passed++; console.log(`  ok   ${n}`); } else { failed++; console.error(`  FAIL ${n} ${d}`); }
};

const tools: Record<string, any> = {};
const pi: any = {
	registerCommand: () => {},
	registerEntryRenderer: () => {},
	registerTool: (t: any) => { tools[t.name] = t; },
	appendEntry: () => {},
	on: () => {},
};
(await import("../extensions/georsi.js")).default(pi);
const ctx = { ui: { notify: () => {}, setWidget: () => {} } };

console.log("== tool registration ==");
check("research_status registered", !!tools["research_status"]);
check("research_control registered", !!tools["research_control"]);

console.log("== research_status (idle) ==");
const st = (await tools["research_status"].execute("t1", {}, undefined, undefined, ctx)) as { content: { text: string }[] };
const text = st.content[0]!.text;
check("idle status reports no active run", text.includes("no run is currently active"));
check("status points at artifacts dir", text.includes("runs"));

console.log("== research_control ==");
const noRun = (await tools["research_control"].execute("t2", { action: "pause" }, undefined, undefined, ctx)) as { content: { text: string }[] };
check("pause without run rejected", noRun.content[0]!.text.includes("no active run"));
const noText = (await tools["research_control"].execute("t3", { action: "feedback" }, undefined, undefined, ctx)) as { content: { text: string }[] };
check("feedback without text rejected", noText.content[0]!.text.includes("needs text"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
