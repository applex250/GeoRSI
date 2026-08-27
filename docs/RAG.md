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
