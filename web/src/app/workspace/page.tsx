import { ResearchWorkspace } from "@/components/research/workspace";
import "./workspace.css";

export const metadata = { title: "研究工作台 · GeoRSI", description: "地学研究，从一个问题开始。" };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  return <ResearchWorkspace initialRun={run && /^(demo|run_[a-f0-9]{12})$/.test(run) ? run : null} />;
}
