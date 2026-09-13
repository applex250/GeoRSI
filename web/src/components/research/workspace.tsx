"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { Hint, ResearchPanel, ResearchProgress, Tabs, TabsList, TabsTrigger, TabsContent, TooltipProvider, motionTiming } from "./ui";
import { useDropzone } from "react-dropzone";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { ArrowUp, ArrowUpRight, ArrowLeft, PanelLeftClose, PanelLeftOpen, Plus, Search, Orbit, FileText, Paperclip, X, GitBranch, ChevronRight, Check, Download, LoaderCircle, Circle, Play, Pause, RotateCcw, Mountain, Waves, Leaf, ExternalLink, PanelRightClose, FlaskConical, Zap } from "lucide-react";
import { api, demoNodes, demoReport, exampleQuestion, examples, getJson, labels, type Deliverable, type Gateway, type Run, type WorkNode } from "./data";

const Workflow = dynamic(() => import("./workflow"), { ssr: false, loading: () => <div className="rs-graph-wait"><LoaderCircle className="rs-spin" />正在加载工作流</div> });
const terminal = new Set(["completed", "failed", "cancelled"]);
const markdownPlugins = [remarkGfm, remarkMath];
const htmlPlugins = [rehypeKatex];
function reportMath(text: string): string {
  return text.replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n$$\n${math}\n$$\n`).replace(/\\\((.*?)\\\)/g, (_, math: string) => `$${math}$`);
}
const suggestions = [Leaf, Mountain, Waves];

export function ResearchWorkspace({ initialRun = null }: { initialRun?: string | null }) {
  const reducedMotion = useReducedMotion();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [selection, setSelection] = useState<string | null>(initialRun);
  const [sidebar, setSidebar] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<WorkNode | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState("");
  const [demoStep, setDemoStep] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [demoQuestion, setDemoQuestion] = useState(exampleQuestion);
  const [supplements, setSupplements] = useState<string[]>([]);
  const [submittedFiles, setSubmittedFiles] = useState<string[]>([]);
  const [activityTab, setActivityTab] = useState("动态");
  const composer = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState("");
  const sendLock = useRef(false);
  const uploadCache = useRef(new Map<File, string>());
  const demo = selection === "demo";
  const liveId = selection && !demo ? selection : null;
  const { data: health } = useSWR(`${api}/healthz`, getJson<{ ok: boolean }>, { refreshInterval: 15000, shouldRetryOnError: false });
  const { data: history, error: historyError, mutate: refreshHistory } = useSWR(`${api}/research-runs?pageSize=100`, getJson<{ items: Run[] }>, { refreshInterval: 10000, shouldRetryOnError: false });
  const { data: liveRun, error: runError, mutate: refreshRun } = useSWR(liveId ? `${api}/research-runs/${liveId}` : null, getJson<Run>, { refreshInterval: 2500 });
  const { data: originalRequest } = useSWR(liveId && liveRun?.mode === "research-agent" ? `${api}/research-runs/${liveId}/request` : null, getJson<{ question: string; files: { name: string }[] }>);
  const { data: directions, mutate: refreshDirections } = useSWR(liveId && liveRun?.mode === "research-agent" ? `${api}/research-runs/${liveId}/directions` : null, getJson<{ items: { id: string; text: string; status: string }[] }>, { refreshInterval: 2500 });
  const { data: graph } = useSWR(liveId ? `${api}/research-runs/${liveId}/workflow` : null, getJson<{ nodes: WorkNode[] }>, { refreshInterval: 2500 });
  const { data: deliverables } = useSWR(liveId ? `${api}/research-runs/${liveId}/deliverables` : null, getJson<{ items: Deliverable[] }>, { refreshInterval: 5000 });
  const reportFile = deliverables?.items.find((file) => file.name === "report.md");
  const reportUrl = reportFile && liveId ? `${api}/research-runs/${liveId}/deliverables/${encodeURIComponent(reportFile.name)}/content` : null;
  const { data: report, error: reportError } = useSWR(reportOpen && activityTab === "报告" && reportUrl ? reportUrl : null, async (url: string) => {
    const response = await fetch(url); if (!response.ok) throw new Error("报告加载失败"); return response.text();
  });
  const { data: logs } = useSWR(liveId && reportOpen && activityTab === "日志" ? `${api}/research-runs/${liveId}/logs?limit=24000&tail=24000` : null, getJson<{ content?: string; text?: string }>, { refreshInterval: 3000 });
  const currentRound = liveRun?.workspace?.iteration;
  const nodes = useMemo(() => demo ? demoNodes.map((node, index) => ({ ...node, state: index < demoStep ? "completed" : index === demoStep ? "running" : "pending" })) : (graph?.nodes ?? []).filter((node) => !currentRound || node.id.startsWith(`r${currentRound}-`)), [demo, demoStep, graph?.nodes, currentRound]);
  const completed = nodes.filter((node) => node.state === "completed").length;
  const demoDone = demoStep >= demoNodes.length;
  const run: Run | undefined = demo ? { id: "demo", name: demoQuestion, status: demoDone ? "completed" : "running", mode: "demo" } : liveRun;
  const done = !!run && terminal.has(run.status);
  const { data: gateways, mutate: refreshGateways } = useSWR(`${api}/gateways`, getJson<{ items: Gateway[] }>);
  const [switchingGateway, setSwitchingGateway] = useState(false);
  async function switchGateway(id: string) {
    if (switchingGateway) return;
    setSwitchingGateway(true);
    try {
      await post("/gateways/select", JSON.stringify({ gateway: id }));
      await refreshGateways();
      setNotice(`已切换到 ${id} 网关；正在运行的科研不受影响，新任务将使用它。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "网关切换失败"); }
    finally { setSwitchingGateway(false); }
  }
  async function retryResearch() {
    if (!liveId || sendLock.current) return;
    sendLock.current = true;
    try {
      await post(`/research-runs/${liveId}/start`, JSON.stringify({ resume: true }));
      await refreshRun(); setNotice("已从断点恢复：完成的节点保留，只重执行未完成的部分。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "续跑请求失败"); }
    finally { sendLock.current = false; }
  }
  const currentNode = nodes.find((node) => node.state === "running" || node.state === "verifying");
  const visibleNode = selectedNode ? nodes.find((node) => node.id === selectedNode.id) ?? selectedNode : null;

  useEffect(() => {
    if (!demo || !playing || demoDone) return;
    const timer = setInterval(() => setDemoStep((step) => Math.min(step + 1, demoNodes.length)), 4500);
    return () => clearInterval(timer);
  }, [demo, playing, demoDone]);

  const { getRootProps, getInputProps, open: openFiles, isDragActive } = useDropzone({
    noClick: true, noKeyboard: true, disabled: !!sending || !!liveId, maxSize: 100 * 1024 * 1024, maxFiles: 8,
    accept: { "application/pdf": [".pdf"], "text/csv": [".csv"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"], "image/tiff": [".tif", ".tiff"], "application/geo+json": [".geojson"] },
    onDrop: (accepted, rejected) => {
      setFiles((previous) => [...previous, ...accepted].filter((file, index, all) => all.findIndex((f) => f.name === file.name && f.size === file.size) === index).slice(0, 8));
      if (rejected.length) setNotice("请选择 PDF、CSV/Excel、GeoTIFF 或 GeoJSON；每个文件不超过 100 MB，最多 8 个。");
    },
  });

  function choose(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("run", id); else url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
    setSupplements([]); setSubmittedFiles([]);
    setSelection(id); setReportOpen(false); setSelectedNode(null); setNotice(""); setDraft(""); setFiles([]); setActivityTab("动态");
    if (typeof window !== "undefined" && window.innerWidth < 800) setSidebar(false);
  }
  function openDemo(question = exampleQuestion) {
    choose("demo"); setDemoQuestion(question); setDemoStep(3); setPlaying(false); setSupplements([]); setSubmittedFiles([]);
  }
  async function post<T>(path: string, body: BodyInit, contentType = "application/json"): Promise<T> {
    const response = await fetch(`${api}${path}`, { method: "POST", body, headers: { "Content-Type": contentType } });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? `请求失败 (${response.status})`);
    return value as T;
  }
  async function submit() {
    if (!draft.trim() || done || sendLock.current) return;
    if (demo) {
      setSupplements((items) => [...items, draft.trim()]);
      setNotice("演示：补充要求已加入展示队列；没有调用模型。"); setDraft(""); return;
    }
    sendLock.current = true; setNotice("");
    try {
      if (liveId) {
        setSending("正在提交补充方向…");
        await post(`/research-runs/${liveId}/feedback`, JSON.stringify({ text: draft.trim() }));
        setDraft(""); await refreshDirections(); setNotice("补充方向已排队，将在下一个执行节点纳入，不中断当前分析。");
      } else {
        const uploadIds: string[] = [];
        for (const [index, file] of files.entries()) {
          setSending(`正在上传资料 ${index + 1}/${files.length}…`);
          let id = uploadCache.current.get(file);
          if (!id) { id = (await post<{ id: string }>(`/uploads?name=${encodeURIComponent(file.name)}`, file, "application/octet-stream")).id; uploadCache.current.set(file, id); }
          uploadIds.push(id);
        }
        setSending("正在启动自主研究…");
        const created = await post<{ id: string }>("/research-requests", JSON.stringify({ question: draft.trim(), uploadIds }));
        choose(created.id); uploadCache.current.clear(); await refreshHistory();
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "提交失败，请检查研究记录后重试。"); }
    finally { sendLock.current = false; setSending(""); }
  }
  async function stopResearch() {
    if (!liveId || sendLock.current) return;
    // A bare icon used to abort minutes of research with one misclick; stopping
    // is now an explicit, confirmed action.
    if (!window.confirm("确定停止当前研究？已完成的节点会保留，但研究不会继续。")) return;
    sendLock.current = true;
    try { await post(`/research-runs/${liveId}/actions`, JSON.stringify({ action: "stop" })); await refreshRun(); setNotice("已请求停止，当前操作结束后退出。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "停止请求失败"); }
    finally { sendLock.current = false; }
  }
  function previewDraft() {
    const question = draft.trim() || exampleQuestion;
    const names = files.map((file) => file.name);
    openDemo(question); setSubmittedFiles(names); setPlaying(true);
  }
  function downloadDemo() {
    const url = URL.createObjectURL(new Blob([demoReport], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "GeoRSI-演示报告.md"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <MotionConfig reducedMotion="user" transition={motionTiming}><TooltipProvider delayDuration={350}><main ref={setPortalContainer} className={`rs-workspace ${sidebar ? "with-sidebar" : ""} ${reportOpen ? "with-report" : ""}`} lang="zh-CN">
    <ResearchPanel open={sidebar} onOpenChange={setSidebar} side="left" title="研究导航" container={portalContainer}><aside className="rs-sidebar">
      <Link href="/" className="rs-brand"><span className="rs-brand-mark"><Orbit size={28} strokeWidth={1.4} /></span><span><strong>GeoRSI<span> /</span></strong><small>GEOSCIENCE RESEARCH</small></span></Link>
      <motion.button whileTap={{ scale: 0.96 }} className="rs-new" onClick={() => choose(null)}><Plus size={17} />新建研究<span>↗</span></motion.button>
      <div className="rs-history-label">研究记录 <span>{history?.items.length ?? 0}</span></div>
      <label className="rs-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索研究…" aria-label="搜索研究记录" /></label>
      <div className="rs-history">
        <motion.button whileTap={{ scale: 0.96 }} className={`rs-history-item ${demo ? "active" : ""}`} onClick={() => openDemo()}><span className="rs-history-icon"><Leaf size={17} /></span><span><strong>青藏高原植被变化</strong><small><span className="rs-demo-dot" />交互演示</small></span><ChevronRight size={13} /></motion.button>
        {(history?.items ?? []).filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).map((item) => <motion.button whileTap={{ scale: 0.96 }} key={item.id} className={`rs-history-item ${selection === item.id ? "active" : ""}`} onClick={() => choose(item.id)}><span className="rs-history-icon"><GitBranch size={16} /></span><span><strong>{item.name}</strong><small>{labels[item.status] ?? item.status} · {item.createdAt ? new Date(item.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "历史任务"}</small></span></motion.button>)}
        {historyError ? <div className="rs-history-empty">暂时无法获取记录<motion.button whileTap={{ scale: 0.96 }} onClick={() => void refreshHistory()}>重新连接</motion.button></div> : history?.items.length === 0 ? <p className="rs-history-empty">新的研究，会从这里开始。</p> : null}
      </div>
      <div className="rs-sidebar-bottom"><div className="rs-lab-note"><Orbit size={17} /><span>让研究，持续进化。<small>Self-evolving research agent</small></span></div><Link href="/"><ArrowLeft size={15} />返回 Geobyte 首页<ArrowUpRight size={13} /></Link></div>
    </aside></ResearchPanel>
    <section className="rs-main">
      <header className="rs-header"><div><motion.button whileTap={{ scale: 0.96 }} className="rs-icon-button" data-panel-trigger="sidebar" aria-label={sidebar ? "收起侧栏" : "展开侧栏"} onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</motion.button><span>研究工作台</span>{selection && <><ChevronRight size={13} /><strong>{demo ? "青藏高原植被变化" : run?.name ?? "正在加载研究"}</strong></>}</div><div><span className={`rs-connection ${health?.ok ? "connected" : ""}`}><i />{health?.ok ? "引擎已连接" : "引擎未连接"}</span><motion.button whileTap={{ scale: 0.96 }} data-panel-trigger="report" className={`rs-report-toggle ${reportOpen ? "active" : ""}`} onClick={() => { setReportOpen(!(reportOpen && activityTab === "报告")); setActivityTab("报告"); }}><FileText size={15} /><span>研究报告</span></motion.button></div></header>
      <div className="rs-scroll"><AnimatePresence mode="wait" initial={false}><motion.div key={selection ?? "welcome"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ ...motionTiming, duration: reducedMotion ? 0 : 0.24 }}>
        {!selection ? <div className="rs-welcome"><div className="rs-welcome-orbit"><Orbit size={52} strokeWidth={1} /><span /></div><h1>从一个问题，<br />探索地球的更多可能。</h1><p>提出你的地学问题，GeoRSI 将自主开展研究，<br />在执行与验证中持续迭代，最终交付研究报告。</p><div className="rs-suggestions">{examples.map((text, index) => { const Icon = suggestions[index]; return <motion.button whileTap={{ scale: 0.96 }} key={text} onClick={() => { setDraft(text); composer.current?.focus(); }}><Icon size={19} /><span>{text}</span><ArrowUpRight size={15} /></motion.button>; })}</div><motion.button whileTap={{ scale: 0.96 }} className="rs-demo-link" onClick={() => openDemo()}><Play size={13} />先看看一次研究如何展开<ArrowUpRight size={13} /></motion.button></div> : <div className="rs-conversation">
          {demo && <div className="rs-demo-banner"><FlaskConical size={14} /><span>交互演示 · 示例节点与报告，不调用模型</span><motion.button whileTap={{ scale: 0.96 }} onClick={() => { setDemoStep(0); setPlaying(true); setSupplements([]); }}><RotateCcw size={12} />重播</motion.button></div>}
          <div className="rs-user-message"><p>{originalRequest?.question ?? run?.name ?? "正在读取研究任务…"}</p>{(demo ? submittedFiles : originalRequest?.files.map((file) => file.name) ?? []).length > 0 && <div className="rs-message-files">{(demo ? submittedFiles : originalRequest?.files.map((file) => file.name) ?? []).map((name) => <span key={name}><FileText size={13} />{name}<small>{demo ? "演示附件" : "研究资料"}</small></span>)}</div>}</div>
          <div className="rs-assistant"><span className="rs-agent-symbol"><Orbit size={22} strokeWidth={1.5} /></span><div><div className="rs-assistant-label">GeoRSI <span>自主研究 Agent</span></div><p>{demo ? demoDone ? "本次演示流程已完成。你可以在右侧查看报告结构，或重新播放研究过程。" : "正在分析植被变化与气候驱动因素。点击节点查看详情，或在下方补充研究方向。" : runError ? "暂时无法读取这项研究。连接恢复后将自动更新。" : run ? done ? "本次运行已结束。下方保留工作流执行记录，已生成的报告可在右侧查看。" : "已连接研究引擎。下方展示当前运行的工作流与节点状态。" : "正在连接研究记录…"}</p></div></div>
          <section className="rs-workflow-card"><div className="rs-workflow-heading"><div><span className={`rs-status-dot ${done ? "done" : ""}`} /><strong>{done ? labels[run?.status ?? "completed"] : run?.workspace?.phase === "planning" ? "自主规划中" : run?.workspace?.phase === "reviewing" ? "正在复核结果" : "研究进行中"}</strong><span className="rs-stage-chip"><GitBranch size={12} />{demo ? demoStep >= 3 ? "第 2 轮迭代" : "第 1 轮迭代" : run?.workspace ? `第 ${run.workspace.iteration} 轮迭代` : "当前工作流"}</span></div>{demo && <Hint label={playing && !demoDone ? "暂停演示" : "播放演示"}><motion.button whileTap={{ scale: 0.96 }} className="rs-icon-button" aria-label={playing && !demoDone ? "暂停演示" : "播放演示"} onClick={() => { if (demoDone) setDemoStep(0); setPlaying(!playing || demoDone); }}>{playing && !demoDone ? <Pause size={15} /> : <Play size={15} />}</motion.button></Hint>}{!demo && !done && run?.mode === "research-agent" && <motion.button className="rs-icon-button" onClick={() => void stopResearch()} aria-label="停止研究" title="停止研究（需确认）"><X size={15} /><span style={{ marginLeft: 4 }}>停止</span></motion.button>}{!demo && done && (run?.status === "failed" || run?.status === "cancelled") && run?.mode === "research-agent" && <motion.button className="rs-icon-button" onClick={() => void retryResearch()} aria-label="从断点恢复续跑" title="保留已完成节点，只重执行未完成部分（可先切换网关）"><RotateCcw size={15} /><span style={{ marginLeft: 4 }}>恢复</span></motion.button>}{!demo && gateways?.items?.length ? <span className="rs-stage-chip" style={{ gap: 6 }} title="研究模型网关：切换只影响新任务"> <Zap size={12} /><select value={gateways.items.find((g) => g.current)?.id ?? ""} disabled={switchingGateway} onChange={(event) => { const id = event.target.value; if (id) void switchGateway(id); }} style={{ background: "transparent", border: "none", color: "inherit", fontSize: "inherit", cursor: "pointer" }}>{gateways.items.map((g) => <option key={g.id} value={g.id} disabled={!g.credentialConfigured}>{g.id}{g.current ? "（当前）" : ""}{g.credentialConfigured ? "" : "（未配置密钥）"}</option>)}</select></span> : null}</div>
            <div className="rs-workflow-sub"><span>{currentNode ? `正在执行 · ${currentNode.title}` : done ? "执行记录已保留" : run?.workspace?.phase === "reviewing" ? "评估证据与结论，决定是否继续迭代" : "正在分析需求并规划工作流…"}</span><span>{completed}<em> / {nodes.length} 节点完成</em></span></div><ResearchProgress value={nodes.length ? completed / nodes.length * 100 : 0} />
            <Workflow items={nodes} onSelect={(node) => { setSelectedNode(node); setActivityTab("节点"); setReportOpen(true); }} />
            <div className="rs-workflow-footer"><span><GitBranch size={13} />{demo ? "新增气候归因分支，交叉验证后汇总" : run?.workspace ? `已调用模型 ${run.workspace.modelCalls} 次 · ${nodes.length} 个研究节点` : "根据真实节点依赖关系展示"}</span><motion.button whileTap={{ scale: 0.96 }} onClick={() => { setActivityTab("动态"); setReportOpen(true); }}>运行记录<ArrowUpRight size={12} /></motion.button></div>
          </section>


          <AnimatePresence initial={false}>{supplements.map((text, index) => <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="rs-supplement" key={`${index}-${text}`}><p>{text}</p><span><Check size={12} />演示：已排入后续执行队列</span></motion.div>)}</AnimatePresence>
          {directions?.items.map((item) => <div className="rs-supplement" key={item.id}><p>{item.text}</p><span><Check size={12} />{item.status === "applied" ? "已纳入执行" : done ? "未执行 · 已保留" : "已排队 · 下个节点生效"}</span></div>)}{run?.error && <p className="rs-error">{run.error}</p>}
          {done && <motion.button whileTap={{ scale: 0.96 }} className="rs-completion" onClick={() => { setActivityTab("报告"); setReportOpen(true); }}><FileText size={20} /><span><strong>{demo || reportFile ? "查看研究报告" : "查看产出状态"}</strong><small>{demo ? "示例报告 · Markdown" : reportFile ? "研究成果已保存" : "运行已结束"}</small></span><ArrowUpRight size={17} /></motion.button>}
        </div>}
      </motion.div></AnimatePresence></div>
      <div className="rs-composer-area">{sending && <div className="rs-notice" role="status"><LoaderCircle size={13} className="rs-spin" />{sending}</div>}{notice && <div className="rs-notice" role="status"><span>{notice}</span><motion.button whileTap={{ scale: 0.96 }} className="rs-icon-button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={13} /></motion.button></div>}{!done ? <div {...getRootProps({ className: `rs-composer ${isDragActive ? "dragging" : ""}` })}><input {...getInputProps()} aria-label="选择研究文件" />{isDragActive && <div className="rs-drop-overlay"><Paperclip />放下文件，添加研究资料</div>}{files.length > 0 && <div className="rs-file-list">{files.map((file) => <span key={file.name}><FileText size={14} /><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(1)} MB · 本地待上传</small></span><motion.button whileTap={{ scale: 0.96 }} aria-label={`移除 ${file.name}`} onClick={() => setFiles((items) => items.filter((item) => item !== file))}><X size={12} /></motion.button></span>)}</div>}<textarea ref={composer} disabled={!!sending} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} placeholder={selection ? "补充研究方向，系统将在后续执行中纳入…" : "描述你的地学研究问题…"} aria-label="研究需求" rows={2} /><div className="rs-composer-tools"><div><Hint label="添加文件 · 支持拖拽"><motion.button whileTap={{ scale: 0.96 }} className="rs-icon-button" onClick={openFiles} disabled={!!sending || !!liveId} aria-label="添加文件"><Paperclip size={18} /></motion.button></Hint><span>{files.length ? `${files.length} 个文件` : "添加研究资料"}</span></div><div>{!selection && <motion.button whileTap={{ scale: 0.96 }} className="rs-preview-button" onClick={previewDraft}><Play size={12} />用此问题演示</motion.button>}<motion.button whileTap={{ scale: 0.96 }} className="rs-send" onClick={submit} disabled={!draft.trim() || !!sending} aria-label={selection ? "追加研究要求" : "提交研究需求"}><ArrowUp size={19} /></motion.button></div></div></div> : <div className="rs-ended"><Check size={15} />本次研究已结束<motion.button whileTap={{ scale: 0.96 }} onClick={() => choose(null)}>开始新的研究<ArrowUpRight size={13} /></motion.button></div>}<div className="rs-composer-caption"><span><Orbit size={11} />GeoRSI · 自主探索，持续进化</span><span>{selection ? demo ? "交互演示" : "真实运行记录" : "PDF / Excel / CSV / GeoTIFF / GeoJSON"}</span></div></div>
    </section>
    <ResearchPanel open={reportOpen} onOpenChange={setReportOpen} side="right" title="研究详情" container={portalContainer}><aside className="rs-report-panel rs-inspector"><header><div><GitBranch size={17} /><strong>研究详情</strong></div><motion.button whileTap={{ scale: 0.96 }} className="rs-icon-button" aria-label="关闭研究详情" onClick={() => setReportOpen(false)}><PanelRightClose size={18} /></motion.button></header><Tabs value={activityTab} onValueChange={setActivityTab} className="rs-inspector-tabs"><TabsList className="rs-inspector-tablist" aria-label="研究详情分类">{["节点", "动态", "日志", "报告"].map((tab) => <TabsTrigger key={tab} value={tab}>{tab}{activityTab === tab && <motion.span className="rs-tab-underline" layoutId="inspector-tab" />}</TabsTrigger>)}</TabsList><TabsContent value="节点" className="rs-inspector-content"><AnimatePresence initial={false}>{visibleNode && <motion.section key={visibleNode.id} className="rs-node-detail" initial={{ opacity: 0, height: 0, marginTop: 0 }} animate={{ opacity: 1, height: "auto", marginTop: 13 }} exit={{ opacity: 0, height: 0, marginTop: 0 }} style={{ overflow: "hidden" }}><div><span className="rs-detail-icon"><ScanIcon /></span><strong>{visibleNode.title}</strong><span className={`rs-small-state ${visibleNode.state}`}>{labels[visibleNode.state] ?? visibleNode.state}</span><motion.button whileTap={{ scale: 0.96 }} className="rs-icon-button" aria-label="关闭节点详情" onClick={() => setSelectedNode(null)}><X size={15} /></motion.button></div><dl><div><dt>执行阶段</dt><dd>{labels[visibleNode.kind] ?? visibleNode.kind}</dd></div><div><dt>执行尝试</dt><dd>{visibleNode.attempts ?? (demo ? 1 : "—")}</dd></div><div><dt>前置依赖</dt><dd>{visibleNode.dependsOn.map((id) => nodes.find((node) => node.id === id)?.title ?? id).join("、") || "无"}</dd></div></dl>{visibleNode.failureMessage && <p className="rs-error">{visibleNode.failureMessage}</p>}</motion.section>}</AnimatePresence>{!visibleNode && <div className="rs-inspector-empty"><GitBranch size={28} /><p>选择一个工作流节点</p><span>在左侧节点图中点击，查看执行状态和依赖关系。</span></div>}</TabsContent><TabsContent value="动态" className="rs-inspector-content"><p className="rs-inspector-caption">{demo ? "演示时间线" : "运行状态 · 每 2.5 秒更新"}</p><div className="rs-timeline">{run?.workspace?.iterations.map((iteration) => <div key={iteration.round} className="rs-iteration-review"><strong>第 {iteration.round} 轮复核</strong><p>{iteration.summary}</p></div>)}<AnimatePresence initial={false}>{nodes.filter((node) => ["completed", "running", "verifying", "failed"].includes(node.state)).slice().reverse().map((node) => <motion.div layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="rs-timeline-item" key={node.id}><span className={`rs-timeline-icon ${node.state}`}>{node.state === "completed" ? <Check size={11} /> : node.state === "running" ? <LoaderCircle size={11} className="rs-spin" /> : <Circle size={9} />}</span><div><strong>{node.title}<span>{labels[node.state]}</span></strong><p>{node.state === "completed" ? "节点执行与验证已完成，结果进入后续研究。" : node.state === "failed" ? node.failureMessage ?? "请查看节点详情与执行日志。" : "正在执行分析，工作流将在结果就绪后继续。"}</p></div><span className="rs-timeline-time">{demo ? "演示" : node.startedAt ? new Date(node.startedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "—"}</span></motion.div>)}</AnimatePresence>{!nodes.length && <p className="rs-muted">等待引擎生成执行记录…</p>}</div></TabsContent><TabsContent value="日志" className="rs-inspector-content"><p className="rs-inspector-caption">{demo ? "演示日志" : "执行日志"}</p><pre className="rs-log">{demo ? "[demo] 研究需求已接收\n[demo] 创建初始工作流\n[demo] 评估分析路径，增加气候归因分支\n[demo] 当前节点：" + (currentNode?.title ?? "全部完成") : logs?.content ?? logs?.text ?? "暂无日志"}</pre></TabsContent><TabsContent value="报告" className="rs-inspector-report"><div className="rs-report-toolbar"><span><i />{demo ? "演示文档" : reportFile ? "已生成" : "等待产出"}</span>{demo ? <motion.button whileTap={{ scale: 0.96 }} onClick={downloadDemo}><Download size={14} />下载</motion.button> : reportUrl ? <a href={reportUrl} download="report.md"><Download size={14} />下载</a> : null}</div>{demo || report ? <div className="rs-report-scroll"><article className="rs-report-paper"><div className="rs-paper-brand"><Orbit size={14} />GEORSI RESEARCH<span>{demo ? "DEMO" : "REPORT"}</span></div><Markdown remarkPlugins={markdownPlugins} rehypePlugins={htmlPlugins} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={11} /></a> }}>{reportMath(demo ? demoReport : report ?? "")}</Markdown><footer>GeoRSI · 地学自主研究</footer></article></div> : <div className="rs-report-empty"><div><FileText size={35} strokeWidth={1.2} /></div><h3>{reportError ? "报告暂时无法加载" : "研究的答案，会在这里汇集。"}</h3><p>{reportError ? "请关闭并重新打开报告面板。" : reportFile ? "正在加载研究报告…" : "报告生成后，你可以在这里阅读研究方法、分析结果与证据来源。"}</p>{!selection && <motion.button whileTap={{ scale: 0.96 }} onClick={() => openDemo()}>查看演示报告<ArrowUpRight size={14} /></motion.button>}</div>}</TabsContent></Tabs></aside></ResearchPanel>
  </main></TooltipProvider></MotionConfig>;
}

function ScanIcon() { return <GitBranch size={16} />; }
