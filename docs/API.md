# GeoRSI HTTP API

GeoRSI 提供一个面向前端的本地 HTTP API。API 以 `research-runs` 为核心资源，负责创建研究运行、读取运行状态和产物，并通过 SSE 推送运行事件。

当前实现位于 [`src/api/server.ts`](../src/api/server.ts)。服务默认监听 `0.0.0.0:8787`。

本文按 2026-09-13 合并后的代码核对。前端第一阶段建议使用 `research-demo` 完成全流程联调，再接 `research-live`。`rsi` 和 `evolve` 虽可启动，但不具备相同的研究详情数据，不能直接复用完整研究面板。

## 接口总表

下表路径除健康检查外均以 `/api/v1` 开头；`:runId` 使用创建接口返回的 `id`。

| 方法 | 路径 | 成功状态 | 前端用途 / 响应 |
| --- | --- | --- | --- |
| GET | `/healthz` | 200 | 进程存活 |
| GET | `/readyz` | 200 / 503 | tsx 文件存在性检查，不代表模型或 Python 可用 |
| GET | `/configs` | 200 | 配置下拉框，`{ items }` |
| GET | `/research-missions` | 200 | 任务模板列表，`{ items }` |
| GET | `/research-missions/:templateId` | 200 | 任务模板全文，`{ id, name, mission }` |
| GET | `/research-runs` | 200 | 运行列表，`{ items, pagination }` |
| POST | `/research-runs` | 202 | 创建运行，返回 `id`、状态、链接 |
| GET | `/research-runs/:runId` | 200 | 详情聚合快照 |
| POST | `/research-runs/:runId/start` | 202 | 启动排队任务 / 显式恢复 |
| GET | `/research-runs/:runId/workflow` | 200 | 工作流节点和依赖图 |
| GET | `/research-runs/:runId/mission` | 200 | `{ mission, source, updatedAt }` |
| GET | `/research-runs/:runId/events` | 200 | SSE 事件流，非 JSON 响应 |
| GET | `/research-runs/:runId/logs` | 200 | 按字节偏移读取日志 |
| POST | `/research-runs/:runId/actions` | 202 | 暂停、恢复、停止命令 |
| POST | `/research-runs/:runId/feedback` | 201 | 保存文本反馈 |
| GET | `/research-runs/:runId/evidence` | 200 | 证据索引，`{ items }` |
| GET | `/research-runs/:runId/evidence/:evidenceId/content` | 200 | 证据原始内容 |
| GET | `/research-runs/:runId/claims` | 200 | 研究声明，`{ items }` |
| GET | `/research-runs/:runId/score` | 200 | 评分原始 JSON |
| GET | `/research-runs/:runId/attestation` | 200 | 运行证明原始 JSON |
| GET | `/research-runs/:runId/replay` | 200 | 回放验证原始 JSON |
| GET | `/research-runs/:runId/deliverables` | 200 | 可下载文件，`{ items }` |
| GET | `/research-runs/:runId/deliverables/:name/content` | 200 | 文件原始内容 |

上表为原有的 23 个方法/路径组合。工作台另新增文件上传、自然语言启动、原始需求读取和补充方向读取四个接口，详见 [第二阶段接入说明](FRONTEND-STAGE-2.md)。普通输入通过 `POST /api/v1/research-requests` 启动真实 `research-agent` 任务。没有登录、删除运行、修改模型配置或 benchmark 聚合接口。

## 启动

```powershell
npm run api
```

默认地址：`http://localhost:8787`

Docker 单独启动 API：`docker compose up -d --build georsi-api`，宿主机访问 `http://localhost:8792`（映射至容器 `8787`）。前端使用同源 `/api/research` 路由代理；Docker 中由服务端 `GEORSI_API_URL=http://georsi-api:8787` 指向 API，浏览器不需要配置后端地址。

