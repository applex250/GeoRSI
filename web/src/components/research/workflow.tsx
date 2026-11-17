"use client";

import { memo, useMemo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, useReactFlow, useNodesInitialized, type NodeProps, type Node, type Edge } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { Check, Circle, LoaderCircle, Database, ScanLine, FileText, GitBranch, FlaskConical, Search, TriangleAlert } from "lucide-react";
import { labels, type NodeBudgetReport, type WorkNode } from "./data";
import "@xyflow/react/dist/style.css";

type ResearchNode = Node<{ item: WorkNode; index: number; budget?: NodeBudgetReport }, "research">;
const budgetTone = (ratio: number | null): string => ratio === null ? "#b1b8b2" : ratio >= 0.85 ? "#ab654a" : ratio >= 0.6 ? "#d9a441" : "#65a27b";
const GraphNode = memo(function GraphNode({ data, selected }: NodeProps<ResearchNode>) {
  const { item, index, budget } = data;
  const minutes = (ms: number): number => Math.round(ms / 60000);
  const reduced = useReducedMotion();
  const active = item.state === "running" || item.state === "verifying";
  const Icon = item.kind.includes("data") ? Database : item.kind === "report" ? FileText : item.kind.includes("analysis") ? ScanLine : item.kind === "verification" ? FlaskConical : Search;
  return <motion.div initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.25, delay: reduced ? 0 : Math.min(index * 0.035, 0.2) }} className={`rs-node ${item.state} ${selected ? "selected" : ""}`}>
    <Handle type="target" position={Position.Left} />
    <div className="rs-node-top"><span className="rs-node-icon"><Icon size={17} /></span><span className="rs-node-number">{String(index + 1).padStart(2, "0")}</span></div>
    <strong>{item.title}</strong>
    <AnimatePresence mode="wait" initial={false}><motion.div key={item.state} initial={{ opacity: 0, y: reduced ? 0 : 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -3 }} transition={{ duration: reduced ? 0 : 0.14 }} className="rs-node-state">{active ? <LoaderCircle size={12} className="rs-spin" /> : item.state === "completed" ? <Check size={12} /> : item.state === "failed" ? <TriangleAlert size={12} /> : <Circle size={9} />}{labels[item.state] ?? item.state}</motion.div></AnimatePresence>
    {budget ? <div className="rs-node-budget" title={`工具调用 ${budget.used.toolCalls}/${budget.planned.toolCalls} 次 · 模型 ${budget.used.modelCalls}/${budget.planned.modelCalls} 次 · 墙钟 ${minutes(budget.used.wallMs)}/${minutes(budget.planned.wallMs)} 分（规划固定值）`}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--rs-muted, #8b948f)", lineHeight: 1.4 }}><span>预算</span><span>{budget.used.toolCalls}/{budget.planned.toolCalls} 次 · {minutes(budget.planned.wallMs)} 分</span></div><div style={{ height: 3, borderRadius: 2, background: "#e7ece6", overflow: "hidden", marginTop: 2 }}><div style={{ width: `${Math.min(100, (budget.ratios.toolCalls ?? 0) * 100)}%`, height: "100%", background: budgetTone(budget.ratios.toolCalls), transition: "width .4s ease" }} /></div></div> : item.budget ? <div className="rs-node-budget" style={{ fontSize: 10, color: "var(--rs-muted, #8b948f)", lineHeight: 1.4 }} title="规划固定值：该节点的预算底线">预算 {item.budget.maxToolCalls} 次 · {minutes(item.budget.wallMs)} 分</div> : null}
    <Handle type="source" position={Position.Right} />
  </motion.div>;
});
const nodeTypes = { research: GraphNode };

function FitWhenResized({ layoutKey, sizeKey }: { layoutKey: string; sizeKey: number }) {
  const { fitView, getNodes } = useReactFlow();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized) return;
    const element = document.querySelector('.rs-graph');
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    let finalTimer: ReturnType<typeof setTimeout>;
    const fit = () => {
      if (getNodes().length) void fitView({ padding: 0.14, duration: 0, minZoom: 0.28, maxZoom: 1.2 });
    };
    const scheduleFit = () => {
      clearTimeout(timer);
      clearTimeout(finalTimer);
      timer = setTimeout(fit, 120);
      finalTimer = setTimeout(fit, 450);
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(scheduleFit));
    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); clearTimeout(finalTimer); observer.disconnect(); };
  }, [fitView, getNodes, initialized, layoutKey, sizeKey]);
  return null;
}

export default function Workflow({ items, budgets, onSelect }: { items: WorkNode[]; budgets?: Map<string, NodeBudgetReport>; onSelect: (node: WorkNode) => void }) {
  const reduced = useReducedMotion();
  const graphRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(0);
  useEffect(() => {
    const element = graphRef.current;
    if (!element) return;
    const update = () => setGraphWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const compact = graphWidth > 0 && graphWidth < 700;
  const layoutKey = compact ? "top-down" : "left-right";
  const { nodes, edges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: compact ? "TB" : "LR", nodesep: compact ? 24 : 28, ranksep: compact ? 42 : 36, marginx: 18, marginy: 18 });
    // Cards carry a budget row now (plan value or live utilisation); reserve its height.
    items.forEach((item) => graph.setNode(item.id, { width: 158, height: 131 }));
    const ids = new Set(items.map((item) => item.id));
    items.forEach((item) => item.dependsOn.filter((id) => ids.has(id)).forEach((id) => graph.setEdge(id, item.id)));
    dagre.layout(graph);
    const nodes: ResearchNode[] = items.map((item, index) => {
      const p = graph.node(item.id);
      return { id: item.id, type: "research", position: { x: p.x - 79, y: p.y - 65.5 }, data: { item, index, budget: budgets?.get(item.id) }, ariaLabel: `${item.title}，${labels[item.state] ?? item.state}` };
    });
    const edges: Edge[] = items.flatMap((item) => item.dependsOn.filter((id) => ids.has(id)).map((id) => ({
      id: `${id}-${item.id}`, source: id, target: item.id, type: "smoothstep", animated: !reduced && (item.state === "running" || item.state === "verifying"),
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "#8aab94" },
      style: { stroke: item.state === "running" || item.state === "completed" ? "#75a28d" : "#d5dcd8", strokeWidth: 1.5 },
    })));
    return { nodes, edges };
  }, [items, budgets, compact, reduced]);
  if (!items.length) return <div className="rs-graph-wait"><GitBranch size={25} /><p>工作流尚未生成</p><span>节点准备就绪后会在这里自动出现</span></div>;
  return <div ref={graphRef} className="rs-graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.14, minZoom: 0.28, maxZoom: 1.2 }} minZoom={0.28} maxZoom={1.2} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.data.item)}><FitWhenResized layoutKey={layoutKey} sizeKey={graphWidth} /><Background color="#e5eae7" gap={18} size={1} /><Controls showInteractive={false} /></ReactFlow></div>;
}
