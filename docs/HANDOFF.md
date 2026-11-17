# GeoRSI Handoff

更新时间：2026-09-11（进化环/族图/Benchmark/小改进 + smoke-021c 基线）
当前分支：`master`
当前提交：见 `git log`（本文件随统一网关路由层提交更新）
GitHub：`origin/master`

## 0. 2026-09 阶段要点（先读这节）

> **2026-09-15 文献节点根因与结构性修复（最新）**——大改后文献检索节点连续 7 次尝试
> 未成功，逐次修症状无效。停下复盘全部时间线后的结论：**literature-v1 的验证输入契约在
> 设计上要求模型手工重打机器已掌握的数据**（search-literature 返回的记录本就带精确
> contentHash），经 python 写 JSON 有 ≥6 个独立形式陷阱（裸 hex、evidence_ids、hypothesis id
> 当证据、Python 布尔、resultFile、计算目录不共享），慢网关上每个陷阱一个 2–4 分钟回合，
> 收口链永远比墙钟多一两个回合。另：`context-recall` 列的是**已提交节点**的记忆目录，
> 首个节点永远召回为空。
> - **新工具 `compile_literature_catalogue`**（executor，仅文献族节点暴露）：模型只给
>   source_ids（检索结果的 DOI/URL id）、claims（含支持/反驳来源）、可证伪假设、novelty
>   范围；工具从本会话的 search-literature 输出 **∪ 前次尝试已登记的检索响应**（按
>   sourceUrl 判 crossref/openalex，`scholarlyRecordsFrom` 重解析）取记录，自动填
>   contentHash/searchQueries/supportsClaimIds，先过绑定+结构+语义验证，再写成 tool-produced
>   CAS 工件，返回 artifactId 与可直接提交的 evidence_ids。收口从 5–8 回合降到 2 回合。
> - 同轮配套：输出上限已提交不作废（#17）、提交后被中止不作废、文献输出权重 ×1.5、
>   恢复时未完成节点按当前权重刷新规划值、context-recall 不计工具预算、前次证据按
>   source→结果 JSON→其他排序上限 120（尾切曾丢掉最早的检索目录）、重试墙钟保底 15 分。
> - **真机结果**：run_e091669de524 恢复后文献节点 **2 次工具调用、约 5 分钟收口**，随后
>   verification/synthesis/report 全部完成，第一轮报告 5143 字七节带证据引用；复核如实指出
>   仅 3 篇文献并要求第二轮扩展（compile 提示"2–5 篇"偏保守——最低充分 vs 充分性的张力，
>   由复核环纠偏）。

> **2026-09-15 真机一轮压测**——run_25e3cb13ea68 / run_92421ade473b 两个真实文献族运行 + 五次
> 恢复，把六层缺陷按真机时序逐个暴露并修复（全部带回归自测）：
> 1. **resultFile 契约**（模型只 print 不写文件）：host 端口在"exit 0 + stdout 是单个 JSON"时
>    自动物化结果文件（replay 同规则、字节可比）；错误信息改为可执行（带脚本 stderr 与
>    json.dump 写法）；工具描述写明契约。
> 2. **工具错误被截断**：tool-registry 曾把工具错误截到 500 字再抛出——stderr 修复指引到
>    不了模型。现在回执保 500 字摘录、抛出带全文（≤6k）。
> 3. **JSON 字面量**：模型每个新会话都写 `false/null`——python 脚本前置
>    `true, false, null = True, False, None`（PRELUDE，replay 同规则），NameError 类失败清零。
> 4. **预算按尝试重置**（坑元教训 #3）：执行器经 `nodeUsed`（引擎活账 + 恢复时账本回填）
>    跨尝试扣减包络，保底 25%/12 分钟；输出 tokens 不扣（重试仍须能写完整交付物）。
> 5. **前次尝试证据不可见**（坑 #19 复现）：引擎按"该节点工具调用产出过哪些 artifact"
>    （nodeArtifacts，账本回执口径）∪ producer 匹配交接给重试会话，渲染为**强制紧凑块**
>    （id|kind|name|url，不会被打包预算裁掉）；context-recall 未命中时回吐可用 id 提示。
> 6. **验证器反馈只在会话外**：submit 受理前**空跑族验证器**（绑定+结构+语义，有界 2 次），
>    精确 issue 当场打回；新增 `normalizeFamilyVerifierPayload`（sha256: 前缀剥离、
>    evidence_id/snake_case 折算）——三处分发/校验点共用，模型写什么形式的哈希都能过。
> 剩余诚实限制：alsl 网关单回合 2–4 分钟，文献节点收口链（召回→写 JSON→提交）单独需要
> 10–15 分钟；已按实测把 literature-search 墙钟权重调到 ×2（40 分钟）。两个真机运行保持
> failed/可恢复状态。

