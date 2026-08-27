# GeoRSI 架构目标与审查

## 1. 系统要解决的问题

GeoRSI 不是训练一个新的地学基础模型。它解决的是：在模型、预算和评测规则受约束的条件下，让 Agent 能够稳定完成不同类型的地学任务，并把经过验证的解题方法迁移到没有见过的新任务。

真正的优化对象不是一组孤立 prompt，而是完整的任务求解策略：

```text
任务识别 -> 规划 -> 知识选择 -> 工具执行 -> 结果验证 -> 提交 -> 经验回流
```

固定模型只是运行时 Adapter。可以跨任务和跨模型复用的资产包括任务画像、工具配方、验证规则、知识节点和失败经验；模型相关的请求格式、推理等级和重试策略必须由模型 Adapter 处理。

## 2. 收敛目标

不能把“当前训练题连续几代没有提升”当成系统收敛。应当在固定成本和安全约束下，最大化新任务分布上的期望成功率：

```text
目标：新任务族、新模板、新数据源上的期望 fitness

约束：
  失败率和无效提交率受控
  token、耗时和工具调用不超过预算
  不读取 hidden truth，不修改 grader
  重要任务族不能出现明显负迁移
  多次独立运行结果稳定
```

一个可接受的 champion 至少应同时满足：

1. 训练集或 dev 集有可重复的提升。
2. 未参与演化的任务上没有超过阈值的退化。
3. `fitness=null`、超时和无提交被当作失败计入统计。
4. 多次重复运行的结果差异在预设置信区间内。
5. guard violation、grader 修改和 hidden truth 访问为零。

## 3. 当前架构分层

```text
控制面：CLI / TUI / Pi Extension / RunController
编排面：Goal -> Propose -> Critique -> Evaluate -> Verify -> Accept
解题面：Prompt -> Read/Write/Python/Job -> Submit -> Finalize
运行时：Provider Adapter / Pi Harness / Model Profiles
评测面：Public Eval / Private Eval / Judge / Guard
学习面：Scaffold / Knowledge / Episodic Memory / Authored RAG
持久化：Journal / State / Run Manifest / Variants / Reports
```

核心调用链位于：

- `src/run.ts`：CLI 分发和配置加载。
- `src/rsi.ts`：外层演化、候选选择、验证和 held-out 入口。
- `src/inner/solve.ts`：一个隔离 episode 的工具循环和最终评分。
- `src/provider.ts`、`src/piharness.ts`、`src/models.ts`：模型 Adapter、超时、推理等级和 token 统计。
- `src/bench/eval.ts`、`src/guard.ts`：公私评测和安全校验。
- `src/knowledge.ts`、`src/memory.ts`、`src/retrieval.ts`：长期知识、运行记忆和可选 RAG。

## 4. 本轮已修复的高风险问题

### 4.1 失败分数不再被均值隐藏

`src/metrics.ts` 提供固定分母聚合。`fitness=null` 会贡献零分但保留任务权重；训练和 Exam 共用同一实现。

### 4.2 候选评估不再反写共享学习状态

`src/rsi.ts` 在评估时使用 Memory 快照，episode 产生的 Memory 和 Knowledge usage 先暂存。只有 baseline 或真正被接受的 champion 才提交学习结果。这样候选 A 不会改变候选 B 的输入。

### 4.3 Scope 实验入口已修正

scope 脚本现在调用 `rsi`，显式传入对应 Scaffold，并使用独立 run 名称、Knowledge 文件和 judge cache。旧的失败结果不会被覆盖。scope C 的标签已匹配 `stepgame`、`mapqa` 和 `k2`。

### 4.4 Resume 可追溯性增强

每个 RSI run 创建 `run-manifest.json`，记录：

- 规范化配置和 generation 数；
- 题目 ID、genre、weight、override；
- seed Scaffold；
- Knowledge 版本；
- RAG 开关和字符预算；
- Node 版本、平台和 run fingerprint。

fingerprint 使用 SHA-256 截断值，不再使用容易碰撞的短 FNV 值。

### 4.5 重复 episode 参数已接入

`episodes_per_problem` 现在会实际创建独立 workspace 和独立 episode 记录，并用固定分母聚合。默认值 `1` 保持现有成本和行为；设置为大于 `1` 后可用于稳定性和方差测量。

## 5. 仍然存在的架构问题

### P0：当前仍不是完整 sandbox

`run_python` 可以启动子进程，`guard` 主要是事后扫描和 hash 校验。它能废弃作弊结果，但不能在读取发生前阻止所有路径、网络或子孙进程行为。严格比赛环境需要 OS sandbox、只读挂载、网络白名单和进程组清理。

### P0：Knowledge 晋升仍缺少 tip 级因果验证

一个 Scaffold 被接受，不等于其中每一条 tip 都有效。当前长期知识需要继续完善为：

```text
candidate -> probation -> tip-level A/B -> cross-family validation -> active
```

所有自动晋升都必须保留证据 run、适用任务族、反例和负迁移记录。

### P1：任务路由仍有多套字符串规则

`guessGenre`、`deriveTags` 和 `regionsForTask` 分别进行任务分类。新题目命名方式变化时可能出现路由不一致。下一步应建立统一 `TaskProfile`，供 Model、Knowledge、RAG、Tool 和 Verifier 共用。

### P1：学习对象仍主要是文本 Scaffold

当前外层能进化 tips、prompt、domain tip 和预算，但还不能直接进化工具配方、验证策略、失败恢复策略和停止条件。下一步应把学习对象提升为 `StrategyBundle`。

### P1：领域 Verifier 不足

现有 submit 验证主要覆盖 quiz 格式和覆盖率。GIS、MapQA、MGQ、GeoAnalyst 还需要 CRS、单位、schema、几何有效性、结果可复现性等确定性检查。

### P1：泛化评测尚未形成正式协议

当前需要按数据源、模板、任务族、区域、格式和工具链划分 train/dev/holdout/challenge，而不能只按 problem ID 划分。还需要记录 worst-family、valid rate、error rate 和多次运行置信区间。

## 6. 推荐演进顺序

```text
评测统计和状态隔离
        ↓
统一 TaskProfile / TaskAdapter
        ↓
任务族级 train/dev/holdout/challenge
        ↓
确定性领域 Verifier 和工具 Recipe
        ↓
tip 级 probation / A-B / 晋升
        ↓
RAG off/on 泛化对照
        ↓
全量 Agent 题库大课表
```

在完成前三项之前，扩大题量或增加 prompt tips 只会增加实验规模，不会自动增加结论可信度。

## 7. 当前验证状态

本轮代码修改后的短回归：

- `npm run typecheck`：通过。
- `npm run selftest`：`77 passed, 0 failed`。
- `npm run tuitest`：`41/0`、`12/0`、`10/0`、`12/0`。
- `python scripts/struct_selftest.py`：`STRUCT_OK`。
- Pi 扩展真实 episode：`11 passed, 0 failed`。

单题 RSI 启动验证已确认：`--scaffold` 会进入 `rsi` 配置并写出 `run-manifest.json`。该探针因 `k2_c001` 的任务级 `max_turns=40` 出现重复分析行为而被主动停止，未形成正式评分结论。