Docker API 的默认配置由 `GEORSI_API_DEFAULT_CONFIG` 指定，当前为
`research-competition-luna`（ALSL、`gpt-5.6-luna`、`high`）。创建任务时显式传入
`config` 仍可覆盖默认值；所选配置会保存到任务记录。密钥从本地 `.env` 中的
`GEORSI_RESEARCH_API_KEY` 注入，不提交到 Git。
如宿主机代理监听 7897，容器可通过 `.env` 设置
`GEORSI_HTTP_PROXY=http://host.docker.internal:7897` 和同值的
`GEORSI_HTTPS_PROXY`；不使用代理时留空。

离线接口自检：`npm run api:selftest`。自检启动随机本地端口并执行确定性 demo，不调用付费模型；测试记录保留在 Git 忽略的 `runs/` 中。

也可以通过环境变量修改端口：

```powershell
$env:GEORSI_API_PORT = "8788"
npm run api
```

## 通用约定

- API 前缀：`/api/v1`
- 请求体格式：`application/json`
- JSON 请求体当前按 JavaScript 字符串长度限制为 2,000,000；大请求返回 `400`，不是 `413`
- 响应默认带 `Cache-Control: no-store`
- 当前开发版允许跨域：`Access-Control-Allow-Origin: *`
- 所有路径的 `OPTIONS` 返回 `204`；不支持的方法通常返回 `404`，没有统一 `405`
- 返回链接是相对路径，前端需拼接 **API origin**，不能直接按前端页面 origin 解析
- `Idempotency-Key` 虽在 CORS 允许头中，但没有去重实现；创建按钮应防重复提交，不要自动重试 POST
- 错误统一返回：

```json
{
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "research run not found",
    "details": { "id": "run_xxx" },
    "timestamp": "2026-09-11T04:00:00.000Z"
  }
}
```

## 健康检查

### `GET /healthz`

进程存活检查。

成功响应 `200`：

```json
{
  "ok": true,
  "service": "georsi-api",
  "time": "2026-09-11T04:00:00.000Z"
}
```

### `GET /readyz`

运行依赖检查。`tsx` 运行时存在时返回 `200`，否则返回 `503`。

```json
{
  "ok": true,
  "runsRoot": "C:\\path\\to\\GeoRSI\\runs",
  "tsx": true
}
```

## 配置

### `GET /api/v1/configs`

返回可供创建运行选择的配置清单。响应只包含展示和选择所需的公开元数据，不返回配置文件原文、密钥或本地路径。

`id: "default"` 表示仓库根目录的默认 `config.json`；其它 `id` 对应 `config/<id>.json`。创建运行时 `config` 可传 `id`，也兼容传入带 `.json` 后缀的文件名。

响应 `200`：

```json
{
  "items": [
    {
      "id": "research-competition-luna",
      "name": "research-competition-luna.json",
      "kind": "run",
      "networkMode": "open",
      "executionBackend": "host-audit",
      "generations": 3,
      "proposals": 3,
      "researchModel": {
        "gateway": "alsl",
        "model": "gpt-5.6-luna",
        "thinkingLevel": "high"
      }
    }
  ]
}
```

### `GET /api/v1/research-missions`

返回仓库内可用于 `research-live` 的 mission 模板摘要。模板来自 `config/research-mission-*.json`，会先经过同一份 mission 契约校验。

每项包含 `id`、`name`、`missionId`、`question`、`scope`、`taskFamily`、`networkMode`、`requiredStages`、`deliverables`、`valid` 和 `issues`。

### `GET /api/v1/research-missions/:templateId`

返回单个 mission 模板的完整内容：`{ id, name, mission }`。前端可以在提交前复制并编辑 `mission`，最终仍由创建接口再次校验。

## 研究运行

### `GET /api/v1/research-runs`

