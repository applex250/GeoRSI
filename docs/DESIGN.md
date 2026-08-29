# GeoRSI 设计文档

以 **pi agent harness** 为基座的自我进化地学科研系统。外层进化循环改写内层科研
agent 的策略（scaffold），内层 agent 在独立 episode exchange workspace 中真实做研究（写代码、跑分析、提交答案），
Windows strict 路径通过 Sandboxie-Plus app-level box 执行；`host-audit` 仅作为显式兼容模式。
私有评测决定选择压。

- `docs/georsi-context.mmd`：系统上下文
- `docs/georsi-runtime.mmd`：运行时和容器依赖
- `docs/georsi-episode.mmd`：代际/episode 时序
- `docs/georsi-security.mmd`：Agent 执行与评测信任边界
- `docs/ARCHITECTURE-VIEWS.md`：依赖规则和当前安全限制

旧的单页 Drawio 图仍保留作历史导出，但不再承担所有层次的唯一视图。

## 总体架构（简图）
```
                 ┌────────────────────────────────────────────┐
                 │ 外层进化环 (evolver, hy3)                    │
                 │ goal gating → propose → critique → select   │
                 │      ↑                                    │
                 │      │ scaffold (JSON, 可进化数据)           │
                 │      ↓                                    │
                 │ 对抗验证 (2次平均须胜冠军) ── champion 快照    │
                 └──────────────┬─────────────────────────────┘
                                │ fitness = 训练套件私有分均值
                 ┌──────────────┴─────────────────────────────┐
                 │ 内层科研环 (researcher, mimo-v2.5)           │
                 │ pi session: read/write/edit/ls/grep         │
                 │           + run_python + submit(公开分反馈)  │
                 │ 双停机: 提交预算 + patience + 墙钟             │
                 └──────────────┬─────────────────────────────┘
                                │ ##SCORE## 协议 (python eval.py)
                 ┌──────────────┴─────────────────────────────┐
                 │ 题目集 problems/ (地学 4 题)                  │
                 │ 公开参考真值 (agent 可见) / 私有真值 (树外)    │
                 └─────────────────────────────────────────────┘
```

## 关键设计决策（与两个参考项目的关系）

| 设计 | 来源 | 说明 |
|---|---|---|
| pi `createAgentSession` 基座 | OpenRSI_self | 内层是真正的 pi agent session（工具循环由 pi-agent-core 驱动），而非手写 reply/execute 循环 |
| scaffold-as-data | OpenRSI_self | 进化对象是 JSON（系统提示+tips+领域知识），无编译/注入面 |
| think-first 三字段 + 文本学习率≤3 | OpenRSI_self | 提案必须带 mechanism/expected_delta/falsification，编辑数有界 |
| propose→critique→eval→对抗验证 五段流水线 | OpenRSI_self | critique 在算力花费前剪枝；全灭放行最优 1 个；换冠需 2 次平均胜出 |
| 工具捕获模式的结构化输出 | OpenRSI_self | defineTool+typebox 校验；超时中止后已捕获部分仍可用 |
| 三看门狗（墙钟/停顿/预算） | OpenRSI_self | 每个 prompt 有硬顶；无事件流 stall 检测；全局 token 预算 |
| 事件溯源持久化 + 原子快照 | OpenRSI_qh | board.jsonl append+fsync；state.json tmp+rename；断尾容错 |
| 确定性优先评测 | OpenRSI_qh | 默认只解析 ##SCORE## 标记；部分 external private benchmark 使用缓存的 LLM judge；私有分不进入 Agent prompt |
| 公开分迭代/私有分选择 | 两者 | Agent 只见公开分；外层选择只看私有分；私有真值在树外 |
| Memory / Knowledge 证据分级 | 本项目新增 | episodic memory 只保存 public-only probation 观察；新 champion tips 先进入 knowledge probation，需独立证据后再 active |
| goal plan 门控 + 确定性趋势先验 | OpenRSI_self | LLM 判断被便宜先验兜底，LLM 失败不阻塞 |
| FEEDBACK.md 人在回路 | OpenRSI_self | runs/<name>/FEEDBACK.md 每代重读 |
| 断点续跑 resume | 本项目新增 | OpenRSI_self 的最大缺口：重启从 gen0 重来。我们用 state.json+指纹校验实现真正续跑 |
| Windows 兼容 | 本项目新增 | 无 bash 依赖（自定义 run_python 工具）、node:path、无 POSIX-only 调用 |

## 地学题目集

