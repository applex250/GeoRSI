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
- `src/rsi.ts`：外层 generation 编排、候选选择和 held-out 入口。
- `src/rsi_eval.ts`：训练套件评估、学习暂存/提交和 champion tip 晋升策略。
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

### 4.6 Memory 证据语义收紧

`src/memory.ts` 现在为旧记录补齐 `probation` 和公开证据元数据；高
public 分只会生成“候选 recipe”，不再写成“same approach generalizes”。
`runExam` 和 `runHeldoutExam` 使用空 episodic memory，避免已有 run 的记忆
污染独立考试。

### 4.7 RSI 评估职责拆分

训练套件评估、固定 Memory snapshot、学习暂存和 champion tip 处理已移到
`src/rsi_eval.ts`；`src/rsi.ts` 保留 generation 控制和接受决策，降低总控
文件的职责密度。

### 4.8 执行生命周期与 Sandboxie-Plus 隔离

`src/sandboxie.ts` 通过已安装的 Sandboxie-Plus Release 接入 Windows strict
backend：每个 episode 使用独立 ASCII box 和仓库外的绝对 exchange workspace；
`SbieIni` 写入 repo/private/credential deny、exchange allow、WFP network block
后强制 `/reload`，再 query 回读。Python 根进程通过 `/box:<name>` 启动，
`/listpids` 证明归属，并用真实 repo/private/network probe fail-closed。
超时、背景 job、正常结束和 Node exit handler 都走 terminate → 删除内容 →
删除 box 配置 → `/reload`。官方 pi 文件工具的 operations 也绑定到 exchange，
并做 symlink/junction-aware 边界检查。

`/fcp` 没有放在 GeoRSI 外层 root launch：Sandboxie `Start.exe` 的语义是
“外部运行当前根进程，只强制其未来子进程”，会反向破坏 root isolation；
正常 boxed-parent propagation 已覆盖子进程跟随。`host-audit` 只保留旧的
防御性检查，不是严格回退路径。严格 Sandboxie 下 `python_cmd` 必须指向
repo/private root 之外的解释器或 venv；repo 内 `.gisenv` 等路径会在创建
box 前直接拒绝，不会回退到宿主机 Python。Sandboxie 是 app-level isolation，不宣称 VM
级安全。

## 5. 仍然存在的架构问题

### P1：host-audit 兼容模式仍不是完整 sandbox

`host-audit` 明确保留作非 Windows 或排障兼容模式；它依赖 workspace fence、
manifest、后扫描和可选 execution policy，不能阻止已运行 Python 的所有路径、
网络或子孙进程行为。生产/竞赛 strict 默认使用 Sandboxie-Plus，但 Sandboxie
本身仍是 app-level isolation，不等同于 VM、内核隔离或完整主机安全边界。

### P0：Knowledge 晋升仍缺少 tip 级因果验证

新接受的 champion tips 现在先写成 `probation`，默认不会进入普通知识注入；
可用 `RSILAB_KB_INCLUDE_PROBATION=1` 做显式 A/B pilot，并通过
`scripts/knowledge_add.py --promote <id>` 按最小使用次数和 private win rate
门槛晋升。仍需要把它完善为：

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

## 8. 本轮软件工程架构整理（2026-08-30）

本轮按职责单一、依赖倒置、显式契约和失败隔离原则整理了实现边界：

```text
┌──────────────────────────────────────────────────────────────┐
│ Interfaces / control: run.ts · TUI · extension · RunController │
└──────────────────────────────┬───────────────────────────────┘
                               │ use cases
┌──────────────────────────────▼───────────────────────────────┐
│ Application: rsi.ts · rsi_eval.ts · exam.ts · inner/solve.ts │
│ generation / suite / exam / one episode                      │
└──────────────┬───────────────────────┬───────────────────────┘
               │ pure policy            │ ports/contracts
┌──────────────▼──────────────┐   ┌────▼───────────────────────┐
│ Domain/policy seams           │   │ Adapters                    │
│ scaffold · task-profile      │   │ provider · piharness        │
│ metrics · budget · memory    │   │ sandboxie · process-env      │
│ knowledge · retrieval        │   │ filesystem/process/eval      │
└──────────────────────────────┘   └─────────────────────────────┘
```

关键整理：

- `src/process-env.ts` 将凭据/代理清理从 Sandboxie adapter 中抽出，评测器只
  依赖环境策略，不依赖 Windows 实现。
- `src/budget.ts` 集中 token ledger；provider 负责获取模型 usage，应用层负责
  budget stop。
- `src/task-profile.ts` 是任务类型、judge/private truth、quiz 和模型角色的
  单一分类来源，避免多个字符串规则漂移。
- `applyProblemRuntimeOverride()` 负责有限的题目运行参数合并，替代
  `({...base, ...override} as Config)` 的不安全 cast。
- `src/inner/episode-contract.ts` owns the stable episode result/evidence
  contract and the fixed-denominator failure factory shared by suite and exam.
- `src/inner/prompt-policy.ts` contains pure initial/follow-up prompt decisions;
  it has deterministic tests and no provider, evaluator, or Sandboxie dependency.
- `src/inner/submission-policy.ts` owns public best/tie/stale state and
  gold-free quiz shape/coverage checks; tool wiring and evaluator I/O remain in
  `solve.ts`.
- `src/inner/python-execution.ts` isolates explicit host-audit process launch
  and restricted/audit source policy; `solve.ts` keeps a compatibility re-export
  but no longer owns this adapter.
- `src/inner/solve.ts` 仍是最大的 application service；本轮先抽出公开科学
  toolkit、episode contract 和 prompt policy，保持行为稳定。进一步拆分
  submit/job/cleanup 应在独立迁移中进行，每一步都要保持一个 writer 和完整回归。

架构规则：trusted grading、agent workspace 和 provider credentials 的边界
不能由 UI 或 model adapter 改写；application service 只能通过显式 context 和
result contract 传递数据；任何新 adapter 都必须具备 deterministic fake 或
selftest seam。

本轮代码修改后的回归：

- `npm run typecheck`：通过。
- `npm run selftest`：`124 passed, 0 failed`，包含 config/route/reasoning validation、private-only quiz、weighted denominator、external truth manifest、explicit `host-audit`、per-problem backend override、外置解释器门禁、reparse 拒绝和 exchange file-tool 边界。
- `npm run sandboxie:selftest`：`SANDBOXIE_OK`，包含真实 repo/private/network 阻断、global WFP restore、PID ownership、foreground timeout、异常退出、background kill 和 cleanup。
- `npm run tuitest`：`41/0`、`12/0`、`10/0`、`12/0`，共 75 项。
- `python scripts/struct_selftest.py`：`STRUCT_OK`（164 quiz chunks、629 cache entries、15 knowledge nodes）。
- `python -m py_compile scripts/*.py`：通过。
- 真实 `npm run smoke`：Sandboxie backend 下 `fitness=0.8624`、`public=0.8376`、`submits=2`、`error=none`；episode cleanup 和 probe 均通过。

当前 strict GIS 运行时门禁已确认：`python_cmd` 解析到 repo/private root 内时，在 box 创建前直接拒绝，不会回退到 host Python；对应要求已同步写入 README、DESIGN、ARCHITECTURE-REVIEW、ARCHITECTURE-VIEWS 和 security 图。