查询 API 创建过的运行记录。

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `status` | 按运行状态过滤：`queued`、`running`、`pausing`、`paused`、`stopping`、`completed`、`failed`、`cancelled` |
| `search` | 按运行名称模糊搜索 |
| `page` | 页码，从 `1` 开始，默认 `1` |
| `pageSize` | 每页数量，默认 `20`，最大 `100` |

响应 `200`：

```json
{
  "items": [
    {
      "id": "run_042383792ee9",
      "name": "API smoke",
      "mode": "research-demo",
      "status": "completed",
      "progress": 100,
      "currentPhase": "completed",
      "createdAt": "2026-09-11T03:52:45.057Z",
      "startedAt": "2026-09-11T03:52:45.059Z",
      "updatedAt": "2026-09-11T03:52:47.835Z"
    }
  ]
}
```

响应同时包含 `pagination`：`page`、`pageSize`、`total`、`totalPages`、`hasNext` 和 `hasPrevious`。

### `POST /api/v1/research-runs`

创建研究运行。默认 `autoStart` 为 `true`，接口异步返回 `202 Accepted`。

请求字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 运行名称，最长 160 个字符；不传时使用 `Untitled research` |
| `mode` | string | `research-live`（默认）、`research-demo`、`rsi` 或 `evolve` |
| `mission` | object | `research-live` 必填，会按研究任务契约校验 |
| `config` | string | 配置名，例如 `research-competition-luna`；`default` 指根目录配置，其余引用 `config/<name>.json`，不能传路径 |
| `gens` | integer | `rsi` 可选，范围 `1..100` |
| `autoStart` | boolean | 是否创建后立即启动，默认 `true` |

`research-demo` 示例：

```json
{
  "name": "API smoke",
  "mode": "research-demo",
  "autoStart": true
}
```

成功响应 `202`：

```json
{
  "id": "run_75258077c4ed",
  "name": "API smoke",
  "mode": "research-demo",
  "status": "running",
  "createdAt": "2026-09-11T03:57:26.218Z",
  "links": {
    "self": "/api/v1/research-runs/run_75258077c4ed",
    "events": "/api/v1/research-runs/run_75258077c4ed/events",
      "workflow": "/api/v1/research-runs/run_75258077c4ed/workflow"
  }
}
```

常见错误：

- `400 INVALID_REQUEST`：JSON、模式、配置或参数不合法
- `422 INVALID_MISSION`：`research-live` 的任务契约校验失败

### `POST /api/v1/research-runs/:runId/start`

启动一个尚未启动的运行。适用于创建时传入 `autoStart: false` 的任务，也适用于 API 重启后需要接管的中断任务。

请求体可选：

```json
{ "resume": true }
```

- 不传或 `resume: false`：只允许 `queued` 状态。
- `resume: true`：仅用于 `research-live` 和 `rsi`，允许 `queued`、`failed`、`cancelled`、`paused`，以及 API 内没有活动子进程的 `running`；有持久化状态时 `research-live` 使用原运行目录恢复工作流、`rsi` 使用原运行状态恢复；没有恢复文件时会从头启动。`research-demo` 和 `evolve` 不支持恢复，返回 `400 INVALID_START`。
- 已有活动子进程时返回 `409 RUN_ALREADY_ACTIVE`；已完成运行不能再次启动。

成功返回 `202`，包含 `runId`、`status`、`resume` 和 `self/events` 链接。

### `GET /api/v1/research-runs/:runId`

读取运行详情和聚合快照。

响应 `200` 包含：

- `status`：当前状态
- `phase`：当前工作流阶段
- `progress`：已完成节点、总节点和百分比
- `timing`：创建、启动、更新时间和耗时
- `usage`：证据数量、活动节点数量和事件数量
- `currentNode`：当前节点摘要
- `result`：评分、manifest hash 和 replay 摘要（运行完成后可用）
- `error`：失败原因（如果有）

### `GET /api/v1/research-runs/:runId/workflow`

返回 `plan.json` 中的研究工作流图，包括节点依赖、状态、预算和产物引用。计划尚未生成时返回空节点图。