| 题目 | 学科 | 任务 | 私有真值 |
|---|---|---|---|
| quake_b | 地震学 | Gutenberg-Richter b 值 (Aki MLE + Mc 选择) | b=0.85 |
| quake_b_real | 地震学·真实数据 | USGS ComCat 南加州真实目录 b 值（2010-24 主期 24.5k 事件 / 1990-09 参考期 51.9k 事件；含 Ridgecrest M7.1 与 Landers M7.3） | b=0.8183（标准 Aki MLE；参考期 0.9291 公开） |
| flood_rp | 水文学 | Gumbel 年最大序列 100 年一遇洪水位 | Q100=238.0 |
| climate_trend | 气候学 | AR(1) 噪声下的线性趋势斜率 | 0.017 °C/yr |
| poro_perm (held-out) | 岩石物理 | 孔隙度-渗透率回归预测 | log10 k|φ=0.25 |

每题：`gen.py`（numpy 生成数据+私有真值）、`statement.md`（考题）、`eval.py`
（##SCORE## 协议，public/private 双分裂）、`data/`（主数据+参考数据，参考真值公开）。
held-out 题不参与进化选择，只在终局考题中验证泛化。

## 运行模式

```
npx tsx src/run.ts selftest        # 无 LLM 单元测试（编辑算子/journal/评测协议/记忆/看板）
npm run sandboxie:selftest         # 真实 Sandboxie box + PID/路径/网络/清理探测
npx tsx src/run.ts smoke           # 1 个真实 episode（quake_b，小预算）
npx tsx src/run.ts exam            # 全套考题（含 held-out）→ RESULTS.md
npx tsx src/run.ts rsi --gens N    # 完整进化循环
npx tsx src/run.ts rsi --resume    # 从 state.json 断点续跑
```

## 网关模型支持（2026-08-28 实测固化，9 模型）

| 模型 | 端点 | 路由 | API | 上下文/最大输出 | 用途 |
|---|---|---|---|---|---|
| hy3 | zen 网关 | 直连 | chat/completions | 256k / 128k | outer（默认；实跑产出冠军提案） |
| z-ai/glm-5.3-flash | OpenRouter | 直连 | chat/completions | 1m / 128k | 当前 quiz/agent inner 候选；2026-08-27 fresh baseline |
| mimo-v2.5 | zen 网关 | 直连 | chat/completions | 1m / 128k | 备用（重推理、慢） |
| mimo-v2.5-pro | **emooo.cc 临时网关** | 直连 | **chat/completions** | 1m / 128k | 临时 inner 候选；thinking minimal/low/medium/high/xhigh |
| muse-spark-1.2-contributor | zen 网关 | **代理** | **responses** | — | 可选；直连 403，chat 端点 500 |
| dsv4f | **校园本地** | 直连 | chat/completions | 256k / 64k | 免费 deepseek；服务器常关属正常 |

关键工程结论（写入 `src/config.ts` SUPPORTED_MODELS 与 `src/provider.ts`）：

1. muse 地区封锁且只服务 Responses API；models.json 的**模型级 `api` 字段**让
   pi 按模型分发 API 实现（pi 的 provider-composer `getApiProvider(model.api)`）。
2. muse 不能带 reasoning 参数（网关 400 reasoning.effort）→ 模型定义
   `reasoning: false`。
3. **`NODE_USE_ENV_PROXY` 在本系统无效**：导入 pi-coding-agent 会用其内置
   npm undici 替换 globalThis.fetch，绕过 Node 启动时配置的代理调度器。
   解法：`provider.ts` 直接 `undici.setGlobalDispatcher(new EnvHttpProxyAgent(...))`
   （undici 全局调度器走共享 `Symbol.for` 注册表，对 pi 的 fetch 生效），
   选中 muse 时自动启用，此时网关流量走环境代理（4 模型均已验证可走代理）。
4. 本地服务器（`local_base_url`，密钥 `api_key_local.txt`）：models.json 中
   独立 `local` provider；**启动预检**——选中本地模型时先 GET /v1/models，
   不通则带"换网关模型"提示快速失败；代理模式下本地 host 自动加入 noProxy
   （muse + dsv4f 可同进程共存）。长跑中途掉线由 pi 重试 + episode 容错兜底
   （错误记入 journal，冠军不受影响）。
5. 上下文窗口按真实规格写入（驱动 pi 的压缩决策）；单请求输出统一封顶
   16384（防单轮巨型输出，远低于各模型真实上限）。
6. 网关有突发性 `finish_reason: network_error`（约分钟级突发）；pi 自动重试
   默认 3 次不够，harness 通过 `SettingsManager.inMemory` 加强为 6 次指数退避。
7. 临时 `mimo-v2.5-pro` 使用 `https://api.emooo.cc/v1` 的 chat/completions，
   两个端点都通过了基础 probe，但 chat 更快且已验证 Pi streaming/tool-call。
   请求通过 `compat.thinkingFormat="zai"` 发送 `thinking: {type: "enabled"}`
   （enabled 时附 `clear_thinking=false` 和 `reasoning_effort`）；`off` 发送
   `thinking: {type: "disabled"}`，`max` 不发送而由统一层钳制到 `xhigh`。
   密钥只从 `RSILAB_EMOOO_API_KEY` 读取，不能写入 Git。
