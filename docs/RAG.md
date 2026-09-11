> **状态：未来设计（v0.1 未实施）。** 词法-语义三元组重排已先行落地（#84，`src/research/context-memory.ts`）；embedding 语义检索待网关支持后按本设计的反污染铁律实施。

# RAG 检索层设计 v0.1（反污染铁律内置）

## 定位

给 solver 补"模型不知道的"，补的是**知识与方法的检索**，不是答案的检索。
与知识库的关系：knowledge/nodes.jsonl 管"演化出的策略教训"（短、带统计）；
RAG corpus 管"稳定的领域参考内容"（长、静态、来源可溯）。两者经同一个
region 路由注入 prompt 的不同区块，互不混写。

## 反污染铁律（构建器断言级，违者构建失败）

1. **题面不入库**：任何 benchmark 的 question/statement 原文不得成为语料
2. **金答案与其变换不入库**：gold answer、reasoning_chain、Result 列禁止索引
3. **同源派生受限**：从训练 split 提炼的内容必须是"抽象原则"形态
   （不含原题文字、不含可复现答案的数值），且标注 `derived: true`
4. **来源必须可溯**：每个文档块记录 source（URL/书名+页/文件路径）与 license

## 语料结构

```
rag/corpus/
  manifest.json          # 全局索引：id, region[], source, license, derived
  <region>/
    <doc-id>.md          # 一个独立知识单元（200-800 字为宜）
```

region 取值与知识库 tags 同词汇表（structural_geology / map_projection /
hydrology / gis_tooling / ...），路由直接复用 deriveTags。

## 检索接口（第一阶段：确定性关键词匹配）

```
src/retrieval.ts:
  retrieve(region: string, queryTerms: string[], budgetChars): DocBlock[]
    - 语料加载 + manifest 校验
    - 命中 = region 交集 ∧ 关键词计分
    - 按 score 截断到预算（与知识注入同预算池）
```

LLM/embedding 检索留待第二阶段——先用确定性方案拿基线。

## 种子语料（本仓自带、零污染、立即可用）

- 地图投影与坐标系速查（UTM/经纬度/常见 CRS 陷阱）
- 常用地学公式（坡度坡向、Haversine、人口密度换算、单位换算表）
- GIS 工具链惯用法与陷阱（shapefile sidecar、CRS 重投影顺序、空几何处理）
- 空间推理术语表（方位角 vs 象限角、左手/右手系约定）

## 明确不做

- 不抓取需要授权的内容
- 不为"提高 benchmark 分数"定向收录 benchmark 配套材料
- 不在无赛制确认前引入推理时网络检索依赖

## 与 scope 实验的关系

2026-08-27 的 scope tip pilot 将 `rag_enabled` 显式设为 `false`，因此其
seed / universal-tip / scoped-tip 分数不包含 RAG 增益。RAG 已通过无 LLM
自检验证加载、区域路由、字符预算和反污染标记；下一阶段应单独做
`RAG off/on` 对照，不能把 scope tip 结果当作 RAG 结果。

## 首次 off/on 对照（2026-08-28 凌晨，mimo-v2.5 内核）

glm 通道当晚断裂（OpenRouter 402 余额墙 → 网关 401，见 MODELS.md），对照
改在 mimo-v2.5 上进行。两臂同夜、同 env、同 slice（`*_scope_mimo_5`，与
scope pilot 同分布同题）、串行执行、隔离 KB/judge 缓存；`RSILAB_REQUEST_MAX_TOKENS=32768`
（mimo 单轮"推理+脚本+答案表"在 16384 闸下会 `stopReason=length` 报死）。
seed scaffold（A 臂、无 tips），`rag_budget_chars=2400`。

| 任务 | off fitness | off 用时 | on fitness | on 用时 |
|---|---:|---:|---:|---:|
| stepgame_5 | 0.8000 | 920s | **1.0000** | **174s** |
| mapqa_5 | 0.2000 | 1500s(触顶) | 0.2000 | 986s |
| k2_5 | 1.0000 | 51s | 1.0000 | 43s |
| **均值** | **0.6667** | 2471s | **0.7333** | 1203s |

解读（谨慎）：

1. 分数差 +0.0667 = stepgame 多对 1 题（每任务仅 3 道 private 题），**不具
   统计显著性**；方向与 scoped-tip 臂一致但量级在噪声带内。
2. **稳定的信号是效率**：总用时 2471s → 1203s（约减半），stepgame 单题
   920s → 174s。检索注入的参考材料看起来让 inner 跳过了大量探索性脚本。
   在按墙钟计费/限流的场景，这本身就是收益。
3. 反污染链路完整：struct_selftest 断言（qid/题面/选项表三重比对）通过，
   episode 日志 `[rag]` 行只出现 authored 语料。
4. 下一步：多样本（≥3 episodes/格）+ glm 恢复后重跑，区分"知识增益"与
   "聚焦效应"；再考虑接入 GIS 开放题（agent-evo5 wave1）。

复现：`config/scope-pilot5-A-mimo-off.json` / `config/scope-pilot5-A-mimo-rag.json`，
run 产物 `runs/rag-mimo2-off` / `runs/rag-mimo2-on`。