### `GET /api/v1/research-runs/:runId/mission`

返回创建时提交的 mission，或运行完成后持久化的 `mission.json`。响应包装为 `{ mission, source, updatedAt }`。

### `GET /api/v1/research-runs/:runId/events`

以 Server-Sent Events（SSE）持续推送运行事件，并在连接建立时先回放历史 ledger 事件，再发送一个 `snapshot` 事件。

支持断线续传：

- 请求头：`Last-Event-ID: 23`
- 或查询参数：`?after=23`

事件格式：

```text
id: 24
event: node-completed
data: {"id":"24","seq":24,"timestamp":"2026-09-11T04:00:00.000Z","type":"node-completed","runId":"run_xxx","data":{"nodeId":"01-frame-question","status":"success","actor":"controller","payload":{}}}
```

连接保持期间每 15 秒发送一次 heartbeat 注释。

新增 ledger 事件每 500 ms 检查并推送。只有持久化 ledger 事件带数字 SSE `id`，供自动重连续传；`log`、`control`、`run_end` 不设置 SSE `id`，也不会在重连时回放。`snapshot` 仅在连接建立时发送，前端收到节点事件后应重新读取详情与工作流。

| 事件名 | `data` 内容（JSON envelope 内） | 前端处理 |
| --- | --- | --- |
| `snapshot` | 完整运行快照 | 初始化详情；外层只有 `type/runId/data` |
| `node-start`、`node-verifying`、`node-completed` | `nodeId/status/actor/payload/artifactIds` | 刷新节点图及进度 |
| `node-failed`、`node-retry-ready`、`node-verification-failed` | 同上 | 显示失败或重试；不代表整次运行结束 |
| `research-mission-start`、`research-mission-failed` | ledger 数据 | 更新时间线 |
| `model-call-receipt`、`scientific-tool-receipt` | ledger 数据 | 展示模型与工具活动 |
| `log` | `{ text }` | 追加进程输出，刷新页面通过 `/logs` 补齐 |
| `control` | `{ action, status: "accepted" }` | 命令已接收，不等于执行完成 |
| `run_end` | `{ status, exitCode?, signal?, error? }` | 重新读取最终快照和产物 |

事件名是可扩展字符串，以上不是封闭枚举。`run_end` 与最后一次 ledger 推送之间没有排序保证；不要仅靠收到的事件计算最终结果。

### `GET /api/v1/research-runs/:runId/logs`

读取 API 启动的子进程历史输出，用于页面刷新后补齐日志；实时日志仍建议使用 SSE。查询参数为 `offset`（字节偏移，默认 `0`）和 `limit`（默认 `200000`，最大 `1000000`）。

响应字段：`content`、`offset`、`nextOffset`、`totalBytes`、`complete`。

`complete` 仅表示读到了当前文件末尾，不表示任务结束。偏移量按 UTF-8 字节计数；切片可能落在中文字符中间，当前接口没有字符边界修正。实时 `log` 不含文件偏移，不要将 SSE 和轮询的文本无条件重复追加。

### `POST /api/v1/research-runs/:runId/actions`

向活动运行发送控制命令。

请求：

```json
{ "action": "stop" }
```

可用动作：

| 动作 | 支持模式 | 说明 |
| --- | --- | --- |
| `stop` | `rsi`、`research-live` | 写入控制文件，运行在安全检查点停止 |
| `pause` | `rsi` | 在下一个安全点暂停 |
| `resume` | `rsi` | 恢复暂停的 RSI 运行 |

命令被接收时返回 `202`：

```json
{
  "commandId": "cmd_4e2a1b8c",
  "runId": "run_xxx",
  "action": "stop",
  "status": "accepted"
}
```

常见错误：

- `409 RUN_NOT_ACTIVE`：运行已经结束或尚未启动
- `409 ACTION_UNSUPPORTED`：当前模式不支持该动作

