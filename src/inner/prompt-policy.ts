/** Pure prompt policy for one research episode. */
export interface InitialEpisodePromptInput {
	statement: string;
	isQuiz: boolean;
	evalCap: number;
	softSubmitTarget: number;
	memoryBlock?: string;
}

export function buildInitialEpisodePrompt(input: InitialEpisodePromptInput): string {
	const quizFirstPass = input.isQuiz
		? "QUIZ FIRST-PASS CONTRACT: read data/quiz.jsonl once, make a best-effort answer for every item, write answers.json, and call submit with answers_file=\"answers.json\" and final=false in this first turn. Use compact answers and no long per-question explanation. A complete imperfect sheet is better than spending the turn on an unfinished derivation. Refine only after a public score.\n"
		: "";
	const openFirstPass = !input.isQuiz
		? "OPEN-TASK FIRST-PASS CONTRACT: inspect the statement and available data/tools, perform only the minimum checks needed to form a valid answer, and submit a complete best-effort artifact in this first turn with final=false. Do not spend the whole turn on exploratory narration or repeated analysis; an imperfect valid submission creates feedback for refinement.\n"
		: "";
	return (
		`${input.statement}\n\n` +
		`Environment: you are in a scratch workspace; the dataset is in data/. ` +
		`There is NO shell — write scripts to files (write tool) and execute them with the ` +
		`run_python tool (quick scripts) — for computations longer than a couple of minutes ` +
		`use start_job instead: it runs detached in the background and the system wakes you ` +
		`when it finishes (hours are fine). A public georsi_science.py toolkit is available ` +
		`for Aki b-values, Gumbel return levels, OLS slopes, and log-linear fits; inspect ` +
		`its source and validate its output on data/reference data rather than copying constants. ` +
		`Budget your time: a complete analysis in 2-4 scripts is ideal.\n` +
		quizFirstPass +
		openFirstPass +
		`You may submit up to ${input.evalCap} times; target at most ${input.softSubmitTarget} submissions unless public feedback shows a specific fix worth testing. ` +
		`SUBMISSION GATE: as soon as one executed script produces a candidate, stop exploratory analysis and call submit with that candidate. ` +
		`Do not end this turn after writing a solution file without calling submit; an approximate valid submission is better than an unsubmitted perfect answer. ` +
		`Finish by calling submit with final=true.\n` +
		(input.memoryBlock ? `\n${input.memoryBlock}\n` : "")
	);
}

export interface FollowupPromptInput {
	isQuiz: boolean;
	turnsCompleted: number;
	submits: number;
	budgetLeft: number;
	patience: number;
	staleSubmits: number;
	lastFeedback: string;
	bestPublic: number | null;
	previousTurnAborted: boolean;
	jobWake?: string;
}

export function buildFollowupPrompt(input: FollowupPromptInput): string {
	const jobWake = input.jobWake ?? "";
	if (input.isQuiz && input.submits === 0) {
		const batchHint = input.turnsCompleted >= 3
			? " Work in batches of 15-20 questions: answer a batch, merge it into answers.json, repeat. You may submit once ~90% are answered — partial submissions score partially."
			: "";
		return jobWake +
			"You have not submitted yet. Read data/quiz.jsonl, answer the questions, write answers.json ({qid: answer}), then call submit with answers_file=\"answers.json\". Unanswered questions count as wrong — always submit a complete sheet." +
			batchHint;
	}
	if (input.submits === 0) {
		return jobWake +
			"You have not submitted yet. Run your analysis, then call the submit tool with your answer. A valid early submission beats an unsubmitted perfect plan.";
	}
	if (input.budgetLeft <= 0 || input.staleSubmits >= input.patience || input.previousTurnAborted) {
		return jobWake +
			(input.budgetLeft <= 0
				? "SUBMISSION BUDGET EXHAUSTED. "
				: input.staleSubmits >= input.patience
					? "No improvement in recent submissions. "
					: "") +
			"Finalize now: call submit with final=true using your best answer. Do not start new analysis.";
	}
	return `${jobWake}${input.lastFeedback}\n` +
		`Public best: ${input.bestPublic?.toFixed(4) ?? "none"}. ` +
		`You have ${input.budgetLeft} submission(s) left — refine the method (or confirm current best with final=true).`;
}
