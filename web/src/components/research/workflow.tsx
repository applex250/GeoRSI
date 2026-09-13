"use client";

import { memo, useMemo } from "react";
import { ReactFlow, Background, Controls, Handle, Position, type NodeProps, type Node, type Edge } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { Check, Circle, LoaderCircle, Database, ScanLine, FileText, GitBranch, FlaskConical, Search, TriangleAlert } from "lucide-react";
import { labels, type WorkNode } from "./data";
import "@xyflow/react/dist/style.css";

type ResearchNode = Node<{ item: WorkNode; index: number }, "research">;
const GraphNode = memo(function GraphNode({ data, selected }: NodeProps<ResearchNode>) {
  const { item, index } = data;
  const active = item.state === "running" || item.state === "verifying";
  const Icon = item.kind.includes("data") ? Database : item.kind === "report" ? FileText : item.kind.includes("analysis") ? ScanLine : item.kind === "verification" ? FlaskConical : Search;
  return <div className={`rs-node ${item.state} ${selected ? "selected" : ""}`}>
    <Handle type="target" position={Position.Left} />
    <div className="rs-node-top"><span className="rs-node-icon"><Icon size={17} /></span><span className="rs-node-number">{String(index + 1).padStart(2, "0")}</span></div>
    <strong>{item.title}</strong>
    <div className="rs-node-state">{active ? <LoaderCircle size={12} className="rs-spin" /> : item.state === "completed" ? <Check size={12} /> : item.state === "failed" ? <TriangleAlert size={12} /> : <Circle size={9} />}{labels[item.state] ?? item.state}</div>
    <Handle type="source" position={Position.Right} />
  </div>;
});
const nodeTypes = { research: GraphNode };

export default function Workflow({ items, onSelect }: { items: WorkNode[]; onSelect: (node: WorkNode) => void }) {
  const { nodes, edges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 36, marginx: 18, marginy: 18 });
    items.forEach((item) => graph.setNode(item.id, { width: 158, height: 113 }));
    const ids = new Set(items.map((item) => item.id));
    items.forEach((item) => item.dependsOn.filter((id) => ids.has(id)).forEach((id) => graph.setEdge(id, item.id)));
    dagre.layout(graph);
    const nodes: ResearchNode[] = items.map((item, index) => {
      const p = graph.node(item.id);
      return { id: item.id, type: "research", position: { x: p.x - 79, y: p.y - 56.5 }, data: { item, index }, ariaLabel: `${item.title}，${labels[item.state] ?? item.state}` };
    });
    const edges: Edge[] = items.flatMap((item) => item.dependsOn.filter((id) => ids.has(id)).map((id) => ({
      id: `${id}-${item.id}`, source: id, target: item.id, type: "smoothstep", animated: item.state === "running" || item.state === "verifying",
      style: { stroke: item.state === "running" || item.state === "completed" ? "#75a28d" : "#d5dcd8", strokeWidth: 1.5 },
    })));
    return { nodes, edges };
  }, [items]);
  if (!items.length) return <div className="rs-graph-wait"><GitBranch size={25} /><p>工作流尚未生成</p><span>节点准备就绪后会在这里自动出现</span></div>;
  return <div className="rs-graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.35} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.data.item)}><Background color="#e5eae7" gap={18} size={1} /><Controls showInteractive={false} /></ReactFlow></div>;
}
