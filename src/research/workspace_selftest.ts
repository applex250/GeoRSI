import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { createApiServer } from "../api/server.js";
import { UPLOAD_ROOT, uploadPath, type ResearchUpload } from "../api/uploads.js";
import { plannedGraph, publicUrl, runWorkspaceAgent, linkWorkspaceReport } from "./workspace-agent.js";
import { readResearchLedger } from "./event-ledger.js";
import type { ResearchModelCall } from "./workspace-model.js";

const runId = "run_" + randomUUID().replaceAll("-", "").slice(0, 12);
const runDir = join(ROOT, "runs", runId);
mkdirSync(runDir, { recursive: true });
const server = createApiServer();
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
let file: ResearchUpload;
try {
  const uploaded = await fetch(origin + "/api/v1/uploads?name=rainfall.csv", { method: "POST", body: "year,rainfall\n2020,2\n2021,4\n2022,6\n" });
  assert.equal(uploaded.status, 201); file = await uploaded.json() as ResearchUpload;
  assert.equal(file.sha256, createHash("sha256").update(readFileSync(uploadPath(file))).digest("hex"));
  assert.equal((await fetch(origin + "/api/v1/uploads?name=bad.exe", { method: "POST", body: "bad" })).status, 400);
  assert.equal((await fetch(origin + "/api/v1/research-requests", { method: "POST", body: JSON.stringify({ question: "", uploadIds: [] }) })).status, 400);
  assert.equal((await fetch(origin + "/api/v1/research-requests", { method: "POST", body: JSON.stringify({ question: "地学测试", uploadIds: ["../not-uploaded"] }) })).status, 400);
} finally { await new Promise<void>((resolve) => server.close(() => resolve())); }

await assert.rejects(publicUrl("http://127.0.0.1/private"));
await assert.rejects(publicUrl("file:///etc/passwd"));
assert.throws(() => plannedGraph({ nodes: [{ id: "a", title: "A", kind: "verification", dependsOn: ["b"] }, { id: "b", title: "B", kind: "report", dependsOn: ["a"] }] }, runId, 1), /cycle/);
assert.throws(() => plannedGraph({ nodes: [{ id: "a", title: "A", kind: "verification", dependsOn: [] }, { id: "b", title: "B", kind: "report", dependsOn: [] }] }, runId, 1), /every|all research/);
writeFileSync(join(runDir, "request.json"), JSON.stringify({ question: "计算上传降水数据均值并说明限制", uploadIds: [file!.id] }));
const cite = `[evidence:sha256:${file!.sha256}]`;
let plans = 0, reviews = 0, executedPython = false, sawAppliedDirection = false;
const reply = (text: string) => ({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 20, output_tokens: 30 } });
const fakeModel: ResearchModelCall = async (input) => {
  const prompt = JSON.stringify(input);
  if (prompt.includes('Plan round')) {
    plans++;
    return reply(JSON.stringify({ nodes: [{ id: "analyze", title: "降水分析", kind: "quantitative-analysis", dependsOn: [], objective: "Compute rainfall mean" }, { id: "verify", title: "验证均值", kind: "verification", dependsOn: ["analyze"] }, { id: "report", title: "研究报告", kind: "report", dependsOn: ["verify"] }] }));
  }
  if (prompt.includes('Review this research critically')) { reviews++; return reply(JSON.stringify({ complete: reviews > 1, summary: reviews > 1 ? "证据与限制完整" : "需要进一步说明样本局限", next: "完善样本局限" })); }
  if (prompt.includes('补充说明三年样本不能代表气候趋势')) sawAppliedDirection = true;
  if (!executedPython && prompt.includes('quantitative-analysis')) {
    executedPython = true;
    appendFileSync(join(runDir, "directions.jsonl"), JSON.stringify({ id: "direction-test", text: "补充说明三年样本不能代表气候趋势", createdAt: new Date().toISOString() }) + "\n");
    return { output: [{ type: "function_call", name: "python_analysis", call_id: "compute-1", arguments: JSON.stringify({ script: "import pandas as pd\nprint(pd.read_csv('rainfall.csv')['rainfall'].mean())", purpose: "Compute mean" }) }], usage: { input_tokens: 10, output_tokens: 10 } };
  }
  if (prompt.includes('function_call_output')) assert.ok(prompt.includes('4.0'), "real Python result must reach the model");
  return reply(`# 降水研究\n\n样本平均降水为 4，使用上传数据直接计算。${cite}\n\n## 方法\n使用三条记录进行算术平均，并逐项复核。\n\n## 结果与局限\n${("三年样本不足以说明长期气候趋势，需要更长时间序列和站点信息。" + cite + "\n").repeat(8)}`);
};
await runWorkspaceAgent(runDir, join(ROOT, "config", "research-competition-luna.json"), fakeModel);
assert.equal(plans, 2); assert.equal(reviews, 2); assert.equal(executedPython, true); assert.equal(sawAppliedDirection, true);
const state = JSON.parse(readFileSync(join(runDir, "workspace-state.json"), "utf8"));
assert.equal(state.phase, "completed"); assert.ok(state.appliedDirectionIds.includes("direction-test"));
assert.equal(readResearchLedger(join(runDir, "events.jsonl")).valid, true);
assert.ok(readFileSync(join(runDir, "report.md"), "utf8").includes("/api/research/research-runs/"));
assert.equal(JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")).nodes.length, 6);
const refs = JSON.parse(readFileSync(join(runDir, "evidence-index.json"), "utf8"));
const corrected = linkWorkspaceReport(`[file](rainfall.csv) [evidence:sha256:${file!.sha256})`, refs, runId);
assert.ok(!corrected.includes("](rainfall.csv)")); assert.ok(!corrected.includes("[evidence:"));
console.log("Workspace selftest PASS: streamed upload, validation, private URL rejection, real Python, graph iteration, queued directions, durable report and ledger");
