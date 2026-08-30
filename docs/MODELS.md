# 模型能力档案与统一调用层

> 实测日期 2026-08-28。探针：`scripts/model_probe.py`（稳定性/文本）、`scripts/model_probe2.py`（真图视觉/扩展等级）。
> 测量条件声明：部分数据在演化 run 并发压网关时采集；旧 `stealth/ox-alpha` alias 于 2026-08-27 返回 HTTP 404，已停止使用。
> **机器可读单一事实源：`config/model-profiles.json`** —— TS（`src/models.ts`）与 Python（`problems/_shared/model_client.py`）两侧适配器都从它读取；本文档是 human view。

| 模型 | 端点 / 协议 | 推理 | 当前角色 |
|---|---|---|---|
| **gpt-5.6-luna** | ai-pixel / **Responses API** | benchmark 固定 `xhigh`；live 生效性仍需 probe | 唯一获准的新模型调用；inner/outer/planner/verifier/报告 |
| hy3 | zen / chat-completions | low..xhigh | 历史配置；Luna-only campaign 禁止调用 |
| mimo-v2.5 | zen / chat-completions | low..high | 历史配置；Luna-only campaign 禁止调用 |
| GLM-5.3 Flash | OpenRouter / chat-completions | mandatory | 历史配置；Luna-only campaign 禁止调用 |
| dsv4f | local / chat-completions | effort/budget | 历史配置；Luna-only campaign 禁止调用 |
| muse-spark | zen / Responses API | 不支持 reasoning 参数 | 历史配置；Luna-only campaign 禁止调用 |

> Luna 的 provider 配置来自用户提供的能力声明；在 Responses、tool-loop、usage 和 `xhigh` 生效性 probe 完成前，档案保持 `unverified-ai-pixel`。任何出现在对话、命令行或日志中的 key 都必须撤销。新 key 只从 `AI_PIXEL_API_KEY` 读取，项目不支持 ai-pixel key 文件 fallback。

## 一、历史能力总览矩阵

| 能力 | hy3 | mimo-v2.5 | GLM-5.3 Flash | dsv4f (Qwen3 本地) | muse-spark |
|---|---|---|---|---|---|
| 端点 / 协议 | zen / chat-completions | zen / chat-completions | OpenRouter / chat-completions | 校园本地 / chat-completions | zen / **Responses API** |
| 稳定性（当日实测） | 优（12+/12+ 零断连） | 良（高负载偶掉线） | 200 OK probe；新基线待建立 | 优（本地零失败） | 差（SSL 抖动，需重试） |
| 延迟（琐碎请求 mean） | ~2.6s | ~7.9s（p95 22s） | low/plain probe 可用 | **~0.18s** | 未定榜 |
| 定量推理 | ✓ | ✓ | ✓ | ✓ | 未验证 |
| JSON 单对象纪律 | 可用（生产验证） | 生产可用 | 可用 | 可用（快但需验质量） | 未验证 |
| **视觉输入（原始 API）** | ✗（全零幻觉） | **✓（3/4，文字细节弱）** | ✓（catalog: text/image/video） | ✗ 服务端 `vision_disabled` | 未验证 |
| 视觉（我们 harness 内） | ✗ | ✗ | ✗ | ✗ | ✗ —— models.json 全部接线 `input:["text"]`，升级路径见 §四 |

## 二、推理等级（核心差异区）

参数风格两派 + 一个特例：
- **A. effort 风格** `reasoning_effort: <lv>`：zen 三模型、dsv4f（部分档）
- **B. 对象风格** `reasoning: {effort: <lv>}`：多数端点也收，但常被静默钳制（延迟无差）
- **C. 预算风格** `thinking_budget: <tokens>`：**dsv4f 独有且真实生效**
- **D. emooo/z.ai 风格** `thinking: {type: "enabled"|"disabled"}` 加 `reasoning_effort: <lv>`：临时 `mimo-v2.5-pro`

### 各模型实际支持