> **2026-09-15 预算可视化**——三层预算全部上前端。新纯函数 `src/research/budget-report.ts`
> 把 plan.json 的规划固定值与账本 `model-call-receipt`/`scientific-tool-receipt` 折成
> `GET /research-runs/:id/budget`（逐节点 planned/used/ratios/level + 运行级 planned/used/
> remaining/overhead/pressure）。前端三处：工作流头部**全局预算条**（工具/模型/tokens/墙钟
> 四条 + 剩余节点待用量 + 分类/复核开销 + 压力 ×N 与"正在收紧下游预算"）；节点详情**预算
> 四维条**（规划固定值 vs 实耗，正常/偏紧/临界）；图节点**角标**（已用/规划次数 + 利用率细条，
> 未执行节点显示规划固定值）。自测：引擎自测用真实账本核对报告与引擎记账一致、API 端点、
> 架构纯度。

> **2026-09-15 三层预算体系**——节点执行时动态知道自己/全局用了多少、还剩多少、
> 后面还有谁；规划期按节点设计定固定值；引擎侧动态调节只收不放、有底线。
> 新纯函数模块 `src/research/run-budget.ts`（架构纯度规则已纳入）：
> - **第一层·规划期固定值**：`planNodeBudget(kind)` 在 `roundNodes` 建图时按节点 kind 给
>   差异化包络（DEV 基线 × 权重：literature-search/data-acquisition 工具 ×1.5、分析类
>   ×1.25、frame/hypothesis/value 类 ×0.5、report 保持 ×2；绝对下限 8 次/6 调用/5 分钟/
>   8k）。写进 plan.json 的 `node.budget`，就是每个节点的**底线**。
> - **第二层·全局账本**：引擎统计运行级 tool/model calls、tokens、墙钟，对照剩余节点的
>   规划包络，经 `deps.runBudget(nodeId)` 提供 `RunBudgetView`（usage / plannedRemaining /
>   remainingNodes 队列 / pressure.overrun）。
> - **第三层·执行期调节 + 可见**：`modulateNodeBudget` 在节点开跑时按"已跑节点实际÷规划"
>   的超支比收紧本节点的工具与墙钟（>1.25 才触发、只收不放、最低 50%、synthesis/report/
>   presentation/defense 受保护；无数据 ⇒ 完整规划值——固定值即失败模式）。执行器用有效
>   包络驱动全部强制（发现上限、墙钟、超时）。可见性：提示词 `BUDGET DISCIPLINE (live)`
>   简报（自身包络+调节原因、全局已用、下游队列与其规划量、"只花自己的份额"）；图块每
>   行带 `budget:[Ncalls/Mmin] state`；**每次工具输出**附 `budgetStatus`
>   {node 已用/剩余 + 墙钟, run 已用/剩余规划/剩余节点数, warning}。
> - 自测：纯函数（差异化/下限/调节边界/保护/简报内容）+ 风暴用例改由规划值推导
>   （文献节点 48 → 上限 44：60 次冲击 = 44 执行 + 16 拒）+ 提示词简报与图块标记断言。

> **2026-09-15 检索死螺旋在引擎路径收口**——真机报错
> `round 1 did not complete its work graph: r1-02-literature-search: timed out after 1199991ms`
> 复盘：#16/#17/#20 当年修在旧③里，融合换核后①执行器没有这些机制——`maxToolCalls`
> 会话内**零强制**（只用于算输出上限）、literature 角色契约零预算纪律、收笔 nudge
> 要求剩余 >60s。修复全部落在 `research-node-executor.ts`（纯函数可单测）：
> - **发现型工具预算门（#16）**：`search-literature`/`web-fetch` 在 `maxToolCalls-4`
>   处停止应答（`TOOL BUDGET RESERVED` + 收笔指引，不耗预算），收尾动作
>   （python-host resultFile / record / submit）永不受限——节点必然留有交卷空间。
> - **预算可见（#16）**：提示词加 BUDGET DISCIPLINE 块（明确次数/分钟、最低充分
>   证据即交卷）；工具输出 JSON 内嵌 `budgetWarning` 字段（剩余 ≤1/4 次数或 <25%
>   墙钟时注入"停止检索、立即交卷"）。
> - **收笔 nudge 阈值 60s→5s（#17）**：墙钟临尽时仍会补一次"现在提交"，预算耗尽
>   尽量转化为提交而非全损。
> - **瞬态失败退款（#20）**：429/超时/5xx/网络类的失败工具调用退还预算（上限 8 次），
>   确定性失败照扣——限流风暴不再吃光预算，坏循环也不会靠退款无限重试。
> - **离线验证**：引擎新增 `networkFetchPort` 注入，自测用囚笼 fetch port 跑文献族
>   "检索风暴"——40 次检索冲击：28 次执行（正好到 cap）、12 次被拒、警告注入、
>   节点仍交出通过 literature-v1 的目录。`npm run check` 全绿。

