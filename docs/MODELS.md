# 模型能力档案与统一调用层

> 实测日期 2026-08-25。探针：`scripts/model_probe.py`（稳定性/文本）、`scripts/model_probe2.py`（真图视觉/扩展等级）。
> 测量条件声明：部分数据在演化 run 并发压网关时采集，延迟与 SSL 抖动偏高；ox-alpha-free 当日源端降级（503 风暴），其等级特征不可信。
> **机器可读单一事实源：`config/model-profiles.json`** —— TS（`src/models.ts`）与 Python（`problems/_shared/model_client.py`）两侧适配器都从它读取；本文档是 human view。

## 一、能力总览矩阵

| 能力 | hy3 | mimo-v2.5 | ox-alpha-free | dsv4f (Qwen3 本地) | muse-spark |
|---|---|---|---|---|---|
| 端点 / 协议 | zen / chat-completions | zen / chat-completions | zen / chat-completions | 校园本地 / chat-completions | zen / **Responses API** |
| 稳定性（当日实测） | 优（12+/12+ 零断连） | 良（4/4，高负载偶掉线） | **差（503 风暴）** | 优（本地零失败） | 差（SSL 抖动，需重试） |
| 延迟（琐碎请求 mean） | ~2.6s | ~7.9s（p95 22s） | ~2s（可用时） | **~0.18s** | 未定榜 |
| 定量推理 | ✓ | ✓ | ✓ | ✓ | 未验证 |
| JSON 单对象纪律 | 可用（生产验证） | 生产可用 | 可用 | 可用（快但需验质量） | 未验证 |
| **视觉输入（原始 API）** | ✗（全零幻觉） | **✓（3/4，文字细节弱）** | **✓（4/4 全对）** | ✗ 服务端 `vision_disabled` | 未验证 |
| 视觉（我们 harness 内） | ✗ | ✗ | ✗ | ✗ | ✗ —— models.json 全部接线 `input:["text"]`，升级路径见 §四 |

## 二、推理等级（核心差异区）

参数风格两派 + 一个特例：
- **A. effort 风格** `reasoning_effort: <lv>`：zen 三模型、dsv4f（部分档）
- **B. 对象风格** `reasoning: {effort: <lv>}`：多数端点也收，但常被静默钳制（延迟无差）
- **C. 预算风格** `thinking_budget: <tokens>`：**dsv4f 独有且真实生效**

### 各模型实际支持

| 模型 | A 风格接受 | B 风格 | 行为验证 | 禁忌 |
|---|---|---|---|---|
| hy3 | minimal/none/low/medium/high/**xhigh** ✓；`off`、`max` 显式拒绝 | 收下但多被钳制 | 各档延迟 3-11s 有波动 | `max` 别用 |
| mimo-v2.5 | none/low/medium/high ✓；minimal/off/xhigh/max 参数报错 | 全收下（含 xhigh/max），答案正确但无法证明真生效 | none 下数学题答错 | **none/off 禁用于定量任务**；xhigh 只走 B 且不保证真生效 |
| ox-alpha-free | 当日源端病态，散乱 server_error | 同左 | 无法可信刻画 | 复测后再定 |
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

1. **视觉能力闲置**：mimo/ox-alpha-free 原始 API 支持图像，但 models.json 接线 text-only。启用步骤：provider 的 `buildModelsJson` 按 profiles 的 `vision:true` 输出 `input:["text","image"]` 并验证 pi 图像消息透传（对 GABench 类看图任务是前置条件）。
2. **harness thinkingLevel 枚举无 xhigh/thinking_budget**：`src/models.ts` 的 `resolveThinking()` 已按 profiles 做钳制与参数翻译；pi 会话内目前只透传 low/medium/high。
3. **ox-alpha-free 源端波动**：当日曾 503 风暴后恢复（稳定 4/4、json 2/2）；推理等级特征仍需干净复测。历史基线由它创造，源端波动期数字不可复现，记入残余风险。
4. muse 调用必须带重试纪律（SSL EOF 瞬态，实测 3 试 2 败 1 成）。

## 五、统一调用层

- 数据：`config/model-profiles.json`（版本化；本文件与其同步更新）
- TypeScript：`src/models.ts` → `resolveThinking(model, wanted)`（等级钳制+参数翻译）、`assertVisionAllowed(model)`、`chatDirect(...)`（直连统一方法，带退避重试）
- Python：`problems/_shared/model_client.py` → `complete(model, messages, level=...)`（同一档案、同一适配规则；judge.py 接线在演化 run 结束后切换，避免中途改评分路径）
- 接线点：`PiHarness` 用 `resolveThinking` 在会话创建前钳制 thinkingLevel 并记录降级；provider 按 profiles 输出 models.json 的能力位

## 六、OpenRouter：stealth/ox-alpha（2026-08-25 接入）

| 项 | 实测 |
|---|---|
| 端点 | `https://openrouter.ai/api/v1`（密钥 `api_key_or.txt`，已 gitignore） |
| 计费 | **免费档**——突发 429，需间隔与退避（统一层 retryPlan 已按 C 级处理） |
| 稳定性/延迟 | 机制稳定 4/4，mean ~4.6s |
| 上下文/输出 | 官方 1,048,576 / 131,072 |
| 模态 | **text+image+video**（原始 API；harness 内仍接线 text-only） |
| 推理 | **强制开启**（`enabled:false` → 400 "Reasoning is mandatory"）；effort 风格 low~max 全接受 |
| ⚠️ 质量警告 | 必对题在 effort.high/xhigh 与无参数时答错过（75/2）；low/medium 与对象风格稳定正确——**建议只用 low/medium** |
| 特色 | `reasoning_details` 列表原样回传 assistant 消息可跨轮延续推理（实测通过：暗记数字两轮后正确回忆） |
| JSON 纪律 | 干净（单对象一次过） |

角色建议：免费备胎/低频批量任务（限速档不适配高频 inner 循环）；视觉与 reasoning_details 连续性是超出 zen 系的独有能力，留给需要的工作流。

### hy3 作为 inner 的负结论（2026-08-25 实测）
quiz 批量任务 12 轮零提交：唯一产物是"枚举题号"脚本，从未开始作答。hy3 的舒适区是外层式短爆发（JSON 单对象、提案、判定），**不适配 inner 的长程产出管线**（100 题答案表）。角色矩阵维持：hy3 只任 outer/judge 备选，inner 用 ox-alpha-free（快）或 mimo（稳）。

### inner 角色实测补充（2026-08-25 晚）
- **hy3**：quiz 批量 12 轮零提交（只写枚举脚本）——不适配长程产出管线
- **ox-alpha-free（zen）**：晚间接手后 14 轮零工具调用（同日中午还正常）——源端代理行为间歇性退化，inner 使用前需先跑 emitcheck 类小探针
- **stealth/ox-alpha（OpenRouter）**：gbx 快题 5 轮零产物——免费档限速+强制推理开销压垮代理循环，**仅任 outer 备选/judge，不当 inner**
- 结论：inner 可靠序列当前为 **mimo-v2.5 > ox-alpha-free（需探针确认）**
