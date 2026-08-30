/** Stable application contract for one research episode. */
export interface EpisodeIsolationEvidence {
	backend: "sandboxie-app-level" | "host-audit";
	boxName?: string;
	exchangeWorkspace: string;
	reload?: boolean;
	processOwnershipVerified?: boolean;
	networkProbe?: Record<string, unknown>;
	cleanup?: Record<string, unknown>;
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
	/** knowledge/retrieval evidence injected into this episode */
	knowledgeIds: string[];
	knowledgeVersion?: string;
	ragDocumentIds?: string[];
	ragCorpusVersion?: string;
}

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