### `POST /api/v1/research-runs/:runId/feedback`

记录给研究运行的文本反馈，去首尾空白后截取前 10,000 个字符，写入运行目录的 `FEEDBACK.md`。目前只有 RSI 的逐代反馈读取链路消费该文件；`research-live`、`research-demo` 和 `evolve` 没有接入这一 API 反馈文件的消费链路。返回 `recorded` 仅表示保存成功。

请求：

```json
{ "text": "请加强对反例证据的说明" }
```

成功响应 `201`：

```json
{
  "id": "feedback_7e8c1a2b",
  "status": "recorded",
  "effectiveAt": "next-generation"
}
```

## 研究数据和产物

### `GET /api/v1/research-runs/:runId/evidence`

返回 `evidence-index.json` 中的证据索引列表。当前只返回索引元数据，不直接暴露证据存储文件。

### `GET /api/v1/research-runs/:runId/evidence/:evidenceId/content`

下载单条已登记证据的内容。`evidenceId` 必须是证据索引中的完整 CAS id，例如 `sha256:<64 位十六进制哈希>`；接口不会接受任意文件路径或未登记的哈希。

### `GET /api/v1/research-runs/:runId/claims`

返回 `claims.json` 中的研究声明列表。

### `GET /api/v1/research-runs/:runId/score`

返回 `research-score.json`，包括资格、科学评分、通信评分、复现性和评分原因。文件尚未生成时返回 `404 SCORE_NOT_READY`。

### `GET /api/v1/research-runs/:runId/attestation`

返回 `runtime-attestation.json`，用于查看运行时、模型调用和安全审计证明。文件尚未生成时返回 `404 ATTESTATION_NOT_READY`。

### `GET /api/v1/research-runs/:runId/replay`

返回 `replay.json`，用于查看研究包的回放校验结果。文件尚未生成时返回 `404 REPLAY_NOT_READY`。

### `GET /api/v1/research-runs/:runId/deliverables`

返回可下载产物列表。当前白名单包括：

- `report.md`
- `presentation.md`
- `defense.json`
- `research-score.json`
- `runtime-attestation.json`
- `replay.json`
- `evidence-index.json`
- `research-manifest.json`
- `package-seal.json`

### `GET /api/v1/research-runs/:runId/deliverables/:name/content`

下载指定产物内容。`name` 必须属于上述白名单，接口不会接受任意文件路径。

## 前端推荐调用顺序

1. 调用 `GET /api/v1/configs` 填充配置选择器。
2. 调用 `POST /api/v1/research-runs` 创建任务；若 `autoStart: false`，再调用 `POST .../:runId/start`。
3. 使用返回的 `events` 链接建立 SSE 连接；同一 `EventSource` 自动重连会带上 `Last-Event-ID`，刷新页面后使用保存的数字游标构造 `?after=`。
4. 使用 `workflow` 绘制节点图，使用运行详情和 `logs` 接口恢复页面状态。
5. 状态进入 `completed`、`failed` 或 `cancelled` 后读取已有产物；`research-live` 可因资格检查未通过以非零码退出，标为 `failed`，但仍有完整报告和评分。点击证据时使用证据内容接口。
6. 需要停止运行时调用 `POST .../:runId/actions`，请求体为 `{ "action": "stop" }`。

## 当前限制

