# GeoRSI Handoff

更新时间：2026-09-09（真实场景测试阶段）
当前分支：`master`
当前提交：见 `git log`（本文件随统一网关路由层提交更新）
GitHub：`origin/master`

## 0. 2026-09 阶段要点（先读这节）

1. **沙盒默认关闭（开发期决策）**：`execution_backend` 缺省即 `host-audit`（直接主机执行，无隔离）。
   显式 `"execution_backend": "sandboxie"` 才启用 Sandboxie。Sandboxie 代码全量保留；
   相关故障（`/env:=Refresh` 空名环境对、`Start.exe` ownership 窗口）延后迭代再修。
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
