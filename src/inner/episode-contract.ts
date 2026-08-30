import type { Model } from "@earendil-works/pi-ai";
import type { Config } from "../config.js";
import type { EvalContext, Problem } from "../bench/eval.js";
import type { Scaffold } from "../scaffold.js";
import type { MemoryStore } from "../memory.js";
import type { RunController } from "../loopctl.js";
import type { RsiEvent } from "../tui/events.js";

/** Stable application contract for one research episode. */
export interface EpisodeIsolationEvidence {
	backend: "sandboxie-app-level" | "host-audit";
	boxName?: string;
	exchangeWorkspace: string;
	reload?: boolean;
	processOwnershipVerified?: boolean;
	networkMode?: "blocked" | "open";
	/** true only when the configured policy intentionally denies episode egress */
	networkIsolationClaim?: boolean;
	networkProbe?: Record<string, unknown>;
	cleanup?: Record<string, unknown>;
}

export interface EpisodeModelCallReceipt {
	id: string;
	provider: string;
	model: string;
	requestedThinking: string;
	effectiveThinking: string;
	inputTokens: number | null;
	outputTokens: number | null;
	reasoningTokens: number | null;
	totalTokens: number;
	success: boolean;
}

export interface EpisodeResult {
	problemId: string;
	fitness: number | null;
	bestPublic: number | null;
	submits: number;
	turns: number;
	tokens: number;
	secs: number;
	error: string | null;
	warnings: string[];
	workspace: string;
	/** sanitized durable evidence location requested by the caller */
	durableWorkspace: string;
	/** app-level isolation evidence; host-audit is explicit non-sandbox mode */
	isolation?: EpisodeIsolationEvidence;
	/** driver routed a workspace candidate through the normal public submit */
	submissionRecovery?: "candidate-file-driver";
	/** quiz coverage recorded in durable evidence for crash diagnosis */
	answerCount?: number;
	answerTotal?: number;
	publicHistory?: { score: number | null; note: string }[];
	modelCalls?: EpisodeModelCallReceipt[];
	/** knowledge/retrieval evidence injected into this episode */
	knowledgeIds: string[];
	knowledgeVersion?: string;
	ragDocumentIds?: string[];
	ragCorpusVersion?: string;
}

export interface EpisodeRequest {
	cfg: Config;
	problem: Problem;
	evalCtx: EvalContext;
	scaffold: Scaffold;
	model: Model<any>;
	workspace: string;
	memory: MemoryStore;
	log?: (message: string) => void;
	emit?: (event: RsiEvent) => void;
	onAgentDelta?: (kind: "thinking" | "text", delta: string) => void;
	onToolEvent?: (event: { phase: "start" | "end"; tool: string; detail: string; isError?: boolean }) => void;
	persistKnowledgeUsage?: boolean;
	controller?: RunController;
	tag: string;
}

export type EpisodeExecutor = (request: EpisodeRequest) => Promise<EpisodeResult>;

export function failedEpisodeResult(problemId: string, workspace: string, error: unknown): EpisodeResult {
	return {
		problemId,
		fitness: null,
		bestPublic: null,
		submits: 0,
		turns: 0,
		tokens: 0,
		secs: 0,
		error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : String(error).slice(0, 500),
		warnings: [],
		workspace,
		durableWorkspace: workspace,
		knowledgeIds: [],
	};
}