- 当前 API 面向本地开发，尚未加入认证、授权和公网部署所需的限流策略。
- 服务重启后可以读取 `api-run.json` 和历史产物，但不会自动接管已经存在的外部子进程；可通过 `POST .../:runId/start` 搭配 `resume: true` 显式恢复。
- `research-live` 当前支持停止及 `/start { resume: true }` 的持久化恢复，不支持 `/actions` 的暂停或恢复。
- `pause` 返回后状态为 `pausing`；目前缺少安全点暂停确认事件，不能把它显示成“已确认暂停”。`stop` 在子进程退出后记为 `cancelled`，不强杀当前操作。
- API 重启不会核查旧 PID，状态可能保留 `running`。恢复前需确保旧进程已退出，避免同时写同一目录。
- `evolve` 使用 CLI 的默认 mission 和候选设置，当前 API 的 `mission/gens` 不控制该模式；campaign 产物分散在其它运行目录，当前 API 不聚合这些产物。
- `rsi` 的日志和控制可用，但它没有研究 WorkGraph/score，研究节点进度可能一直为 0；不要据此判断任务卡住。
- 证据内容依赖运行对应的本地 CAS 文件仍然存在；CAS 被清理后只能继续查看证据索引。

## 前端字段和接入示例

运行列表的 `progress` 是百分比数字，详情的 `progress` 是 `{ completedNodes, totalNodes, percent }`。详情的 `currentNode` 和 `result` 可为 `null`；`error`、开始/结束时间等字段可能缺省。`usage.tokens` 当前不提供，不能显示为 0 token。

工作流返回 `ResearchWorkGraph`，以 `nodes[].dependsOn` 建图。节点状态为 `pending / ready / running / verifying / completed / failed / blocked / cancelled`，不要与运行状态混用。计划未生成时只有 `version/missionId/nodes`，没有时间字段。

领域类型源见 [`src/research/contracts.ts`](../src/research/contracts.ts)：

| 资源 | 关键字段 |
| --- | --- |
| Mission | `version/id/question/scope/estimands/units/assumptions/constraints/successCriteria/requiredDeliverables/sourcePolicy/taskProfile`，可选 `dataset`；建议获取模板后编辑，不要仅提交 question |
| WorkNode | `id/kind/title/state/dependsOn/budget/attempts/outputArtifactIds`，可选 `failureCode/failureMessage/startedAt/completedAt` |
| EvidenceRef | `id/kind/sha256/logicalName/producerNodeId/mediaType/bytes`，可选 `sourceUrl/retrievedAt/license` |
| ResearchClaim | `id/text/status/evidenceIds/uncertainty/limitations` |
| Deliverable | `id/name/path/mediaType/bytes/status/downloadUrl`，其中 `path` 仅为文件名 |

score、attestation、replay 返回原始领域对象，没有 `{ data }` 外层；分别以 [`scoring.ts`](../src/research/scoring.ts)、[`runtime-attestation.ts`](../src/research/runtime-attestation.ts)、[`replay.ts`](../src/research/replay.ts) 的类型为准。评分的 `overall` 允许 `null`，资格与科学评分应分开显示。空数组代表尚无数据，`*_NOT_READY` 的 404 代表产物未生成。

浏览器最小联调示例（示例中的渲染函数由页面提供）：

```ts
const API = "http://localhost:8787"; // Docker 使用 8792
async function api(path: string, body?: unknown) {
  const response = await fetch(new URL(path, API), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? `HTTP ${response.status}`);
  return value;
}

const run = await api("/api/v1/research-runs", {
  name: "前端联调", mode: "research-demo", autoStart: false,
});
const source = new EventSource(new URL(run.links.events, API));
const refresh = async () => {
  const [detail, workflow] = await Promise.all([
    api(run.links.self), api(run.links.workflow),
  ]);
  renderDetail(detail);
  renderWorkflow(workflow);
};
// 命名 SSE 事件必须用 addEventListener；onmessage 收不到这些事件。
source.addEventListener("snapshot", refresh);
for (const type of ["node-start", "node-completed", "node-failed", "node-verifying"]) {
  source.addEventListener(type, refresh);
}
source.addEventListener("log", (event) => appendLog(JSON.parse(event.data).data.text));
source.addEventListener("run_end", async () => {
  await refresh();
  source.close();
});
await api(`${run.links.self}/start`, {});
// 页面卸载也需要 source.close()；生产页面还应处理请求异常，合并高频 refresh。
```