8. `inner_thinking_level` 与 `outer_thinking_level` 是可选 config 覆盖，支持
   `off/minimal/low/medium/high/xhigh/max`；profile 在请求前做模型级钳制。
   若长 turn 已在 exchange 中写出 canonical solution 但没有发 `submit`，driver
   只读取该 workspace 内的候选并复用同一 public submit/eval 路径；结果以
   `submissionRecovery="candidate-file-driver"` 留痕，不接触 private truth。

## TUI 层（pi-tui 复用，2026-08-24）

```
TuiAltScreen (pi-tui 全屏差分渲染 + Windows 原生 VT 支持)
 └─ setLayoutRoot(VStack)
     ├─ HeaderPanel   固定状态区：gen/champion/stagnation/tokens/各题分数/阶段+spinner
     ├─ ScrollView    滚动彩色事件日志（follow end，2000 行封顶）
     └─ VStack[Input, HintBar]  反馈输入行 + 键位提示
```

设计原则（对应 pi 生态的复用边界）：

1. **组件库复用、模式复用、不继承 InteractiveMode**：pi 的交互模式是单会话
   聊天视图，与多会话编排仪表盘不匹配；但其"session.subscribe → 组件更新"
   模式与 pi-tui 组件库（VStack/ScrollView/Input/overlay/键位系统）全部复用。
2. **事件总线解耦**（`src/tui/events.ts`）：RSI 循环只依赖 typed 事件回调
   `emit?`，headless 路径零改动；`RunSnapshot` reducer 把事件流聚合成头部
   状态。TUI 只是事件的一个订阅者（未来可加 RPC/watch 前端）。
3. **纯函数渲染可测试**：组件 `render(width)` 无副作用 → `npm run tuitest`
   75 项无 TTY 验证（reducer/命令解析/日志行/Header 渲染/AltScreen 全管线/

   overlay/窄终端安全/真实 journal 回放合成）。
4. **控制通道**：`RunController`（暂停门+停止标志）在循环安全点轮询
   （代际间/幸存者评测前/heldout 前），TUI 输入即改标志；反馈走
   FEEDBACK.md 与 headless 用法同构。
5. **回放模式**：journalToEvents 把 board.jsonl 合成为与实时相同的事件流，
   同一 UI 渲染——零成本演示/调试/回归。

## 长跑保障

1. **崩溃安全**：任何一行崩溃都留下合法前缀（append-only + fsync；快照 tmp+rename）
2. **续跑**：state.json 记录代数/冠军/历史/停滞计数；指纹不匹配拒绝续跑（防配置漂移）
3. **止损**：stagnation_limit 停滞停跑；cost_cap_tokens 预算停跑；单 episode 墙钟硬顶
4. **防挂死**：每 prompt 墙钟 + stall 双看门狗；python 子进程 120s 超时
5. **防泄漏**：agent 工作区只拷贝 data/；eval 脚本与私有真值均不可达；公开分才进提示

## 演进：外部基准、统一模型层、知识库与诚实性基础设施（2026-08-25，v1.1）

### 外部基准接入（A/B 级）

原 5 题合成套件之外，新增两条题目机制，全部走同一 `##SCORE##` 协议与
`problems/<id>/problem.json` 覆盖项：

- **quiz 批量模式**（`scripts/quiz_build.py`）：外部题库切块成批，一 chunk 一题；
  题目在 `data/quiz.jsonl`（agent 可见），金标答案在 `answers.private.jsonl`
  （不拷入工作区）；提交 = submit 工具交 answers.json，eval_cap=2，未答即错。
  套件经 `config/<suite>.problems.json` 注册，`config.json` 的 `problems_file`
  指向即可整卷运行。已接：earthse / k2 / mapqa / gkmc / stepgame / mgq。
- **judge/oracle 模式**（`scripts/gab_build.py`、`gbx_build.py`）：
  GeoAnalystBench 走 oracle 参考解 → LLM judge 链；GeoBenchX 走工具链 judge，
  正确拒绝得确定性 1.0。共享缓存 judge（`problems/_shared/judge.py`，
  model+prompt 为键），judge 凭据只在 eval 侧存在。

设计取舍：quiz fitness 是知识有界的，衡量的是"策略能否把已有知识稳定兑现"，
不是能力上限；公开分探测风险靠守卫缓解而非根除（见下）。

### 统一模型调用层