> **2026-09-15 僵尸洞收口**——踩坑单 #36/#37（此前唯二未修）落地：
> - **#37 心跳双因子存活**：`run.ts` 的 `research-agent` 子进程每 5 s 重写
>   `runs/<id>/heartbeat.json`（启动即写一次）；API 的 `childProcessAlive` 只有
>   "pid 活着 **且** 心跳新鲜（≤90 s）"才判存活——pid 复用骗不过心跳文件。无心跳
>   文件的旧运行回退纯 pid 探测（迁移期兼容）。`deriveStatus`/启动清扫/`/start` 409
>   门全部换成双因子；`/start` 遇"pid 活着但心跳已死"的僵尸先 `terminateStaleChild`
>   再重启，杜绝双写者共享一个运行目录。
> - **#36 僵尸可恢复**：引擎 resume 门槛从"只认 failed/cancelled"放宽为"除 completed
>   外一切 phase 皆可恢复"（旧版对 phase=executing 的静默死亡直接拒绝，把用户逼成
>   全新重跑覆盖检查点——legacy `workspace-agent` 更是静默掉进全新运行分支，同修）；
>   in-flight 节点重置范围补上 `blocked`。自测新增 `zombieResume`（伪造 executing +
>   running 节点 → 恢复续跑不重分类不重规划）与 server 心跳三态断言
>   （新鲜=running / 陈旧=failed / 无文件=回退 pid）。
> - **其余坑复查无回归**：原子写（`renameDurable` 重试+copyFileSync 兜底，经验库用的
>   就是它）、脱敏 `token(?!s)`、python 默认 `python`（Windows 安全）、429 Retry-After
>   退避 + Crossref polite pool、预算纪律/收笔提示、轮次防死螺旋（轮内失败即诚实终止）。

> **2026-09-15 融合轮次**——"③是门面，①是引擎"落地：工作台换核到研究引擎，经验层只存不查。
> 完整说明见 `docs/FRONTEND-STAGE-3.md`。
> - **新组合根 `src/research/workspace-engine.ts`**：`research-agent` 默认走它。复用①的
>   `ResearchNodeExecutor`（pi 会话 + 角色契约 + typebox 提交）、族验证器、`ResearchScheduler`、
>   账本、CAS 与 `runResearchOrchestrator` 打包；保留③的外环（轮次/评审/directions/1 秒停止/
>   `workspace-state.json` 兼容）→ API 与前端零改动。每次运行封包为完整研究包，
>   `research_verdict.py` 可直接判决（预期唯一 issue："unit tests not attested"）。
> - **mission 合成与分档**：`mission-synthesizer.ts`（pi 结构化分类 + 确定性回退，`mission-synthesized.json`
>   可审计）；`graph-spec.ts` `tieredStages(family, tier)` simple/medium/complex 均为族模板子集；
>   `DEV_NODE_BUDGET`。report-only 交付物。
> - **①侧最小改动**：交付物门/存储/通信分按 `requiredDeliverables`（live.ts 传全三件，行为不变；verdict.py
>   同步）；`scheduler.ts` `externalSignal`；执行器 `directions` 上下文块；`live.ts:175` 豁免 API 簿记文件
>   （API→research-live 新建路径此前从未跑通）；执行器报告草稿探测修 bug（`record_research_artifact` 路径）。
> - **补齐③已有能力**：`createLiteratureSearchTool`（Crossref/OpenAlex → literature-v1 记录）、
>   `host-network.ts` `HostNetworkFetchPort`（BlockList + 钉 IP + 逐跳重校验）、上传 `INPUT_FILES` 绑定
>   （前缀进入回执脚本，重放可复现）、`report-links.ts` 在哈希前链接化。
> - **经验层 `src/research/experience/`**：schema / signature（精确键 + 词法键）/ extract（永不抛错）/ gates
>   （验证器 · 重放 · 人工三道门；demo 固件到店即 retired）/ store（`knowledge/experience/` JSONL 车道 +
>   索引，幂等，`GEORSI_EXPERIENCE_ROOT` 可重定向）/ approval（operator 证据源落地）/ harvest。工作台封包后
>   自动抽取；`npm run research:experience -- --all` 回填；API `GET/POST /api/v1/experience*`。**不路由**。
> - **自测**：`workspace_engine_selftest.ts`（假 pi 会话驱动真实执行器：两轮 9 节点封包、directions、
>   INPUT_FILES、链接化、停止+续跑、抽取）、`mission_synthesizer_selftest.ts`（155）、`experience_selftest.ts`
>   （28）；`experience-miner.ts` 补齐 5 个失败类模板；架构门新增纯模块规则。
> - **回退**：`GEORSI_WORKSPACE_ENGINE=legacy` → `workspace-agent.ts`（保留一个发布周期）。
> - **待做**：真机冒烟（alsl：文献类简单问题 + 带 CSV 定量问题）并记录耗时/token 对比；经验路由；
>   ②晋升纪律搬家（需 ≥2 配对运行）；审批面板 UI。

