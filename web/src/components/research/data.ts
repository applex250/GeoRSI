export interface WorkNode {
  id: string; kind: string; title: string; state: string; dependsOn: string[];
  attempts?: number; failureMessage?: string; startedAt?: string; completedAt?: string;
  outputArtifactIds?: string[];
}
export interface Run {
  id: string; name: string; status: string; mode: string; createdAt?: string;
  timing?: { elapsedSeconds: number }; progress?: { completedNodes: number; totalNodes: number; percent: number };
  error?: string;
  phase?: string;
  workspace?: { phase: string; iteration: number; modelCalls: number; totalTokens: number; iterations: Array<{ round: number; summary: string }>; review?: string };
}
export interface Deliverable { name: string; downloadUrl: string; bytes: number }
export interface RoundInfo {
  round: number; completed: boolean;
  review: { complete: boolean | null; summary: string; next: string | null };
  reportAvailable: boolean; reportUrl: string | null;
}
export const labels: Record<string, string> = {
  pending: "等待中", ready: "待执行", running: "执行中", verifying: "验证中", completed: "已完成",
  failed: "未完成", blocked: "受阻", cancelled: "已停止", queued: "排队中", stopping: "正在停止", paused: "已暂停", pausing: "正在暂停",
  "frame-question": "问题界定", "value-assessment": "研究价值评估", "literature-search": "文献检索", hypothesis: "构建假设",
  "data-acquisition": "数据检索", "data-audit": "数据质量检查", "quantitative-analysis": "定量分析", "gis-analysis": "时空分析",
  sensitivity: "敏感性分析", verification: "交叉验证", synthesis: "结果综合", report: "报告撰写", presentation: "成果整理", defense: "结论核查",
};
export const exampleQuestion = "分析青藏高原近二十年的植被变化及其气候驱动因素";
export const examples = [exampleQuestion, "探索汶川地震前后滑坡分布与地形的关联", "研究长江流域极端降水的时空变化特征"];
export const demoNodes: WorkNode[] = [
  { id: "frame", kind: "frame-question", title: "界定研究范围", state: "completed", dependsOn: [] },
  { id: "data", kind: "data-acquisition", title: "多源数据检索", state: "completed", dependsOn: ["frame"] },
  { id: "audit", kind: "data-audit", title: "数据质量检查", state: "completed", dependsOn: ["data"] },
  { id: "analysis", kind: "gis-analysis", title: "植被时空分析", state: "running", dependsOn: ["audit"] },
  { id: "climate", kind: "quantitative-analysis", title: "气候驱动归因", state: "ready", dependsOn: ["audit"] },
  { id: "verify", kind: "verification", title: "交叉验证", state: "pending", dependsOn: ["analysis", "climate"] },
  { id: "report", kind: "report", title: "综合研究报告", state: "pending", dependsOn: ["verify"] },
];
export const demoReport = `# 青藏高原植被变化及其气候驱动因素

> 界面演示报告 · 以下为展示结构的示例内容，不是真实研究结论。

## 摘要

本研究拟结合长时间序列遥感观测与气候再分析数据，分析青藏高原植被变化的空间分异，并识别温度与降水对植被活动的潜在影响。

重点关注三个问题：植被覆盖如何变化，变化发生在哪里，以及哪些气候因素可能解释这些变化。

## 01 研究区域与数据

研究范围为青藏高原，时间窗口为 2001—2023 年。计划对遥感植被指数、气象数据和地形数据进行统一的空间配准与质量控制。

| 数据类型 | 候选数据源 | 研究用途 |
| --- | --- | --- |
| 植被指数 | MODIS NDVI | 植被变化趋势 |
| 气温与降水 | ERA5-Land | 气候驱动分析 |
| 地形 | 数字高程模型 | 海拔分层分析 |

## 02 方法框架

1. 对时间序列进行质量筛选、缺测处理与年度聚合。
2. 使用稳健趋势估计与显著性检验识别变化区域。
3. 控制地形与空间差异，比较温度和降水的解释作用。
4. 改变时间窗口和筛选阈值，验证结论的稳健性。

## 03 结果与讨论

正式运行后，此处将展示经过验证的分析结果、图表与证据引用。演示模式不生成实际统计结果。

## 04 局限性

云污染、积雪和传感器差异可能影响观测一致性。统计关联不能直接等同于因果关系，结论需要结合数据覆盖与不确定性解释。
`;

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`请求失败 (${response.status})`);
  return response.json();
}
export const api = "/api/research";
export interface Gateway {
  id: string; provider: string; model: string; api2: string; baseUrl: string;
  thinkingEvidence: string; credentialConfigured: boolean; current: boolean;
}