`config/model-profiles.json` 是唯一事实源（实测探针数据版本化），TS 侧
`src/models.ts` 与 Python 侧 `problems/_shared/model_client.py` 都从它读取：
推理参数风格翻译（effort / 对象 / thinking_budget 三派）、等级钳制、视觉位、
端点路由。`PiHarness` 在会话创建前钳制 thinkingLevel 并记录降级；provider 按
 profiles 输出 models.json 能力位。OpenRouter 的旧 `stealth/ox-alpha` alias
 已于 2026-08-27 退役，当前替代模型为 `z-ai/glm-5.3-flash`；人类视图见
 `docs/MODELS.md`。

### 标签知识库（跨 run 进化记忆）

`src/knowledge.ts`：每个经验教训是一个带 region/genre 标签的节点，
检索 = 标签求交 + 效用排序 + 字符预算硬顶——"图"的语义、"JSONL"的实现。
确定性契约：同 store 版本 + 同题 ⇒ 同注入集（重评测同分）；统计更新只在
episode 结束后发生，不再中途污染评测。

### 执行隔离与诚实性基础设施（防 reward-hacking）

Windows strict backend 由 `src/sandboxie.ts` 适配已安装的 Sandboxie-Plus，
不自行实现文件虚拟化、进程注入或 WFP。每个 episode 使用独立的 ASCII box，
并把模型可控的文件交换目录放在仓库外的绝对 `%TEMP%\\GeoRSI\\episodes\\`
路径。`SbieIni` 写入完整 repo/private deny、credential deny、exchange allow
和 network block 规则后必须执行 `/reload`，再通过 query 回读验证。

启动前还会用 `/listpids` 证明 Python 根进程确实属于该 box，并用未列举的 repo
文件、private root 和真实 HTTPS 请求做阻断探测；任何成功访问都 fail-closed。
`/box` 用于把根进程放入命名 box；Sandboxie 的 `/fcp` 是“根进程在外部、只强制
未来子进程”的语义，因此不放在 GeoRSI 的外层 root launch，避免反向绕过隔离。
正常父进程继承仍保证子进程跟随。`delete_sandbox_silent` 是 `/box:<name>` 后的
命令 token，不是 slash-prefixed option。

`host-audit` 仍保留 guard 机制但不宣称 OS 隔离：工作区硬围栏（resolve+包含判定，
堵住旧正则放行 `../` 的洞）、官方 pi 文件工具的 symlink-aware operations、eval
侧文件完整性 manifest、episode 后受保护路径扫描和 judge 凭据剥离仍然有效。
严格 Sandboxie 还会清除 provider/judge credential、proxy、Python/Node path 注入环境变量，
并拒绝位于 repo/private root 内的 `python_cmd`；GIS venv 必须预先安装在受保护根之外。
正常完成、timeout、background kill、uncaught/unhandled fatal error 和 Node exit
handler 都会做同步/验证清理；但外部 `taskkill /F`、断电或内核崩溃无法执行
用户态清理，之后必须重新查询 enabled boxes 并运行 Sandboxie selftest。严格模式
在清理不确定时不会回退到宿主机。Sandboxie 是 app-level isolation，不是 VM-level security。

### GIS Python 运行时要求

GIS 题目可以通过 `python_cmd` 指定解释器，但 strict Sandboxie 只接受位于
`F:/rsi-lab/` 和 `F:/rsi-lab-private/` 两棵根目录之外的解释器或虚拟环境。
位于仓库内的 `.gisenv/Scripts/python.exe` 会在创建 box **之前**被拒绝；GeoRSI
不会回退到宿主机 Python，而是让该 episode fail-closed。应把 GIS venv 安装或
复制到仓库外并将 `python_cmd` 指向它；如果确实需要使用仓库内 venv，只能
显式选择 `host-audit`，该模式不是 OS sandbox。Windows 上可以用
`robocopy F:/rsi-lab/.gisenv F:/GeoRSI/venvs/gis /E /COPY:DAT /DCOPY:DAT`
完成一次迁移；benchmark builder 支持通过 `GEORSI_GIS_PYTHON` 指定未来
生成的 `problem.json` 路径。

### 按题覆盖项

`problem.json` 可按题覆盖 config 旋钮（type/judge/python_cmd/超时/max_turns/
eval_cap 等），合并优先级高于全局配置——quiz 批量、长任务、GIS venv
等特例不再需要改全局配置；但 strict Sandboxie 下的 `python_cmd` 必须指向
repo/private root 之外的解释器。

### Scope tip pilot

2026-08-27 在相同的 GLM-5.3 Flash、题集和预算下完成了 seed / universal-tip /
scoped-tip 三臂 pilot。5/5/5 小样本均值分别为 0.6667 / 0.5333 / 0.6667；
该结果只说明当前切片上 scoped tips 没有观察到额外增益，不能替代多 seed
大样本复验。完整记录见 `docs/SCOPE-PILOT.md`。
