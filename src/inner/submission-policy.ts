/** Pure submission state and quiz preflight policy. */
export type CandidateAnswer = Record<string, unknown>;

export interface SubmissionState {
	answer: CandidateAnswer | null;
	publicHistory: { score: number | null; note: string }[];
	bestPublic: number | null;
	bestAnswer: CandidateAnswer | null;
	submits: number;
	staleSubmits: number;
	finished: boolean;
	lastFeedback: string;
}

export function createSubmissionState(): SubmissionState {
	return {
		answer: null,
		publicHistory: [],
		bestPublic: null,
		bestAnswer: null,
		submits: 0,
		staleSubmits: 0,
		finished: false,
		lastFeedback: "",
	};
}

/** Register one completed public evaluation. Equal scores retain the newest
 * candidate because quantized public splits may hide real private differences. */
export function recordPublicSubmission(
	state: SubmissionState,
	answer: CandidateAnswer,
	score: number | null,
	note = "",
): { improved: boolean } {
	state.publicHistory.push({ score, note });
	const improved = score != null && (state.bestPublic == null || score >= state.bestPublic);
	if (improved) {
		state.bestPublic = score;
		state.bestAnswer = answer;
		state.staleSubmits = 0;
	} else {
		state.staleSubmits += 1;
	}
	state.answer = answer;
	return { improved };
}

export interface QuizQuestionShape {
	qid: string;
	kind?: string;
	options?: string[] | null;
}

export interface QuizPreflightResult {
	total: number;
	covered: number;
	issues: string[];
}

/** Validate shape/coverage only. This function receives no gold answers. */
export function validateQuizSubmission(
	answer: CandidateAnswer,
	questions: readonly QuizQuestionShape[],
	minimumCoverage = 0.5,
): QuizPreflightResult {
	const total = questions.length;
	const answeredKeys = Object.keys(answer).filter((key) => {
		const value = answer[key];
		return value !== undefined && value !== null && String(value).trim() !== "";
	});
	const covered = answeredKeys.length;
	const issues: string[] = [];
	if (total > 0 && covered / total < minimumCoverage) {
		issues.push(`only ${covered}/${total} answered (${Math.round((covered / total) * 100)}%) — unanswered score ZERO`);
	}
	const qids = new Set(questions.map((question) => question.qid));
	const unknownQids = Object.keys(answer).filter((key) => !qids.has(key));
	if (unknownQids.length > 0) {
		issues.push(`${unknownQids.length} answers reference unknown qids (e.g. ${unknownQids[0]}) — check you used the exact qids from data/quiz.jsonl`);
	}
	let badFormat = 0;
	for (const question of questions) {
		const value = answer[question.qid];
		if (value === undefined || value === null || String(value).trim() === "") continue;
		const text = String(value).trim();
		if (question.kind === "mcq" && question.options && question.options.length > 0) {
			if (!(/^[a-jA-J]$/.test(text) || question.options.some((option) => option.trim() === text))) badFormat += 1;
		} else if (question.kind === "tf" && !/^(true|false|t|f|yes|no|对|错|正确|错误)$/i.test(text.replace(/[。\.\s]/g, ""))) {
			badFormat += 1;
		}
	}
	if (badFormat > 0) issues.push(`${badFormat} answers look malformed for their question kind (mcq should be a bare letter like "B", tf should be true/false)`);
	return { total, covered, issues };
}
