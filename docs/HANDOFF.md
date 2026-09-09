# GeoRSI Handoff

更新时间：2026-08-30
当前分支：`master`
当前提交：`c6fd106 feat: unify research model policy into single research_model config`
GitHub：`origin/master` 已同步到 `c6fd106`

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

1. 尚未配置轮换后的 `GEILIAPI_API_KEY`，真实 capability probe 未执行。
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