| 模型 | A 风格接受 | B 风格 | 行为验证 | 禁忌 |
|---|---|---|---|---|
| hy3 | minimal/none/low/medium/high/**xhigh** ✓；`off`、`max` 显式拒绝 | 收下但多被钳制 | 各档延迟 3-11s 有波动 | `max` 别用 |
| mimo-v2.5 | none/low/medium/high ✓；minimal/off/xhigh/max 参数报错 | 全收下（含 xhigh/max），答案正确但无法证明真生效 | none 下数学题答错 | **none/off 禁用于定量任务**；xhigh 只走 B 且不保证真生效 |
| mimo-v2.5-pro (emooo) | off（thinking disabled）/minimal/low/medium/high/xhigh ✓；max、none 不用 | `thinking: {type: enabled, clear_thinking: false}` + `reasoning_effort` | chat/completions 200；Responses 也 200 但较慢；Pi tool-call 已验证 | 不要发送 `reasoning_effort=max/off`；密钥只放 `RSILAB_EMOOO_API_KEY` |
| ox-alpha-free | retired | retired | retired | — |
| GLM-5.3 Flash | low/high/max | reasoning mandatory | 200 OK plain/low probe | fresh agent baseline required |
| dsv4f | low/medium ✓；high 显式不支持；**xhigh 意外接受** | 全收但恒定延迟=钳制 | **C 风格真实生效**：budget=16384 时思考字符 4704→9741、延迟 13→29s | high(effort)；none 掉智力 |
| muse-spark | **一律 400**（不得带任何推理参数） | 同左 | — | 必须无推理参数 |

### "max/xhigh" 的两种真实形态

1. zen 网关：`reasoning_effort: "xhigh"`（仅 hy3 验证通过）
2. 本地 dsv4f：**`thinking_budget: <token 数>`** —— 上限式预算控制（预算给足但题目不需要时不会用满），这是该服务器唯一真实的深度调节通道

## 三、角色适配建议

| 角色 | 要求 | 首选 | 备注 |
|---|---|---|---|
| inner 解题 agent | 长程工具纪律 + 深度推理 | mimo-v2.5（thinkingLevel low/medium） | 正在 k2evo-mimo 实战 |
| outer 提案 / critic | 快 + JSON schema 纪律 | hy3 | 批评可同款 |
| judge 评分裁判 | 极快极稳、判定式输出 | dsv4f 候选（175ms vs hy3 2.5s）；切换前须与已缓存 hy3 判定做一致性对照 | judge 缓存键=model+prompt，换模型=新缓存，旧判定不失效 |
| goal 门控 | 低频稳定 | hy3 | |

## 四、已知残余与升级路径

1. **视觉能力闲置**：GLM/mimo 原始 API 支持图像，但 models.json 接线仍以 text-only 为主。启用步骤：provider 的 `buildModelsJson` 按 profiles 的 `vision:true` 输出 `input:["text","image"]` 并验证 pi 图像消息透传（对 GABench 类看图任务是前置条件）。
2. **TS Pi harness 对模型级参数保持 fail-closed**：pi-ai 可原样传递显式映射的 hy3 `xhigh`、GLM `max` 和 emooo `xhigh`；但当前 TS harness 无法序列化 dsv4f 专用 `thinking_budget`，因此 dsv4f `xhigh/max` 会在请求前拒绝，而不是静默折叠成该服务不支持的 `high`。Python direct client 仍支持已验证的 budget 通道。
3. **旧 OpenRouter alias 已退役**：`stealth/ox-alpha` 于 2026-08-27 返回 HTTP 404，并指向 `z-ai/glm-5.3-flash`；旧分数只用于历史解释，不用于新实验。
4. muse 调用必须带重试纪律（SSL EOF 瞬态，实测 3 试 2 败 1 成）。

## 五、统一调用层

- 数据：`config/model-profiles.json`（版本化；本文件与其同步更新）
- TypeScript：`src/models.ts` → `resolveThinking(model, wanted)`（等级钳制+参数翻译）、`assertVisionAllowed(model)`、`chatDirect(...)`（直连统一方法，带退避重试）
- Python：`problems/_shared/model_client.py` → `complete(model, messages, level=...)`（同一档案、同一适配规则；judge.py 接线在演化 run 结束后切换，避免中途改评分路径）
- 接线点：`PiHarness` 用 `resolveThinking` 在会话创建前钳制 thinkingLevel 并记录降级；provider 按 profiles 输出 models.json 的能力位
- Judge：`problems/_shared/judge.py` 默认发送 `reasoning_effort=low`（可由
  `RSILAB_JUDGE_REASONING_EFFORT` 覆盖），避免推理模型把 `max_tokens` 全部耗在
  隐式思考而返回空的可见裁决；该规则不改变缓存键，只影响新请求。

## 六、OpenRouter：z-ai/glm-5.3-flash（2026-08-27 接入）

| 项 | 实测 |
|---|---|
| 端点 | `https://openrouter.ai/api/v1`（密钥 `api_key_or.txt`，已 gitignore） |
| 计费 | OpenRouter 低价档（catalog verified 2026-08-27） |
| 稳定性/延迟 | catalog live；plain/low completion probe 均 200 OK |
| 上下文/输出 | top provider 1,048,576 / 131,072 |
| 模态 | **text+image+video**（原始 API；harness 内仍接线 text-only） |
| 推理 | **强制开启**；catalog 支持 low/high/max，统一层默认使用 low |
| 实际 Pi probe | `quake_b`: public 0.86、private 0.84、约 49k token、约 122s；第二次 private 0.922、约 19k token、约 66s |
| 当前结论 | 可用于新实验；quiz/scoped 三臂 fresh baseline 尚待完成 |

角色建议：当前 quiz/scoped 实验 inner 候选；长任务仍需 episode watchdog 和提交预算硬闸门观察。

### mimo-v2.5-pro（临时 emooo.cc 路由，2026-08-28 实测）

| 项 | 实测 |
|---|---|
| Base URL | `https://api.emooo.cc/v1` |
| 模型 | `mimo-v2.5-pro` |
| `/chat/completions` | **200 OK**；Pi streaming/tool-call 已验证 |
| `/responses` | **200 OK**；基础请求可用，但同一小请求约 12.2s，慢于 chat 的约 7.6s |
| 上下文 / 输出 | 1,048,576 / 131,072（按服务方信息；GeoRSI 默认单请求仍受自身 cap 约束） |
| 推理开关 | `thinking: {type: "enabled"|"disabled"}` |
| 推理档位 | `minimal` / `low` / `medium` / `high` / `xhigh` 均 200 OK；`max` 不支持 |
| GeoRSI 接线 | `openai-completions` + `compat.thinkingFormat="zai"`；enabled 发送 `thinking.type=enabled`、`clear_thinking=false` 和 `reasoning_effort` |
| 密钥 | 仅使用环境变量 `RSILAB_EMOOO_API_KEY`（不写入源码或 config.json） |

选择 **chat/completions**：两个端点都能用，但 chat 更快，且 pi 的流式输出、工具调用和
多轮消息链路已经实测通过。GeoRSI 中暂不把该模型设为默认，只作为临时可选模型；推荐
`thinkingLevel=low`，需要更深推理时使用 `medium` / `high` / `xhigh`。`off` 会映射为
`thinking: {type: "disabled"}`；`max` 会在统一层钳制到 `xhigh`，不会发送服务端不支持的
`reasoning_effort=max`。

启动前设置密钥并选择模型：`config/emooo-mimo-pro.json` 是不含密钥的临时配置，
其中 `inner_thinking_level` / `outer_thinking_level` 可写 `off`、`minimal`、`low`、
`medium`、`high`、`xhigh` 或 `max`；统一层会依据 profile 做钳制，绝不把
网关明确拒绝的 `max` 发送出去。

```powershell
$env:RSILAB_EMOOO_API_KEY="<temporary-key>"
$env:RSILAB_REQUEST_MAX_TOKENS="8192"  # 可选：缩短长推理单轮上限
npm run smoke -- --config config/emooo-mimo-pro.json
```

短 GeoRSI Sandboxie smoke（2026-08-28，`quake_b`，`inner_thinking_level=low`）已真实跑通：
`fitness=0.9674`、`public=0.7326`、`submits=1`、`turns=1`，约 537 秒。Sandboxie
探针仍为 repo/private/network 全部 `BLOCKED`，cleanup 为 terminated/deleted/reloaded
且 `boxStillEnabled=false`、`globalWfpRestored=true`。该轮模型在写出候选文件后因
`stopReason=length` 未发出工具调用，由 driver 通过同一个 public submit 路径恢复，
episode.json 明确记录 `submissionRecovery="candidate-file-driver"`；这证明接线和
隔离链路可用，但不应把这一次 smoke 当作模型质量排名。

不要把真实 key 写入 Git；本轮 key 已在命令行探针中使用，建议测试完成后轮换。

### hy3 作为 inner 的负结论（2026-08-25 实测）
quiz 批量任务 12 轮零提交：唯一产物是"枚举题号"脚本，从未开始作答。hy3 的舒适区是外层式短爆发（JSON 单对象、提案、判定），**不适配 inner 的长程产出管线**（100 题答案表）。角色矩阵维持：hy3 只任 outer/judge 备选，inner 使用 GLM fresh baseline 或 mimo fallback。

### inner 角色实测补充（2026-08-27）
- **hy3**：quiz 批量 12 轮零提交（只写枚举脚本）——不适配长程产出管线
- **ox-alpha-free / stealth/ox-alpha**：2026-08-27 退役/404，不再启动
- **z-ai/glm-5.3-flash**：标准 `quake_b` Pi probe 成功；quiz/scoped 任务仍需 fresh baseline
- 结论：inner 可靠性暂按 **mimo-v2.5（已知） + GLM fresh baseline（当前候选）** 管理

### z-ai/glm-5.3-flash 通道中断（2026-08-27 深夜实测）
- **402 余额墙**：scope-final 三臂（22:25–22:38）在 glm 上全部成功；约一小时后
  rag-on 臂（prompt 略大）被 OpenRouter 预检拒绝——"requested up to 16384 tokens,
  but can only afford 6958"（`limit_source=openrouter_credits`）。余额将尽时，
  prompt+max_tokens 的预检先于小 prompt 失败，表现为"更大的请求先死"。
- **随后 401 ModelError "not supported"**：同一 key 小请求复测 glm 返回 401
  （mimo-v2.5 / hy3 同刻正常）。glm 在 zen 网关上的可用性当晚发生翻转，原因在
  供应商侧。
- **处置**：当夜 RAG 对照双臂与 RSI 探针改道 `mimo-v2.5`（zen 原生路由，16k
  headroom 探针通过）；glm 恢复（充值 OpenRouter credits 或网关回滚）前不再选它
  做 inner。scope-final 三臂结论不受影响（其 glm 会话当时全部真实完成）。

### minimax/minimax-m3:free（2026-08-26 接入，OpenRouter 第二模型）
- **速度**：~2.5s（琐碎题），长生成 12.7s/4300 字符——免费档里最快
- **稳定性**：6/6 零 429（免费档中最干净；密钥已轮换为第二把）
- **推理**：默认自带思考（`reasoning` 字段）；effort 风格 low/medium/high 全收；参数出现时附 `reasoning_details`
- **JSON 纪律**：精确单对象
- **视觉**：**已验证可用**（标准场景 4/4 + 大图纯色正确）。此前误判不可用——8×8 探针图过小被吞；教训：视觉探针图 ≥256px
- **stream 决策（实测依据）**：流式与非流式总耗时完全相同（12.7s vs 12.7s，生成速度在服务端）；采纳方案 = **默认非流式 + 断连自动降级流式**（`model_client._stream_complete`，针对长生成空闲超时断连，此前实测过 60s RemoteDisconnected）
- 上下文 1M / maxOutput 按我们统一 131k 上限（官方免费档标称 943k，防御性收紧）
- 角色建议：免费档 outer 备选 / 轻量批量任务；inner 待代理行为实测（stealth/ox 的教训：单轮探针好≠代理循环行）
