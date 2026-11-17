# 前端第三阶段：工作台换核到研究引擎 + 经验层落地

日期：2026-09-15。上一阶段（`FRONTEND-STAGE-2.md`）的工作台是一条**自包含**的执行路径：自己规划节点、自己循环工具调用、验证只查 CAS 完整性、不产出评分与存证。本阶段把它的**执行内核**换成研究引擎（轨道①），交互外环保留；并在引擎的封包之上落地经验层（只存不查）。

## 1. 现在一次工作台请求发生了什么

```
POST /api/v1/research-requests {question, uploadIds}
  └─ 子进程 src/run.ts research-agent --run-dir runs/<id>
       └─ src/research/workspace-engine.ts   （开发级组合根）
            ├ 上传 → <tmp>/GeoRSI/workspace/<id>/files/ + dataset 证据 + 预览
            ├ 分类（pi 单会话，submit_classification 结构化输出；失败则确定性回退）
            │    → mission-synthesizer.ts 合成开发级 mission（report-only，分档 stages）
            ├ 轮次循环（默认 3 轮，GEORSI_WORKSPACE_ROUNDS）
            │    ├ ResearchScheduler 串行执行本轮节点
            │    │    ├ executeNode → ① ResearchNodeExecutor（角色契约、typebox 提交、pi 会话）
            │    │    └ verifyNode  → ① 族验证器（quantitative-v1 / gis-v1 / literature-v1）
            │    ├ 评审（pi 单会话，submit_review {complete, summary, next}）
            │    └ 未完成 → 追加 r{N+1}- 节点链（分析→verification→synthesis→report），
            │      前一轮 synthesis/report 作为依赖，评审的 next 作为本轮 FOCUS
            ├ 收尾：runResearchOrchestrator（① 的打包）
            │    mission.json / plan.json / claims.json / evidence-index.json / environment.json /
            │    runtime-attestation.json / research-manifest.json / replay.json / research-score.json /
            │    package-seal.json / report.md（证据链接化）
            └ 经验抽取 → knowledge/experience/ + runs/<id>/experience.json
```

`workspace-state.json`、`report-round-N.md`、`directions.jsonl`、`control.json` 的语义与第二阶段一致，**API 与前端零改动**即可工作；前端报告页新增科学评分芯片。

## 2. 分档（tieredStages，graph-spec.ts）

| 档 | literature | quantitative / gis | 说明 |
|---|---|---|---|
| simple | literature-search → verification → synthesis → report | (data-audit) → 分析 → verification → synthesis → report | 有上传文件时定量/GIS 档自动加入 data-audit |
| medium | + frame-question, hypothesis | + frame-question, hypothesis, sensitivity | |
| complex | + value-assessment | + value-assessment, data-audit | 族全模板去掉 presentation/defense |

每档都是族模板的子集且保持模板顺序，所以 `familyGraphSpec(family, tieredStages(...))` 一定通过校验。节点预算 `DEV_NODE_BUDGET`（20 min / 24 calls / 32 tools / 60k out / 2 attempts），report ×2。

## 3. 诚实性不变

- 执行仍是 host-audit（无沙箱），存证 `runMode=host-development`，`eligible=false`、`overall=null`。
- **不跑预检**（`npm run check`）：`unitTestsPassed=false`，存证与独立判决都会如实记录 "unit tests not attested"——这是开发档的预期结论，不是缺陷。
- `python scripts/research_verdict.py runs/<id>` 可以直接跑在工作台包上：replay、computeReplay、模型回执策略校验全部执行；判决脚本按 mission 的 `requiredDeliverables` 判断需要哪些交付物文件（report-only 合法）。
- 引擎侧为此放宽的**只有**"交付物门按 mission 需要的集合判断"（`deliverables.ts` / `deliverable-store.ts` / `orchestrator.ts` 通信分对未要求的交付物取 null 而非 0）；live.ts 竞赛组合根传全三件，行为不变。

## 4. 引擎侧补齐的能力

| 能力 | 落点 |
|---|---|
| 1 秒内停止在途节点 | `scheduler.ts` `externalSignal` 并入 `withinDeadline`；执行器已把 signal 桥到 harness.abort |
| 中途补充方向 | `research-node-executor.ts` deps `directions(nodeId)` → policy 上下文块；每个节点开始时读取并标记已应用 |
| 文献检索工具 | `network-tools.ts` `createLiteratureSearchTool`（Crossref/OpenAlex，返回 literature-v1 形状的 source 记录，contentHash 绑定目录响应） |
| 主机侧抓取围栏 | `host-network.ts` `HostNetworkFetchPort`：私网 BlockList + 单次解析钉 IP + 逐跳重校验 + Retry-After |
| 上传通道 | 计算端口包装：每个脚本预置 `INPUT_FILES`（名称→绝对路径），前缀进入回执脚本文本，重放可复现 |
| 报告链接化 | `report-links.ts`，在 persist 端口内、哈希之前完成，manifest 承诺的是实际服务的字节 |
| API 预写目录 | `live.ts:175` 豁免 API 簿记文件——API→research-live 新建路径此前从未跑通 |
| 执行器 bug | 报告节点草稿探测现在也看 `record_research_artifact` 暂存内容（拒绝文案原本就承诺这条路径） |

## 5. 经验层（只存不查）

`src/research/experience/`：`schema`（记录/审批模型）、`signature`（精确键 + 词法键）、`extract`（run dir → 记录，永不抛错）、`gates`（三道门）、`store`（JSONL 车道 + 索引，幂等）、`approval`（人工决定的纯应用）、`harvest`（三步串起来）。

- 每次工作台封包后自动抽取；`npm run research:experience -- --all` 回填历史包。
- 三道门：验证器 pass→candidate / partial→probation / fail→counter-example；未重放→留 probation；高危（不可重试失败类、族内首条、基于上传数据的结论）→ human=pending。
- `deterministic-demo` 固件包到店即 retired，永不参与路由。
- API：`GET /api/v1/experience`、`GET /api/v1/experience/:id`、`POST /api/v1/experience/:id/review`、`GET /api/v1/research-runs/:id/experience`。
- **本阶段不路由**：库空时路由无收益；schema 已为 route/signature 两层键预留。

## 6. 回退与清理

- `GEORSI_WORKSPACE_ENGINE=legacy` 回到第二阶段的自包含 agent（`workspace-agent.ts`），保留一个发布周期后删除。
- `workspace-model.ts` 随之退出运行路径（全系统只剩 pi 一个模型客户端）。

## 7. 验证

- `npm run workspace:selftest`：旧路径自测 + `workspace_engine_selftest.ts`（假 pi 会话驱动真实执行器/验证器/编排器：两轮 9 节点封包、directions 生效、INPUT_FILES 绑定、报告链接化、停止+续跑、经验抽取）。
- `npm run research:selftest` 新增 `mission_synthesizer_selftest`（155 项）与 `experience_selftest`（28 项）。
- 真机冒烟（待做）：alsl 网关跑一个文献类简单问题与一个带 CSV 的定量问题，结果记入 HANDOFF。
