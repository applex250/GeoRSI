import { ResearchWorkspace } from "@/components/research/workspace";
import "./workspace.css";

export const metadata = { title: "研究工作台 · GeoRSI", description: "地学研究，从一个问题开始。" };

export default function WorkspacePage() {
  return <ResearchWorkspace />;
}