> **2026-09-14 加固轮次（最新）**——一次安全/一致性审计后的集中修复，行为变化如下：
> - **API 暴露面**：`src/api/server.ts` 默认只绑 `127.0.0.1`（`GEORSI_API_HOST` 覆盖）；可选共享令牌
>   `GEORSI_API_TOKEN`（`Authorization: Bearer` / `X-GeoRSI-Token`，定长比较）；CORS 改为**可选**
>   （`GEORSI_API_ALLOWED_ORIGIN`，不设不发头）；所有创建/启动路径统一并发闸
>   `GEORSI_API_MAX_CONCURRENT`（默认 2 → 429）。前端代理 `web/src/app/api/research/[...path]/route.ts`
>   在服务端附加令牌。`docker-compose.yml` 改为 YAML 锚点结构：`georsi-api` **不再挂载**
>   `../rsi-lab-private`，端口只发布到 `127.0.0.1:8792`；死变量 `EXECUTION_BACKEND` 删除。
> - **完整性**：`/evidence/:id/content` 发送前重算 sha256（不符 → `409 EVIDENCE_INTEGRITY`）；
>   `api-run.json` 改原子写，子进程 stdout 只触发 500ms 去抖的元数据写；账本解析按 (mtime,size)
>   缓存；`/logs` 只读请求窗口；`errorResponse` 在 headers 已发出后不再二次 `writeHead`。
> - **竞态**：网关切换（CLI + API）改用唯一临时文件名 + `wx` 创建，API 侧按配置路径串行；
>   CAS `putBuffer` 的 EEXIST 视为成功；`listContents` 跳过非常规文件并校验文件名=哈希；
>   resume 三个检查点解析失败时报出文件名而非裸 SyntaxError（不静默丢弃回执）。
> - **SSRF**：工作台 `fetch_source` 解析一次 DNS 后用钉住地址的 undici `Agent` 连接（TLS 主机名
>   校验保留；代理模式下由代理解析，无法钉住，已注释说明）；退避 sleep 响应 stop 信号。
> - **韧性策略统一**：新增纯模块 `src/research/model-resilience.ts`（瞬态状态集合、指数退避与
>   Retry-After 合并、空闲看门狗）；`workspace-model.ts` 与 `provider.ts` 探针循环共用（探针
>   由线性退避改为同一套指数退避，并开始尊重 Retry-After）。
> - **诚实记录**：工作台模型回复 `status=incomplete` 不再静默通过——`workspace-state.truncatedCalls`
>   计数 + 账本 `model-output-truncated` 事件 + 前端报告页警示。
> - **路径清理**：API 不再创建 `mode:"rsi"`（前端零引用；CLI `npm run rsi`/TUI/`/research` 扩展
>   保留即冻结），`pause`/`resume` 动作随之移除；`SandboxieComputeRunReceipt` 更名
>   `ComputeRunReceipt`（保留 deprecated 别名）；`live.ts` 证据根改用 `os.tmpdir()` 与
>   demo/工作台/API 一致；`GEORSI_*_PROXY` 加入脚本环境脱敏。
> - **未做（需单独立项）**：API 触发运行的 Python 仍是 host-audit 直接主机执行（提示注入 → 主机
>   代码执行的根治需要容器/Sandboxie 级隔离）；③工作台上翻①引擎的大重构；根目录 `api_key*.txt`
>   仍是遗留网关的文件回退（未入 git）。

1. **沙盒永久关闭（最终决策 2026-09-11）**：`execution_backend` 缺省即 `host-audit`（直接主机执行，无隔离）。
   项目保持无沙盒开发版形态；Sandboxie 严格后端代码全量保留（显式 `"execution_backend": "sandboxie"`
   仍可用，fail-closed 语义不变），但不再投入硬化迭代——`/env:=Refresh` 空名环境对、`Start.exe`
   ownership 窗口等遗留故障不再计划修复。诚实性门禁不受影响：host-audit 运行永不满足竞赛资格。
2. **诚实性不降级**：host-audit 运行记为 `runMode=host-development` + `isolationBackend=host-audit`
   + `networkIsolationEnforced=false`，TS 门禁与 Python verdict 双侧强制其**永不满足竞赛资格**。
