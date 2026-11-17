/**
 * Node activity view: what one WorkGraph node actually did — the pi session's thinking and
 * text stream, its tool calls, the model receipts with token/cache usage, and the lifecycle —
 * folded from three durable sources (ledger events, the sessions/*.jsonl telemetry, the
 * executor snapshot's submission). Pure; the API reads the files and calls this.
 */
import type { ResearchEvent } from "./event-ledger.js";

export interface NodeUsage {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
	/** cached / (cached + input) over receipts that report caching; null when no receipt does. */
	cacheHitRate: number | null;
	totalTokens: number;
}

export type TimelineItem =
	| { at: string; source: "session"; kind: "thinking" | "text" | "tool-start" | "tool-end" | "truncated"; isError?: boolean; detail: string }
	| { at: string; source: "ledger"; kind: string; detail: string };

export interface NodeActivity {
	nodeId: string;
	kind: string;
	title: string;
	state: string;
	attempts: number;
	usage: NodeUsage;
	tools: { toolId: string; calls: number; failures: number }[];
	submission: { summary: string; artifactIds: string[]; decisions: number } | null;
	timeline: TimelineItem[];
	timelineTruncated: boolean;
}

export interface SessionEventLine { t?: string; at?: string; kind: string; detail?: string; isError?: boolean }

export interface FoldNodeActivityInput {
	node: { id: string; kind: string; title: string; state: string; attempts: number };
	/** Ledger events already filtered to this node, in sequence order. */
	events: readonly ResearchEvent[];
	/** Telemetry lines from runs/<id>/sessions/<nodeId>.jsonl (already tail-bounded by the caller). */
	session: readonly SessionEventLine[];
	submission?: { summary: string; artifactIds: string[]; decisions: number } | null;
	timelineLimit?: number;
}

const TIMELINE_LIMIT = 400;

export function foldNodeActivity(input: FoldNodeActivityInput): NodeActivity {
	const usage: NodeUsage = { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, cacheHitRate: null, totalTokens: 0 };
	const toolCounts = new Map<string, { calls: number; failures: number }>();
	const timeline: TimelineItem[] = [];
	let receiptsReportingCache = 0;
	for (const event of input.events) {
		const payload = (event.payload ?? {}) as Record<string, unknown>;
		if (event.type === "model-call-receipt") {
			usage.calls += 1;
			usage.inputTokens += Number(payload.input ?? 0);
			usage.outputTokens += Number(payload.output ?? 0);
			usage.totalTokens += Number(payload.total ?? 0);
			if (payload.cached !== null && payload.cached !== undefined && typeof payload.cached === "number") {
				usage.cachedTokens += payload.cached;
				receiptsReportingCache += 1;
			}
			const cached = typeof payload.cached === "number" ? ` · 缓存 ${payload.cached}` : "";
			timeline.push({ at: event.timestamp, source: "ledger", kind: "model-call", detail: `模型调用 ${String(payload.success === true ? "成功" : "失败")}：输入 ${Number(payload.input ?? 0)} / 输出 ${Number(payload.output ?? 0)} / 合计 ${Number(payload.total ?? 0)} tokens${cached}` });
			continue;
		}
		if (event.type === "scientific-tool-receipt") {
			const toolId = String(payload.toolId ?? "?");
			const entry = toolCounts.get(toolId) ?? { calls: 0, failures: 0 };
			entry.calls += 1;
			if (event.status === "failure") entry.failures += 1;
			toolCounts.set(toolId, entry);
			const wall = typeof payload.wallMs === "number" ? ` · ${Math.round(payload.wallMs)}ms` : "";
			const artifacts = Array.isArray(event.artifactIds) ? event.artifactIds.length : 0;
			timeline.push({ at: event.timestamp, source: "ledger", kind: "tool-receipt", detail: `工具 ${toolId} ${event.status === "success" ? "成功" : "失败"}${artifacts ? ` · 产出 ${artifacts} 条证据` : ""}${wall}${typeof payload.error === "string" && payload.error ? ` · ${payload.error.slice(0, 120)}` : ""}` });
			continue;
		}
		if (event.type === "node-start") timeline.push({ at: event.timestamp, source: "ledger", kind: "node-start", detail: `开始执行（第 ${Number(payload.attempt ?? 1)} 次尝试）` });
		else if (event.type === "node-verifying") timeline.push({ at: event.timestamp, source: "ledger", kind: "node-verifying", detail: "节点提交，进入验证" });
		else if (event.type === "node-completed") timeline.push({ at: event.timestamp, source: "ledger", kind: "node-completed", detail: `验证通过${Array.isArray(payload.evidenceIds) && payload.evidenceIds.length ? ` · 接受证据 ${payload.evidenceIds.length} 条` : ""}` });
		else if (event.type === "node-failed") timeline.push({ at: event.timestamp, source: "ledger", kind: "node-failed", detail: `失败（${String(payload.class ?? "unknown")}）：${String(payload.message ?? "").slice(0, 160)}` });
		else if (event.type === "node-verification-failed") timeline.push({ at: event.timestamp, source: "ledger", kind: "node-verification-failed", detail: `验证未通过：${Array.isArray(payload.issues) ? payload.issues.map(String).join("; ").slice(0, 200) : ""}` });
		else if (event.type === "node-retry-ready") timeline.push({ at: event.timestamp, source: "ledger", kind: "node-retry", detail: `准备第 ${Number(payload.attempts ?? 1) + 1} 次尝试` });
	}
	const cacheBase = usage.cachedTokens + usage.inputTokens;
	usage.cacheHitRate = receiptsReportingCache > 0 && cacheBase > 0 ? usage.cachedTokens / cacheBase : receiptsReportingCache > 0 ? 0 : null;
	for (const line of input.session) {
		const at = line.t ?? line.at ?? "";
		if (line.kind === "truncated") { timeline.push({ at, source: "session", kind: "truncated", detail: line.detail ?? "" }); continue; }
		if (line.kind === "thinking" || line.kind === "text" || line.kind === "tool-start" || line.kind === "tool-end") timeline.push({ at, source: "session", kind: line.kind, isError: line.isError, detail: String(line.detail ?? "").slice(0, 600) });
	}
	timeline.sort((left, right) => (left.at || "").localeCompare(right.at || ""));
	const limit = input.timelineLimit ?? TIMELINE_LIMIT;
	const timelineTruncated = timeline.length > limit;
	return {
		nodeId: input.node.id,
		kind: input.node.kind,
		title: input.node.title,
		state: input.node.state,
		attempts: input.node.attempts,
		usage,
		tools: [...toolCounts.entries()].map(([toolId, counts]) => ({ toolId, ...counts })).sort((left, right) => right.calls - left.calls),
		submission: input.submission ?? null,
		timeline: timelineTruncated ? timeline.slice(-limit) : timeline,
		timelineTruncated,
	};
}