3. **统一网关路由层**：`config/*.json` 的 `research_gateways` 登记表承载 endpoint/model/api/
   thinking_evidence/**全部弹性参数**（probe_attempts=10、probe_timeout_ms、backoff、
   session_retries=10）；`research_model.gateway` 单字段切换；
   `npm run research:gateway -- alsl|geili|--list` 原子切换（先校验后写入，输出策略指纹）。
   `thinking_evidence=requested-only` 的路由（geili completions 无回显）如实记录为不可竞赛。
   TS/Python 展开逐字节一致，当前 alsl 指纹 `eccdf947cc216870b293280a`。
4. **真机验证结论**：smoke-018 系列经 5 次断点续跑首次**全链路完成**（7/7 节点 + 完整
   科研包 + verify-only replay PASS）。verdict 如实记录 host-development / eligible=false。
5. **两层记忆架构**（smoke-018 上下文分析驱动的核心重构）：
   - L1 push：直接依赖产物**原文注入**（submission JSON/result JSON 全文；脚本 1KB、
     stdout/stderr 排除；12KB/产物、32KB/依赖、96KB 总量封顶）+ claim 伴随传递
     （依赖提交里 claims/narrative 引用的上游证据随行）+ 压缩上下文（mission/图/配方）
   - L2 pull：context-recall（list 带 240 字符产物预览；`evidenceIds[]` 批量取件 ≤8）
   - L3 教训：失败账本注入重试提示词（node-failed/验证 issues/失败工具回执，跨进程有效）
   - L0 跨运行：StrategyBundle 进化（未动）
   - 实测前 baseline：synthesis/report 各 52 次 recall 轮询——根因是静态包只有元数据
6. **角色方法论契约**：8 角色（quantitative/verifier/synthesis/report/defense/literature/
   gis/planner）各有注入 systemPrompt 的方法论契约（估计量声明、独立重推导、六段叙事、
   7 节报告、8 slides、≥12 答辩题……），交付物契约前送到对应节点 prompt。
7. **可进化 WorkGraph（GraphSpec）**：`strategy.workGraph`（stages: kind+deps+budgetScale
   1..4）进 StrategyBundle；graph-spec.ts 提供校验（唯一 ID/未知 kind/Kahn 环检测）、
   任务覆盖检查（requiredStages）、实例化（NN-kind ID + 预算缩放）与四个变异算子
   （add/remove-保护必需/merge-规范ID还原/split-并行）；`npm run research:live` 时
   strategy.workGraph 优先于线性默认。种子包刻意不带 workGraph（线性默认）。
8. **数据契约**：mission.dataset（type/seed/params/path）校验后作为 DATA CONTRACT 强制块
   注入所有节点上下文；种子与 datasetFingerprint 进运行环境捕获——跨运行可比（Stage-A 前提）。
9. **韧性参数**：探针/会话重试从 `research_gateways.*.resilience` 读取（当前 10 次）；
   节点预算 48 模型调用 / 48 工具调用 / 40 分钟墙钟（工作包络，非质量门）。
10. **断点续跑**：`--resume <runDir>`；checkpointGraph 落盘 plan.json + executor_state.json
   （提交/家族验证/成功模型回执/工具回执/证据索引）+ compute_receipts.json；失败节点
   重置 attempts 重来；无状态文件的旧运行会从 CAS 扫描重建证据索引。
12. **交付物消费节点产物（决策 #5a）**：orchestrator 经 `communicationDrafts` 端口读取
   report/presentation/defense 节点的同名产物，过与打包同规则的校验（7 节段+引用 /
   恰好 8 slides / ≥12 题带类别证据）后优先入包；不过则回退确定性模板；账本
   `deliverable-sources` 事件记录 node|template 来源。
13. **节点级 thinkingOverride**：GraphStageSpec 可覆盖思考档（medium|high|xhigh，仅
   host-development；竞赛强制统一并拒绝覆盖）；回执带 nodeId，attestation.thinkingOverrides
   与 verdict 双侧按覆盖校验。用途：沟通节点降档提速。
14. **图表产物**：计算脚本在工作目录写 *.png 即被自动捕获（≤4 张/2MB/总量 4MB）→
   kind=figure 证据入 CAS 与证据索引；replay 比对有意排除 figure 字节。
15. **提交期结构校验 + 答辩类别过滤**：verifications[].input_artifact 在提交时即做
   JSON/结构校验（拒绝脚本/stdout 顶替）；答辩包按任务实际可用证据类别过滤题目
   （无 geodata/source 则不出现 gis/literature 题），题库 16 题过滤后仍 ≥12。
16. **lean 迭代模式**：`config/research-mission-quant-lean.json`（4 阶段无沟通节点，
   同数据契约）供开发迭代；正式出包用完整任务书。

### 阶段要点 17-24（进化环 / 族图 / Benchmark / 小改进）

17. **进化环 driver（#79）**：`npm run research:evolve -- --candidates 2 --run-prefix evo-001`
   —— 基线 + N 个 GraphSpec 变体（add/remove/merge/split 轮转）各跑一轮完整
   research-live（同 seed 可比）；fitness = scienceScore/validRate；晋升走
   runStrategyGeneration（2 次配对重复纪律）。开发模式晋升允许 medium/high/xhigh
   （promotionPolicy 参数化），竞赛默认仍只认 xhigh。
18. **探索节点 kind 注册表（#80）**：`config/node-registry.json`；Lead 可注册 14 种
   内建词汇之外的探索 kind——图内合法、诚实降级（planner 角色 + EXPLORATORY 契约）、
   永不满足 requiredStages/族验证器；`promoteNodeKind(kind, verifierProfile)` 记录
   status+verifierProfile 谱系完成晋升。
19. **族图模板激活（#82）**：`familyGraphSpec(family)` 把各族 requiredStages 链表达为
   GraphSpec；新跑无 strategy.workGraph 时实例化本族模板（定量族含 data-audit、文献族
   含 literature-search），与进化策略同一条校验管线。定量任务现在是 **11 节点**
   （frame-question → value-assessment → hypothesis → data-audit → … → defense）。
20. **竞赛 dataset 契约门禁（#82）**：竞赛任务书必须带 mission.dataset 且绑定 seed
   （TS validateCompetitionMissionShape）；verdict 从任务书重导 dataset 指纹并与
   环境捕获交叉核对（research_verdict.py）。
21. **三层 Benchmark 聚合器（#65）**：`npm run research:benchmark -- --runs-root <dir>`
   扫描 `<taskId>__rep<k>` 目录 → benchmark-report.json。诚实聚合：缺重复/不合格
   计 0 且列出、绝不静默跳过；held-out 单独报告且仅在冻结后有意义。Stage-A 五任务
   均绑定数据契约（quake_b seed=20260909 与 019/020 基线对齐）。
22. **词法-语义 recall（#84）**：字符三元组余弦（确定性、无嵌入无网络）以 0.75 权重
   融入 BM25-lite——形态变体（uncertainty/uncertainties）提升近匹配不挤掉精确命中。
23. **roleBudgets 随窗口缩放（#84）**：角色上下文预算按 research_model.context_window
   相对 600k 参考窗口等比缩放（钳制 4k..120k）。
24. **diag 保留策略（#84）**：RSILAB_PROMPT_DIAG 目录自动清理 7 天前的 prompt_diag-*.jsonl，
   `RSILAB_PROMPT_DIAG_KEEP=1` 可保留。

### smoke-021c 基线（2026-09-11，当前最优）

`runs/luna-smoke-021c-host`：**7/7 节点 + RESEARCH_VERDICT_OK issues=[]，scienceScore 0.975**
（019=0.75 → 021b=0.806 → 021c=0.975，同 seed=20260909 可比）。关键事实：

- **三项交付物全部 node 来源**（deliverable-sources: report/presentation/defense = node/node/node），
  #5(a) 决策实战生效；13 处 [evidence:] 引用、7/7 节段、13 条答辩项。
- replay PASS + computeReplay PASS + ownership verified；76 模型回执 0 失败；cleanup ✓。
- 修复链（当晚）：族模板尊重任务书 pinned requiredStages（021 首跑教训）、沟通节点墙钟
  60min+budgetScale 2、预算纪律合同（report 先交、图表可选）、跨会话 replay
  （compute_requests.json checkpoint）、失败计算尝试不进重放集。
- eligible=false（host-development 诚实记录；沙盒隔离未启用）。
- 进化环基线就位：021c 可作为 champion 基线，fitness=scienceScore。
11. **密钥纪律**：对话中出现过的 key 均视为泄露；冒烟结束后必须轮换 alsl key；
   注册表 `HKCU\Environment` 的 `GEILIAPI_API_KEY`（现值 sk-1c69...，疑似重新添加）
   需确认归属后清理。

## 1. 项目定位

GeoRSI 当前包含两条应用路径，共享同一套 Provider、PiHarness、Sandboxie、Guard、预算和持久化基础设施：

```text
旧路径：rsi / exam / smoke
  目标：固定题库上的解题能力评测与 Scaffold/Strategy 演化
  产出：fitness、RESULTS.md、champion scaffold

新路径：research-demo / research-live
  目标：长程地学科研任务执行、证据固化、验证、复现和答辩
  产出：科研结果包、报告、演示、答辩、replay、manifest、score、seal
```

旧路径不是被删除的旧代码，而是低成本的能力测量和策略实验场；新路径是面向完整科研任务的生产应用层。

## 2. 新 Research 路径

核心执行链：

```text
Mission
  -> WorkGraph / DAG
  -> ResearchScheduler
  -> ResearchNodeExecutor
  -> bounded Pi session
  -> registered scientific tools
  -> CAS Evidence + receipts
  -> deterministic family verifiers
  -> synthesis / report / presentation / defense
  -> compute replay + verify-only replay
  -> runtime attestation
  -> manifest + package seal + three-layer score
```

主要模块：

- `src/research/contracts.ts`：Mission、WorkGraph、Evidence、Claim 等稳定契约。
- `src/research/work-graph.ts`：节点依赖、状态转换和 Mission-aware graph validation。
- `src/research/scheduler.ts`：串行 DAG 调度、节点预算、超时、checkpoint、重试和停止信号。
- `src/research/research-node-executor.ts`：每个节点创建一个受限 Pi 会话；禁止内置文件工具，只允许显式科学工具。
- `src/research/tool-registry.ts`：科学工具注册、参数校验和工具收据。
- `src/research/sandboxie-compute.ts`：Python/GIS/网络工具的 Sandboxie compute port、receipt 和 replay。
- `src/research/evidence-store.ts`：SHA-256 内容寻址证据存储。
- `src/research/event-ledger.ts`：脱敏、追加式 hash-chained event ledger。
- `src/research/verifiers/`：quantitative、GIS、literature、generic 确定性验证器。
- `src/research/deliverables.ts`：报告、8 页 presentation 和 12 问 defense。
- `src/research/replay.ts`：verify-only package replay。
- `src/research/runtime-attestation.ts`：模型收据、Sandboxie、清理、family verifier 和策略指纹门禁。
- `src/research/context-memory.ts`：run 级只读上下文记忆：submit 驱动写入、图状态同步、
  list（进度+目录）/filter/search/fetch 四层检索，全部确定性、收据化、可回溯原文；
  每节点开局注入带 YOU ARE HERE 标注的 graph-map 块。
- `src/research/live.ts`：真实 research-live composition root。

## 3. 统一模型配置

Research 路径现在使用 `Config.research_model` 作为模型配置的唯一来源：

```json
{
  "research_model": {
    "provider": "geiliapi",
    "base_url": "https://sub.geiliapi.com/v1",
    "model": "gpt-5.6-luna",
    "api": "openai-completions",
    "thinking_level": "xhigh",
    "max_tokens_field": "max_completion_tokens",
    "credential_env": "GEILIAPI_API_KEY",
    "fallback": "none",
    "supports_tool_loop": true,
    "supports_usage": true,
    "require_provider_observed_thinking": true
  }
}
```

相关实现：

- `src/config.ts`：`ResearchModelConfig`、验证和指纹。
- `src/provider.ts`：根据配置组装临时 Pi models.json，执行通用 research capability probe。
- `src/piharness.ts`：Provider 身份从实际 model metadata 获取，不再根据模型名猜 provider。
- `src/research/strategy-bundle.ts`：不再保存 model/provider 身份，只保留 `allowFallbackModels: false`。
- `src/research/runtime-attestation.ts`：保存 `modelPolicy` 和 `modelPolicyFingerprint`，收据按策略校验。
- `src/bench/eval.ts`：LLM judge 的 base、key、model、api、thinking 从 `research_model` 派生。
- `config/research-competition-luna.json`：当前 GeiliAPI 配置实例。
- `config/research-benchmark-manifest.json`：当前 benchmark manifest 绑定 `modelPolicy`。

以后切换 Research 使用的模型或网关，原则上只修改配置中的 `research_model`，不应逐个修改 executor、runtime attestation、judge、benchmark 或 verdict 的模型字符串。

## 4. 凭据安全

- 绝对不能使用曾经粘贴到对话、终端、截图或日志中的 Geili key。
- 轮换后的凭据只能通过环境变量注入：`GEILIAPI_API_KEY`。
- 不使用 key-file fallback。
- 不把 key 写入配置、源码、命令行参数、日志或科研包。
- 当前环境没有可用的真实 Geili key，因此没有执行真实模型调用。

## 5. Sandboxie 安全边界

Research 计算使用官方 Sandboxie-Plus app-level isolation：

- 每次计算使用独立 box。
- Repository、private truth、grader、credential/profile 路径关闭。
- 交换目录位于仓库外的绝对 `%TEMP%\\GeoRSI\\...` workspace。
- 配置写入后必须 `/reload`，并进行 settings read-back。
- 运行前验证 Python 根进程 PID ownership。
- 清理顺序包含 terminate、data deletion、config removal、WFP restore、reload、read-back、lease release。
- Strict Sandboxie 不允许回退到宿主 Python。
- GIS 解释器应使用仓库外的 `F:\GeoRSI\venvs\gis\Scripts\python.exe`。
- `network_mode=blocked` 是默认安全模式；`open` 只表示允许出网，不代表网络隔离，必须记录 `networkIsolationClaim=false`。

Sandboxie 是应用级隔离，不是 VM、独立内核或完整同用户主机机密性边界。

## 6. 当前已验证内容

本次推送前已验证：

```text
npm run typecheck                 PASS
npm run selftest                  PASS: 241 passed, 0 failed
npm run research:selftest         PASS: 15 passed, 0 failed
python -m py_compile scripts/research_verdict.py  PASS
git diff --check                 PASS
secret scan                       PASS；未发现 key 文件被 Git 跟踪
```

`research-demo` 可以无模型运行并生成完整的确定性科研包，但它明确：

```text
runMode = deterministic-demo
compute backend = deterministic-test-double
competitionEligible = false
```

## 7. 当前阻塞项

真实 `research-live` 暂时不能宣称竞赛可用，原因如下：

0. 【2026-09-09 实测】GeiliAPI 的 `gpt-5.6-luna` 通道上游故障：
   `/chat/completions` 持续 502、`/responses` 503；同账号同网关的
   `gpt-5.6-terra/sol/gpt-5.6` 正常。网关在 Cloudflare 后：
   非浏览器 UA 被 403 error 1010 拦截（provider/probe 已改用浏览器 UA），
   账号有并发限制（429 gateway_concurrency_limit，顺序调用可避开）。
   恢复检测：`python scripts/research_probe.py --mode tool_call`。
1. 密钥已轮换并配置（用户级环境变量 GEILIAPI_API_KEY，未进仓库/对话）；
   因 0 中 Luna 通道故障，真实 capability probe 与 research-live 冒烟待通道恢复。
2. Python 侧迁移已完成（`scripts/research_probe.py` 取代 `scripts/ai_pixel_probe.py`；verdict 按包内 modelPolicy 动态校验；model_client/judge 支持 geiliapi 与 `max_completion_tokens`），仅保留向后兼容 shim。
3. P1 安全/证据问题仍需独立终审：
   - verifier input 必须从 CAS/tool output 解析或重算，不能信任模型提交的原始指标；
   - cleanup 前 strict guard sweep 必须进入 `guardViolations`；
   - stdout/stderr/result 必须 no-follow、regular-file、canonical-under-exchange；
   - AbortSignal 必须贯穿 scientific tool、Sandboxie process、cleanup 和 replay；
   - terminal stop 后不得继续 synthesis/replay/persist；
   - source policy 和 task profile network mode 必须严格一致。
4. provider-observed xhigh、usage、tool-loop、receipt/api/model 一致性需要真实 Geili probe 证明。

因此当前结论仍是：

```text
Research live composition：已接入，但未达到生产/竞赛资格
Competition eligibility：BLOCK
真实科研分数：未产生
泛化结论：未产生
```

## 8. 下一位接手者的操作顺序

### Step 1：确认工作树和提交

```powershell
git status --short
git log --oneline -5
git fetch origin
git status -sb
```

### Step 2：完成 Provider 迁移

统一使用：

```text
provider       = geiliapi
base URL       = https://sub.geiliapi.com/v1
model          = gpt-5.6-luna
api            = openai-completions
thinking       = xhigh
max token field= max_completion_tokens
fallback       = none
credential     = GEILIAPI_API_KEY
```

禁止重新引入 AI Pixel 或 Responses hard-code。

### Step 3：迁移并测试 Python judge/probe/verdict

要求 Python 侧从 `research_model` 读取 provider/model/api/base URL/key env/token field；verdict 必须根据科研包内持久化的 model policy 动态验证，不允许写死旧 provider。

### Step 4：关闭 P1

补齐 forged verifier input、guard breach、reparse/symlink output、terminal stop、network mismatch、direct orchestrator invalid graph 等 deterministic selftests。

### Step 5：执行完整回归

```powershell
npm run check
npm run sandboxie:selftest
$env:GEORSI_SANDBOXIE_NETWORK_MODE="open"
$env:GEORSI_SANDBOXIE_PYTHON="F:\GeoRSI\venvs\gis\Scripts\python.exe"
npm run sandboxie:selftest
python scripts/research_verdict.py <run>
git diff --check
```

### Step 6：真实模型 smoke

只有在轮换 key 已通过安全方式注入后，执行一次最小 Research node smoke，确认：

```text
Geili model catalog
OpenAI Completions
max_completion_tokens
provider-observed xhigh
usage
function/tool call
PiHarness loop
Sandboxie compute
cleanup
compute replay
```

### Step 7：固定 benchmark

先执行 Stage-A / Stage-B paired repetitions；策略和 manifest 冻结后再执行 held-out `poro_perm`。在此之前不得宣称最佳策略、稳定泛化或竞赛资格。

## 9. 提交纪律

- 每次修改前先查看 `git status` 和当前 handoff。
- 一次只保留一个 writer。
- 任何真实 key 都不进入仓库。
- 不把 deterministic demo 当作真实模型证据。
- 不把 Sandboxie 描述成 VM 或完整主机隔离。
- P1 review 的 `BLOCK` 结论优先于历史通过测试。
- 质量优先：只有分数差 `<= 0.01` 时才比较 token；worst-family 回退不得超过 `0.05`。
