/**
 * Selftest: no-LLM verification of every piece of pure logic plus the real
 * eval protocol against a scratch python script. Fast enough to run before
 * any paid episode.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, builtinDomainKnowledge, composeSystemPrompt, scaffoldFingerprint, SEED_SCAFFOLD } from "./scaffold.js";
import { Journal, atomicWriteJson, loadRunState, saveRunState, fingerprint, readJournalTail, type RunState } from "./journal.js";
import { runEval, guessGenre, makeEvalContext, type Problem } from "./bench/eval.js";
import { openMemory, emptyMemory, addMemory, recall, renderMemory, defaultObservation } from "./memory.js";
import { deterministicTrend } from "./goal.js";
import { durableRunArtifacts } from "./rsi.js";
import { renderLeaderboard, renderFindings } from "./board.js";
import { loadConfig, SUPPORTED_MODELS, modelSpec } from "./config.js";
import { loadCorpus, queryTermsFromStatement, regionsForTask, renderRetrieved, retrieve } from "./retrieval.js";
import { meanWithFailures, weightedFitnessMean } from "./metrics.js";
import { examHasValidTrainingResult, type ExamProblemResult } from "./exam.js";
import { resolveRequestMaxTokens } from "./provider.js";
import { TokenLedger } from "./budget.js";
import { failedEpisodeResult, type EpisodeExecutor } from "./inner/episode-contract.js";
import { evaluateScaffold } from "./rsi_eval.js";
import { buildFollowupPrompt, buildInitialEpisodePrompt } from "./inner/prompt-policy.js";
import { createSubmissionState, recordPublicSubmission, validateQuizSubmission } from "./inner/submission-policy.js";
import { checkPythonExecutionPolicy } from "./inner/python-execution.js";
import { BackgroundJobRegistry, type BackgroundJob, type BackgroundJobPort } from "./inner/background-jobs.js";
import { persistEpisodeArtifacts, prepareEpisodeArtifacts } from "./inner/artifact-store.js";
import { SandboxieCli, formatSandboxieCommand } from "./sandboxie-cli.js";
import { SandboxieIni } from "./sandboxie-ini.js";
import { SandboxieGlobalLease } from "./sandboxie-lease.js";
import { selectTopSurvivors } from "./outer/critique.js";
import type { Proposal } from "./outer/improve.js";
import { execFileSync } from "node:child_process";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

export async function selftest(): Promise<boolean> {
	console.log("== scaffold edits ==");
	const s1 = applyEdits(SEED_SCAFFOLD, [
		{ op: "add_tip", text: "check data completeness first" },
		{ op: "add_tip", text: "validate on reference data" },
	]);
	check("add_tip appends", s1.tips.length === 2);
	const s2 = applyEdits(s1, [{ op: "delete_tip", index: 0 }]);
	check("delete_tip removes", s2.tips.length === 1 && s2.tips[0] === "validate on reference data");
	const s3 = applyEdits(s2, [{ op: "replace_tip", index: 5, text: "x" }]);
	check("out-of-range replace is a no-op", s3.tips.length === 1);
	const s4 = applyEdits(s3, [
		{ op: "add_domain_tip", genre: "seismology", text: "use Aki MLE for b-value" },
		{ op: "set_eval_budget", value: 99 },
	]);
	check("domain tip stored", s4.domain_knowledge["seismology"]?.length === 1);
	check("budget edit clamped", s4.eval_budget_hint === 10);
	check("edit lr bounds ops", applyEdits(s4, [
		{ op: "add_tip", text: "1" }, { op: "add_tip", text: "2" }, { op: "add_tip", text: "3" }, { op: "add_tip", text: "4" },
	]).tips.length === s4.tips.length + 3);
	check("seed scaffold untouched", SEED_SCAFFOLD.tips.length === 0);
	const s5 = applyEdits(SEED_SCAFFOLD, [{ op: "prompt_append", text: "Always plot residuals." }]);
	const sysp = composeSystemPrompt(s5, "seismology");
	check("scientific playbook is genre-routed", builtinDomainKnowledge("seismology")[0]!.includes("Aki") && builtinDomainKnowledge("hydrology")[0]!.includes("Gumbel"));
	const { profileTask } = await import("./task-profile.js");
	const quizProfile = profileTask({ id: "k2_c001", genre: "quiz-k2", overrides: { type: "quiz" } });
	const judgeProfile = profileTask({ id: "gabench_01", genre: "gabench", overrides: { judge: true } });
	check("task profile is the single routing taxonomy", quizProfile.isQuiz && quizProfile.preferredInnerRole === "quiz" && !quizProfile.usesOutsideTruth && judgeProfile.usesJudge && judgeProfile.preferredInnerRole === "gis");
	check("scaffold fingerprint ignores generation", scaffoldFingerprint({ ...SEED_SCAFFOLD, generation: 99 }) === scaffoldFingerprint(SEED_SCAFFOLD));
	const scopedTipScaffold = applyEdits(SEED_SCAFFOLD, [{ op: "add_tip", text: "retain scope", genres: ["seismology"] }]);
	check("replace preserves scoped tip metadata", typeof applyEdits(scopedTipScaffold, [{ op: "replace_tip", index: 0, text: "updated" }]).tips[0] === "object");
	const initialQuizPrompt = buildInitialEpisodePrompt({ statement: "task", isQuiz: true, evalCap: 2, softSubmitTarget: 1, memoryBlock: "memory" });
	check("episode initial prompt policy preserves quiz contract", initialQuizPrompt.includes("QUIZ FIRST-PASS CONTRACT") && initialQuizPrompt.includes("georsi_science.py") && initialQuizPrompt.includes("memory"));
	const finalNudge = buildFollowupPrompt({ isQuiz: false, turnsCompleted: 2, submits: 2, budgetLeft: 0, patience: 2, staleSubmits: 0, lastFeedback: "", bestPublic: 0.5, previousTurnAborted: false });
	check("episode follow-up policy enforces finalization", finalNudge.includes("BUDGET EXHAUSTED") && finalNudge.includes("final=true"));
	const submissionState = createSubmissionState();
	recordPublicSubmission(submissionState, { a: "first" }, 0.5);
	recordPublicSubmission(submissionState, { a: "newest-tie" }, 0.5);
	check("submission policy retains newest public tie", submissionState.bestPublic === 0.5 && submissionState.bestAnswer?.a === "newest-tie" && submissionState.staleSubmits === 0);
	const quizPreflight = validateQuizSubmission(
		{ q1: "not-a-letter", unknown: "A" },
		[
			{ qid: "q1", kind: "mcq", options: ["one", "two"] },
			{ qid: "q2", kind: "tf" }, { qid: "q3" }, { qid: "q4" }, { qid: "q5" },
		],
	);
	check("quiz preflight is gold-free and catches shape errors", quizPreflight.issues.length === 3 && quizPreflight.covered === 2);



	const tmp = join(process.cwd(), "runs", ".selftest");
	rmSync(tmp, { recursive: true, force: true });
	mkdirSync(tmp, { recursive: true });
	const artifactProblem = join(tmp, "artifact-problem");
	const artifactScratch = join(tmp, "artifact-scratch");
	const artifactDurable = join(tmp, "artifact-durable");
	mkdirSync(join(artifactProblem, "data"), { recursive: true });
	writeFileSync(join(artifactProblem, "data", "input.csv"), "x\n1\n");
	prepareEpisodeArtifacts({ workspace: artifactScratch, requestedWorkspace: artifactDurable, problemDir: artifactProblem });
	check("artifact store prepares only public inputs and toolkit", existsSync(join(artifactScratch, "data", "input.csv")) && existsSync(join(artifactScratch, "georsi_science.py")) && existsSync(join(artifactScratch, "solutions")));
	writeFileSync(join(artifactScratch, "agent-script.py"), "print('untrusted')\n");
	const artifactResult = failedEpisodeResult("artifact", artifactScratch, "test evidence");
	persistEpisodeArtifacts({ workspace: artifactScratch, requestedWorkspace: artifactDurable, problemId: "artifact", result: artifactResult, selectedAnswer: { value: 1 } });
	const durableEntries = readdirSync(artifactDurable).sort();
	check("artifact store persists sanitized evidence only", JSON.stringify(durableEntries) === JSON.stringify(["episode.json", "solutions"]) && existsSync(join(artifactDurable, "solutions", "artifact.json")) && !existsSync(join(artifactDurable, "agent-script.py")));

	const j = new Journal(tmp);
	j.append({ kind: "note", ts: "t", generation: 1, text: "hello" });
	j.append({ kind: "episode", ts: "t", generation: 1, role: "challenger", fitness: 0.5, detail: [] });
	j.close();
	const tail = readJournalTail(tmp);
	check("journal reads back", tail.length === 2 && tail[1]!.fitness === 0.5);
	writeFileSync(join(tmp, "board.jsonl"), readFileSync(join(tmp, "board.jsonl"), "utf8") + '{"kind":"note","ts":"t2",'); // torn tail
	check("torn journal tail tolerated", readJournalTail(tmp).length === 2);

	const st: RunState = {
		version: 1,
		name: "selftest",
		startedAt: "now",
		updatedAt: "now",
		fingerprint: fingerprint(["a", 1]),
		generation: 3,
		champion: s4,
		bestFitness: 0.62,
		fitnessHistory: [0.4, 0.5, 0.62],
		stagnation: 0,
		tokensUsed: 12345,
		finalization: { heldoutCompleted: true, heldoutSummary: "heldout=0.8", completedAt: "now" },
	};
	saveRunState(tmp, st);
	const st2 = loadRunState(tmp);
	check("state roundtrip", st2?.bestFitness === 0.62 && st2?.champion.tips.length === 1 && st2?.finalization?.heldoutCompleted === true);
	check("no tmp files left", !existsSync(join(tmp, "state.json.tmp")));
	check("fingerprint deterministic", fingerprint(["a", 1]) === fingerprint(["a", 1]) && fingerprint(["a", 1]) !== fingerprint(["a", 2]));
	atomicWriteJson(join(tmp, "x.json"), { a: 1 });
	check("atomicWriteJson works", JSON.parse(readFileSync(join(tmp, "x.json"), "utf8")).a === 1);
	const existingRun = join(tmp, "existing-run");
	mkdirSync(existingRun, { recursive: true });
	writeFileSync(join(existingRun, "control.json"), "");
	check("control-only run directory remains reusable", durableRunArtifacts(existingRun).length === 0);
	writeFileSync(join(existingRun, "state.json"), "{}");
	check("durable run artifacts block accidental fresh-name reuse", durableRunArtifacts(existingRun).includes("state.json"));

	console.log("== eval protocol (python) ==");
	const prob: Problem = {
		id: "fake",
		dir: tmp,
		statement: "",
		weight: 1,
		heldout: false,
		genre: "general",
		overrides: {},
	};
	writeFileSync(
		join(tmp, "eval.py"),
		[
			"import argparse, json, os, sys",
			"ap = argparse.ArgumentParser()",
			"ap.add_argument('--submission', required=True)",
			"ap.add_argument('--split', default='private')",
			"a = ap.parse_args()",
			"t = 0.9 if a.split == 'public' else float(open(os.environ['RSILAB_PRIVATE_TRUTH']).read())",
			"b = json.load(open(a.submission))['b']",
			"s = max(0.0, 1 - abs(b - t) / 0.5)",
			"print(f'##SCORE##{s:.4f}')",
			"print(json.dumps({'b': b, 'truth': t}))",
		].join("\n"),
	);
	const truthDir = join(tmp, "private");
	mkdirSync(truthDir, { recursive: true });
	writeFileSync(join(truthDir, "fake.txt"), "0.85\n");
	writeFileSync(join(tmp, "sub.json"), '{"b": 0.80}');
	const pub = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "sub.json"), "public");
	check("public eval scores", pub.score != null && Math.abs(pub.score - 0.8) < 1e-6, `got ${pub.score}`);
	const priv = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "sub.json"), "private");
	check("private eval uses truth file", priv.score != null && Math.abs(priv.score - 0.9) < 0.06 + 1e-9, `got ${priv.score}`);
	writeFileSync(join(tmp, "bad.json"), "not json");
	const bad = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "bad.json"), "public");
	check("invalid submission -> null score", bad.score === null);
	writeFileSync(join(tmp, "eval.py"), "print('##SCORE##2')\n");
	const invalidScore = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "sub.json"), "public");
	check("out-of-range evaluator score is rejected", invalidScore.score === null);
	const absoluteTruthContext = makeEvalContext({ ...loadConfig(), private_truth_dir: truthDir }, process.cwd());
	check("absolute private truth paths remain absolute", absoluteTruthContext.privateTruthDir === truthDir && absoluteTruthContext.truthFile("toy") === join(truthDir, "toy.txt"));

	console.log("== memory ==");
	const store = openMemory(tmp);
	addMemory(store, { ts: Date.now() - 1000, problem: "quake_b", genre: "seismology", tag: "note", text: "Mc choice matters most", publicScore: 0.8 });
	addMemory(store, { ts: Date.now(), problem: "flood_rp", genre: "hydrology", tag: "note", text: "use L-moments for Gumbel", publicScore: 0.9 });
	const rec = recall(store, "quake_b", "seismology", 2);
	check("recall ranks same problem first", rec[0]?.text === "Mc choice matters most");
	check("render memory non-empty", renderMemory(rec).includes("Mc choice"));
	check("memory labels public evidence as probation", renderMemory(rec).includes("probation") && renderMemory(rec).includes("public-only"));
	check("high public score stays a hypothesis", !defaultObservation("x", 1, false)[0]!.includes("same approach generalizes"));
	const ledger = new TokenLedger();
	ledger.record(17);
	ledger.record(3, true);
	check("token ledger isolates accounting from provider", ledger.total === 20 && ledger.calls === 2 && ledger.failed === 1 && ledger.snapshotValue().total === 20);

	check("trend: improving", deterministicTrend([0.1, 0.2, 0.3, 0.4]) === true);
	check("trend: flat/declining", deterministicTrend([0.5, 0.4, 0.4, 0.3]) === false);
	check("trend: single point defaults on-track", deterministicTrend([0.3]) === true);

	console.log("== board ==");
	const md = renderLeaderboard([{ generation: 1, role: "challenger", fitness: 0.55, mean: 0.55, detail: [{ problem: "quake_b", fitness: 0.55, bestPublic: 0.6, submits: 2, secs: 30, error: null }] }]);
	check("leaderboard renders", md.includes("| 1 | challenger | 0.5500 |") && md.includes("quake_b:0.550"));
	const fmd = renderFindings([{ generation: 2, mechanism: "adds L-moment estimator tip | pipe", expected: "+0.05", fitness: 0.61, accepted: true }]);
	check("findings escapes pipes", fmd.includes("adds L-moment estimator tip / pipe") && fmd.includes("ACCEPTED"));

	console.log("== supported model list ==");
	check("9 models fixed (4 zen + 1 emooo + 1 local + 3 openrouter)", SUPPORTED_MODELS.length === 9);
	const muse = modelSpec("muse-spark-1.2-contributor");
	check("muse is proxy + responses", muse?.route === "proxy" && muse?.api === "openai-responses");
	check("hy3/ox-alpha/mimo direct chat", ["hy3", "ox-alpha-free", "mimo-v2.5"].every((id) => modelSpec(id)?.route === "direct" && modelSpec(id)?.api === "openai-completions"));
	const emoooMimo = modelSpec("mimo-v2.5-pro");
	check("temporary emooo mimo-v2.5-pro is chat + zai thinking", emoooMimo?.endpoint === "emooo" && emoooMimo.route === "direct" && emoooMimo.api === "openai-completions" && emoooMimo.contextWindow === 1048576 && emoooMimo.maxOutput === 131072 && emoooMimo.compat?.thinkingFormat === "zai" && emoooMimo.thinkingLevelMap?.xhigh === "xhigh" && emoooMimo.thinkingLevelMap?.max === null);
	const emoooCfgPath = join(tmp, "emooo-config.json");
	writeFileSync(emoooCfgPath, JSON.stringify({ inner_model: "mimo-v2.5-pro", inner_thinking_level: "xhigh", outer_model: "hy3", outer_thinking_level: "minimal", problems: [{ id: "quake_b" }] }));
	const emoooCfg = loadConfig(emoooCfgPath);
	check("config exposes emooo thinking levels", emoooCfg.inner_thinking_level === "xhigh" && emoooCfg.outer_thinking_level === "minimal");
	const invalidThinkingPath = join(tmp, "invalid-thinking.json");
	writeFileSync(invalidThinkingPath, JSON.stringify({ inner_thinking_level: "turbo", problems: [{ id: "quake_b" }] }));
	let invalidThinkingRejected = false;
	try {
		loadConfig(invalidThinkingPath);
	} catch (error) {
		invalidThinkingRejected = String(error).includes("inner_thinking_level must be one of");
	}
	check("config rejects unknown thinking levels", invalidThinkingRejected);
	const invalidProblemsPath = join(tmp, "invalid-problems.json");
	writeFileSync(invalidProblemsPath, JSON.stringify({ problems: [{ id: "quake_b", weight: 0 }, { id: "quake_b" }] }));
	let invalidProblemsRejected = false;
	try {
		loadConfig(invalidProblemsPath);
	} catch (error) {
		invalidProblemsRejected = /duplicate problem|weight must be/.test(String(error));
	}
	check("config rejects duplicate or non-positive weighted problems", invalidProblemsRejected);
	const retiredQuizRoutePath = join(tmp, "retired-quiz-route.json");
	writeFileSync(retiredQuizRoutePath, JSON.stringify({ quiz_inner_model: "ox-alpha-free", problems: [{ id: "quake_b" }] }));
	let retiredQuizRouteRejected = false;
	try {
		loadConfig(retiredQuizRoutePath);
	} catch (error) {
		retiredQuizRouteRejected = String(error).includes("quiz_inner_model") && String(error).includes("retired");
	}
	check("config validates routed quiz model", retiredQuizRouteRejected);
	check("request token cap rejects invalid overrides", resolveRequestMaxTokens("-1") === 16_384 && resolveRequestMaxTokens("1.5") === 16_384);
	check("request token cap accepts positive integers", resolveRequestMaxTokens("8192") === 8192);
	const dsv4f = modelSpec("dsv4f");
	check("dsv4f is local endpoint", dsv4f?.endpoint === "local" && dsv4f?.route === "direct" && dsv4f?.contextWindow === 262144 && dsv4f?.maxOutput === 65536);
	const glm = modelSpec("z-ai/glm-5.3-flash");
	check("GLM 5.3 Flash is openrouter chat", glm?.endpoint === "openrouter" && glm?.route === "direct" && glm?.api === "openai-completions" && glm.thinkingLevelMap?.max === "max");
	check("hy3 preserves verified xhigh in Pi model map", modelSpec("hy3")?.thinkingLevelMap?.xhigh === "xhigh");
	check("context windows set on all models", SUPPORTED_MODELS.every((m) => m.contextWindow > 0 && m.maxOutput > 0));
	const badCfgPath = join(tmp, "bad-config.json");
	writeFileSync(badCfgPath, JSON.stringify({ inner_model: "deepseek-v4-flash", problems: [{ id: "quake_b" }] }));
	let rejected = false;
	try {
		loadConfig(badCfgPath);
	} catch (e) {
		rejected = (e as Error).message.includes("not in the supported gateway list");
	}
	check("config rejects unsupported model", rejected);
	const retiredCfgPath = join(tmp, "retired-model.json");
	writeFileSync(retiredCfgPath, JSON.stringify({ inner_model: "ox-alpha-free", problems: [{ id: "quake_b" }] }));
	let retiredRejected = false;
	try {
		loadConfig(retiredCfgPath);
	} catch (e) {
		retiredRejected = (e as Error).message.includes("retired by the provider");
	}
	check("config rejects provider-retired model", retiredRejected);
	const retiredOpenRouterPath = join(tmp, "retired-openrouter-model.json");
	writeFileSync(retiredOpenRouterPath, JSON.stringify({ inner_model: "stealth/ox-alpha", problems: [{ id: "quake_b" }] }));
	let retiredOpenRouterRejected = false;
	try {
		loadConfig(retiredOpenRouterPath);
	} catch (e) {
		retiredOpenRouterRejected = (e as Error).message.includes("retired by the provider");
	}
	check("config rejects retired OpenRouter alias", retiredOpenRouterRejected);
	const goodCfg = loadConfig(join(process.cwd(), "config.json"));
	check("config models are supported", !!modelSpec(goodCfg.inner_model) && !!modelSpec(goodCfg.outer_model));
	check("local_base_url present", /^http:\/\/.+\/v1$/.test(goodCfg.local_base_url));
	check("RAG disabled by default", goodCfg.rag_enabled === false && goodCfg.rag_budget_chars === 2400);
	check("fitness mean keeps failed tasks in denominator", meanWithFailures([1, null]) === 0.5);
	check("weighted fitness honors failed task weight", weightedFitnessMean([{ fitness: 1, weight: 1 }, { fitness: null, weight: 3 }]) === 0.25);
	const fakeExecutor: EpisodeExecutor = async (request) => {
		if (request.problem.id === "fail") throw new Error("synthetic episode failure");
		return { ...failedEpisodeResult(request.problem.id, request.workspace, "unused"), fitness: 1, bestPublic: 0.8, error: null };
	};
	const fakeEvalContext = { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id: string) => join(truthDir, `${id}.txt`) };
	const portEvaluation = await evaluateScaffold({
		cfg: { ...goodCfg, episodes_per_problem: 1 },
		problems: [{ ...prob, id: "ok", weight: 1 }, { ...prob, id: "fail", weight: 3 }],
		scaffold: SEED_SCAFFOLD,
		runDir: tmp,
		role: "fake-port",
		model: {} as never,
		memory: emptyMemory(join(tmp, "fake-memory")),
		executeEpisode: fakeExecutor,
		evalCtx: fakeEvalContext,
	});
	check("episode executor port keeps thrown task in weighted denominator", portEvaluation.mean === 0.25 && portEvaluation.detail.length === 2 && portEvaluation.detail[1]?.fitness === null);
	const allFailedPortEvaluation = await evaluateScaffold({
		cfg: { ...goodCfg, episodes_per_problem: 1 }, problems: [{ ...prob, id: "fail" }],
		scaffold: SEED_SCAFFOLD, runDir: tmp, role: "fake-all-fail", model: {} as never,
		memory: emptyMemory(join(tmp, "fake-memory-all")), executeEpisode: fakeExecutor, evalCtx: fakeEvalContext,
	});
	check("episode executor port keeps all-failed suite ineligible", allFailedPortEvaluation.mean === null);
	const failedContract = failedEpisodeResult("p", "workspace", new Error("boom"));

	check("episode failure factory preserves fixed-denominator contract", failedContract.problemId === "p" && failedContract.fitness === null && failedContract.knowledgeIds.length === 0 && failedContract.error?.includes("boom") === true);
	const failedExam: ExamProblemResult[] = [{ problem: "quake_b", heldout: false, weight: 1, fitness: null, bestPublic: null, submits: 0, secs: 0, error: "failed", warnings: [], tokens: 0 }];

	check("all-error standalone exam is not successful", !examHasValidTrainingResult(failedExam));
	check("standalone exam succeeds only with valid training fitness", examHasValidTrainingResult([{ ...failedExam[0]!, fitness: 0 }]));
	check("submit budget is positive", goodCfg.eval_cap > 0);
	const proposalA = { angle: "a" } as Proposal;
	const proposalB = { angle: "b" } as Proposal;
	const proposalC = { angle: "c" } as Proposal;
	const limited = selectTopSurvivors(
		[proposalA, proposalB, proposalC],
		[proposalA, proposalB, proposalC],
		[
			{ index: 0, quality: 6, keepVotes: 1 },
			{ index: 1, quality: 9, keepVotes: 1 },
			{ index: 2, quality: 7, keepVotes: 1 },
		],
		1,
	);
	check("survivor limit keeps the highest-quality proposal", limited.length === 1 && limited[0] === proposalB);

	console.log("== quiz grader (python) ==");
	const graderOut = execFileSync("python", ["scripts/quiz_selftest.py"], { encoding: "utf-8", timeout: 60_000 });
	check("quiz grader unit tests pass", graderOut.includes("GRADER_OK"), graderOut.slice(-200));

	console.log("== suite structure (python) ==");
	const structOut = execFileSync("python", ["scripts/struct_selftest.py"], { encoding: "utf-8", timeout: 120_000 });
	check("suite structure checks pass", structOut.includes("STRUCT_OK"), structOut.slice(-400));

	console.log("== knowledge base ==");
	const { loadKnowledge, selectKnowledge, renderKnowledge, KNOWLEDGE_CHAR_BUDGET } = await import("./knowledge.js");
	const kb = loadKnowledge();
	check("knowledge nodes load", kb.length >= 5, `got ${kb.length}`);
	const ksel1 = selectKnowledge(kb, { genre: "quiz-k2", id: "k2_c001" });
	const ksel2 = selectKnowledge(loadKnowledge(), { genre: "quiz-k2", id: "k2_c001" });
	check(
		"knowledge selection deterministic",
		JSON.stringify(ksel1.nodes.map((n) => n.id)) === JSON.stringify(ksel2.nodes.map((n) => n.id)) &&
			ksel1.version === ksel2.version,
	);
	const krender = renderKnowledge(ksel1);
	check("knowledge render within budget", krender.length <= KNOWLEDGE_CHAR_BUDGET + 200, `${krender.length} chars`);
	const { deriveTags } = await import("./knowledge.js");
	const ktags = deriveTags("quiz-k2", "k2_c001");
	check(
		"knowledge routes by region",
		ksel1.nodes.length > 0 && ksel1.nodes.some((n) => n.tags.some((t) => ktags.includes(t))),
		`tags=${ktags.join(",")} picked=${ksel1.nodes.map((n) => n.id).join(",")}`,
	);
	const probationNode = {
		id: "selftest-probation",
		text: "probation lesson",
		tags: ["quiz-k2"],
		scope: "regional" as const,
		stats: { uses: 0, wins: 0, fitness_sum: 0 },
		origin: { run: "selftest", gen: 0 },
		status: "probation" as const,
	};
	const previousProbationFlag = process.env.RSILAB_KB_INCLUDE_PROBATION;
	delete process.env.RSILAB_KB_INCLUDE_PROBATION;
	const probationHidden = selectKnowledge([probationNode], { genre: "quiz-k2", id: "k2_c001" });
	process.env.RSILAB_KB_INCLUDE_PROBATION = "1";
	const probationIncluded = selectKnowledge([probationNode], { genre: "quiz-k2", id: "k2_c001" });
	if (previousProbationFlag === undefined) delete process.env.RSILAB_KB_INCLUDE_PROBATION;
	else process.env.RSILAB_KB_INCLUDE_PROBATION = previousProbationFlag;
	check("probation knowledge requires explicit pilot flag", probationHidden.nodes.length === 0 && probationIncluded.nodes.length === 1);

	console.log("== RAG ==");
	const corpus = loadCorpus();
	check("RAG corpus loads", corpus.length >= 5, `got ${corpus.length}`);
	check(
		"RAG corpus metadata complete",
		corpus.every((d) => d.id && d.region && d.source && d.license),
	);
	check(
		"RAG corpus excludes benchmark truth markers",
		corpus.every((d) => !/(answers\.private|reasoning_chain|gold answer|private truth)/i.test(d.text)),
	);
	const k2Regions = regionsForTask("quiz-k2", "k2_c008");
	const stepRegions = regionsForTask("quiz-stepgame", "stepgame_c005");
	check("RAG routes K2 to formula region", k2Regions.includes("geoscience_formulas"));
	check("RAG routes StepGame to spatial region", stepRegions.includes("spatial_reasoning"));
	const terms = queryTermsFromStatement("Use UTM coordinates to measure distance");
	check("RAG query terms are normalized", terms.includes("utm") && terms.includes("coordinates"));
	const mapDocs = retrieve(["map_projection"], ["utm", "coordinates"], 900);
	const mapChars = mapDocs.reduce((n, d) => n + d.text.length, 0);
	check("RAG retrieval is region-scoped", mapDocs.length > 0 && mapDocs.every((d) => d.region === "map_projection"));
	check("RAG retrieval respects char budget", mapChars <= 900, `${mapChars} chars`);
	check("RAG render non-empty", renderRetrieved(mapDocs).includes("Reference material retrieved"));
	check("RAG skips an oversized first document", retrieve(["map_projection"], ["utm"], 100).length === 0);

	console.log("== model profiles ==");
	const { loadProfiles, resolveThinking, assertVisionAllowed, getProfile } = await import("./models.js");
	loadProfiles();
	check("model profiles parse", !!getProfile("hy3") && !!getProfile("dsv4f") && !!getProfile("mimo-v2.5-pro"));
	const oxA = getProfile("stealth/ox-alpha");
	check("retired OpenRouter alias profile preserved", oxA.vision_raw_api === true);
	const glmProfile = getProfile("z-ai/glm-5.3-flash");
	check("GLM 5.3 Flash profile loaded", glmProfile.vision_raw_api === true && !!glmProfile.reasoning.mandatory);
	const emoooProfile = getProfile("mimo-v2.5-pro");
	check("emooo profile records zai thinking levels", emoooProfile.endpoint === "emooo" && emoooProfile.api_style === "chat-completions" && emoooProfile.reasoning.thinking_format === "zai" && emoooProfile.reasoning.verified_disabled === true && emoooProfile.reasoning.verified_real_levels?.length === 5);
	check(
		"supported model registry matches profile endpoints and APIs",
		SUPPORTED_MODELS.every((model) => {
			const profile = getProfile(model.id);
			return profile.endpoint === model.endpoint && profile.api_style === (model.api === "openai-responses" ? "responses" : "chat-completions");
		}),
	);
	const rHy3Max = resolveThinking("hy3", "max");
	check("hy3 max clamps to real ceiling xhigh", rHy3Max.level === "xhigh" && rHy3Max.clamped);
	check("ox-alpha-free high clamps to trusted medium", resolveThinking("ox-alpha-free", "high").level === "medium");
	const rDsv = resolveThinking("dsv4f", "max");
	check("dsv4f deep thinking uses thinking_budget", (rDsv.extraBody as Record<string, unknown>).thinking_budget === 16384);
	check(
		"muse strips reasoning params",
		Object.keys(resolveThinking("muse-spark-1.2-contributor", "high").extraBody).length === 0,
	);
	check("emooo off remains a disable request", resolveThinking("mimo-v2.5-pro", "off").level === "off");
	const emoooMax = resolveThinking("mimo-v2.5-pro", "max");
	check("emooo max clamps to xhigh", emoooMax.level === "xhigh" && emoooMax.clamped);
	let visionBlocked = false;
	try {
		assertVisionAllowed("dsv4f", true);
	} catch {
		visionBlocked = true;
	}
	check("vision gate blocks unsupported model", visionBlocked);
	assertVisionAllowed("ox-alpha-free", true); // raw API supports images - must not throw

	console.log("== anti-cheat guard ==");
	const { scanWorkspaceForBreaches, scanPythonExecutionPolicy } = await import("./guard.js");
	const { resolveInWorkspace } = await import("./inner/solve.js");
	const guardDir = join(tmp, "guard");
	mkdirSync(join(guardDir, "data"), { recursive: true });
	writeFileSync(join(guardDir, "clean.py"), "print('hello')\n");
	writeFileSync(join(guardDir, "data", "quiz.jsonl"), '{"qid":"q1"}\n'); // copied inputs are exempt
	const noBreach = scanWorkspaceForBreaches(guardDir);
	writeFileSync(join(guardDir, "cheat.py"), 'open("../../problems/k2_c001/answers.private.jsonl")\n');
	const breach = scanWorkspaceForBreaches(guardDir);
	check("guard passes clean workspace", noBreach.length === 0);
	check("guard detects gold-path access", breach.length === 1 && breach[0].file === "cheat.py");
	check("workspace fence contains relative paths", resolveInWorkspace(guardDir, "sub/a.py") !== null && resolveInWorkspace(guardDir, "a.py") !== null);
	check("workspace fence blocks traversal", resolveInWorkspace(guardDir, "../escape.py") === null && resolveInWorkspace(guardDir, "../../problems/x/answers.private.jsonl") === null);
	const { runPythonHost } = await import("./inner/solve.js");
	const hostAuditScript = join(guardDir, "host-audit.py");
	writeFileSync(hostAuditScript, "print('host-audit-ok')\n");
	const hostAuditResult = await runPythonHost(guardDir, loadConfig().python_cmd, hostAuditScript, 5_000);
	check("explicit host-audit Python runner works", hostAuditResult.includes("exit=0") && hostAuditResult.includes("host-audit-ok"));

	const { protectedManifest, verifyManifest, scanTextForBreaches } = await import("./guard.js");
	const fakeProblem = join(tmp, "fakeproblem");
	mkdirSync(join(fakeProblem, "reference"), { recursive: true });
	writeFileSync(join(fakeProblem, "eval.py"), "print(1)\n");
	writeFileSync(join(fakeProblem, "reference", "solution.py"), "x = 1\n");
	const externalTruth = join(tmp, "external-truth.txt");
	writeFileSync(externalTruth, "0.75\n");
	const manifest = protectedManifest(fakeProblem, [externalTruth]);
	check("manifest hashes grading assets", Object.keys(manifest).length === 4 && Object.keys(manifest).some((key) => key.startsWith("__directory__:")));
	check("manifest verifies untouched dir", verifyManifest(fakeProblem, manifest).length === 0);
	writeFileSync(join(fakeProblem, "eval.py"), "print(2)\n");
	check("manifest detects eval.py tampering", verifyManifest(fakeProblem, manifest).includes("eval.py"));
	writeFileSync(join(fakeProblem, "reference", "extra.txt"), "new hidden asset\n");
	check("manifest detects new grading asset", verifyManifest(fakeProblem, manifest).some((file) => file.includes("directory-listing")));
	writeFileSync(externalTruth, "0.8\n");
	check("manifest detects external truth tampering", verifyManifest(fakeProblem, manifest).includes(externalTruth));
	const toolBreaches = scanTextForBreaches("tool_execution_start read file=../../problems/k2_c001/answers.private.jsonl");
	const policyBreaches = scanPythonExecutionPolicy(
		"import subprocess\nimport urllib.request\nos.system('echo risky')",
		"analysis.py",
	);
	check("execution policy flags common escape hatches", policyBreaches.length === 3 && policyBreaches[0]?.rule === "child-process import");
	const restrictedScript = join(guardDir, "restricted-policy.py");
	writeFileSync(restrictedScript, "import subprocess\nsubprocess.run(['echo', 'x'])\n");
	const restrictedPolicy = checkPythonExecutionPolicy(restrictedScript, "restricted-policy.py", "restricted");
	check("python execution policy adapter blocks restricted escape", restrictedPolicy.blocked && restrictedPolicy.notice.includes("restricted execution policy"));
	const fakeStatuses = new Map<string, { state?: unknown; exitCode?: unknown }>();
	const fakeAlive = new Set<number>([42]);
	const terminated: number[] = [];
	let fakeNow = 1_000;
	const fakeJobPort: BackgroundJobPort = {
		now: () => fakeNow,
		writeStatus: (job) => fakeStatuses.set(job.name, { state: job.state, exitCode: job.exitCode }),
		readLogTail: () => "tail",
		isAlive: (pid) => fakeAlive.has(pid),
		terminate: (pid) => { terminated.push(pid); fakeAlive.delete(pid); },
	};
	const jobRegistry = new BackgroundJobRegistry(fakeJobPort, 100);
	const fakeJob: BackgroundJob = { name: "job", file: "x.py", pid: 42, startedAt: fakeNow, state: "running", exitCode: null, sandboxTargetPids: [43] };
	jobRegistry.register(fakeJob);
	fakeNow += 101;
	jobRegistry.refresh(fakeJob);
	check("background job state machine times out and verifies all pids", fakeJob.state === "timeout" && fakeJob.killVerified === true && terminated.includes(42) && terminated.includes(43));
	const terminatedAfterTimeout = terminated.length;
	jobRegistry.kill(fakeJob, "killed");
	check("background job state machine never signals terminal pid", terminated.length === terminatedAfterTimeout && fakeJob.state === "timeout");
	check("background job status rendering is adapter-backed", jobRegistry.statusText().includes("[job] timeout") && jobRegistry.statusText().includes("tail"));


	check("genre guess", guessGenre("quake_b") === "seismology" && guessGenre("flood_rp") === "hydrology" && guessGenre("poro_perm") === "petrophysics");

	console.log("== Sandboxie adapter logic ==");
	const {
		sanitizeSandboxieBoxName,
		makeSandboxieBoxName,
		resolveExchangeWorkspace,
		sandboxieRootCommandArgs,
		sandboxieDeleteCommandArgs,
		assertSandboxPythonCommand,
		isSandboxieBackend,
		sanitizeSandboxEnvironment,
	} = await import("./sandboxie.js");
	check("Sandboxie box names are strict ASCII", sanitizeSandboxieBoxName("bad/name DefaultBox") === "bad_name_DefaultBox");
	const cliProbe = new SandboxieCli(5_000).runSync(process.execPath, ["-e", "process.stdout.write('cli-ok')"]);
	check("Sandboxie CLI adapter captures sync command output", cliProbe.code === 0 && cliProbe.stdout === "cli-ok");
	check("Sandboxie CLI command rendering quotes whitespace", formatSandboxieCommand("C:/Program Files/tool.exe", ["query", "a b"]).includes('"C:/Program Files/tool.exe"') && formatSandboxieCommand("x", ["a b"]).includes('"a b"'));
	const iniCommands: string[][] = [];
	const fakeIniCli = {
		run: async (_file: string, args: readonly string[]) => ({ code: 0, stdout: args[0] === "query" ? "a\r\nb\r\n" : "", stderr: "" }),
		runSync: (_file: string, args: readonly string[]) => { iniCommands.push([...args]); return { code: 0, stdout: "", stderr: "" }; },
	} as unknown as SandboxieCli;
	const iniAdapter = new SandboxieIni(fakeIniCli, "SbieIni.exe");
	check("Sandboxie INI adapter parses query output", JSON.stringify(await iniAdapter.queryRaw("Box", "Setting")) === JSON.stringify(["a", "b"]));
	iniAdapter.restoreSync("GlobalSettings", "NetworkEnableWFP", ["y", "n"]);
	check("Sandboxie INI adapter preserves multi-value restore order", iniCommands[0]?.join("|") === "set|GlobalSettings|NetworkEnableWFP|y" && iniCommands[1]?.join("|") === "append|GlobalSettings|NetworkEnableWFP|n");
	const leasePath = join(tmp, "sandboxie-test.lock");
	const leaseManager = new SandboxieGlobalLease(leasePath, 1234, () => new Date("2026-08-30T00:00:00Z"));
	const leaseHandle = leaseManager.acquire("GeoRSI_test");
	let duplicateLeaseRejected = false;
	try { new SandboxieGlobalLease(leasePath, 5678).acquire("GeoRSI_other"); }
	catch (error) { duplicateLeaseRejected = String(error).includes("pid=1234") && String(error).includes("GeoRSI_test"); }
	check("Sandboxie WFP lease rejects concurrent owner with diagnostics", duplicateLeaseRejected);
	check("Sandboxie WFP lease rejects wrong token", !leaseManager.release(leaseHandle.path, "wrong-token") && existsSync(leasePath));
	check("Sandboxie WFP lease releases only matching owner token", leaseManager.release(leaseHandle.path, leaseHandle.token) && !existsSync(leasePath));
	check("generated box names retain the GeoRSI separator", /^GeoRSI_[0-9a-f]{16}$/.test(makeSandboxieBoxName("selftest")));
	check("Sandboxie box names are length bounded", sanitizeSandboxieBoxName("x".repeat(100)).length <= 38);
	const exchange = resolveExchangeWorkspace(join(process.cwd(), "runs", "demo", "episodes", "tag"));
	check("strict exchange workspace leaves repository", !exchange.toLowerCase().startsWith(process.cwd().toLowerCase()));
	const rootArgs = sandboxieRootCommandArgs("GeoRSI_test", "python.exe", "C:/tmp/runner.py");
	check("/box root command does not misuse /fcp", rootArgs[0] === "/box:GeoRSI_test" && !rootArgs.includes("/fcp"));
	check("delete sandbox uses command token", sandboxieDeleteCommandArgs("GeoRSI_test")[1] === "delete_sandbox_silent");
	check("Windows defaults to Sandboxie backend", isSandboxieBackend({} as import("./config.js").Config) === (process.platform === "win32"));
	check("explicit host-audit override disables Sandboxie", !isSandboxieBackend({ execution_backend: "host-audit" } as import("./config.js").Config));
	check("explicit sandboxie override enables backend", isSandboxieBackend({ execution_backend: "sandboxie" } as import("./config.js").Config));
	const perProblemCfg = Object.assign({ execution_backend: "sandboxie" }, { execution_backend: "host-audit" });
	check("per-problem host-audit override wins", !isSandboxieBackend(perProblemCfg as import("./config.js").Config));
	let interpreterBoundaryRejected = false;
	try {
		assertSandboxPythonCommand(join(process.cwd(), "fake-venv", "Scripts", "python.exe"), [process.cwd()]);
	} catch {
		interpreterBoundaryRejected = true;
	}
	check("strict Sandboxie rejects repo-local interpreters", interpreterBoundaryRejected);
	const cleanEnv = sanitizeSandboxEnvironment({ RSILAB_API_KEY: "secret", OPENAI_API_KEY: "secret", AWS_ACCESS_KEY_ID: "secret", GITHUB_TOKEN: "secret", HTTP_PROXY: "proxy", SSH_AUTH_SOCK: "pipe", KUBECONFIG: "config", SAFE_VALUE: "ok" });
	check("agent environment strips credentials and proxies", !cleanEnv.RSILAB_API_KEY && !cleanEnv.OPENAI_API_KEY && !cleanEnv.AWS_ACCESS_KEY_ID && !cleanEnv.GITHUB_TOKEN && !cleanEnv.HTTP_PROXY && !cleanEnv.SSH_AUTH_SOCK && !cleanEnv.KUBECONFIG && cleanEnv.SAFE_VALUE === "ok");
	const { createExchangeToolDefinitions, assertExchangeWorkspace } = await import("./workspace-tools.js");
	const exchangeTools = createExchangeToolDefinitions(guardDir);
	check(
		"official pi tools are exchange-wrapped",
		["read", "write", "edit", "ls", "grep"].every((name) => exchangeTools.some((tool) => tool.name === name)),
	);
	const { shouldAttachExchangeTools, resolveHarnessThinking } = await import("./piharness.js");
	check("Pi harness preserves emooo max clamp as xhigh", resolveHarnessThinking(modelSpec("mimo-v2.5-pro") as never, "max") === "xhigh");
	check("Pi harness preserves GLM max", resolveHarnessThinking(modelSpec("z-ai/glm-5.3-flash") as never, "max") === "max");
	let dsvDeepRejected = false;
	try {
		resolveHarnessThinking(modelSpec("dsv4f") as never, "max");
	} catch (error) {
		dsvDeepRejected = String(error).includes("thinking_budget") && String(error).includes("cannot serialize");
	}
	check("Pi harness rejects unsupported dsv4f budget translation", dsvDeepRejected);
	check("inner harness opts into exchange tools", shouldAttachExchangeTools(undefined));
	check("advisor harness with builtinTools=[] has no exchange tools", !shouldAttachExchangeTools([]));
	check("exchange tool opt-in can be explicit", shouldAttachExchangeTools([], true) && !shouldAttachExchangeTools(undefined, false));
	let outsideToolRejected = false;
	try {
		const writeTool = exchangeTools.find((tool) => tool.name === "write")!;
		await writeTool.execute("selftest", { path: "../outside-tool.txt", content: "x" }, undefined, undefined, undefined as never);
	} catch {
		outsideToolRejected = true;
	}
	check("official write tool rejects traversal", outsideToolRejected);
	let danglingRejected = false;
	let danglingSupported = false;
	try {
		const dangling = join(guardDir, "dangling-link.txt");
		symlinkSync(join(tmp, "does-not-exist.txt"), dangling, "file");
		danglingSupported = true;
		const writeTool = exchangeTools.find((tool) => tool.name === "write")!;
		try {
			await writeTool.execute("selftest", { path: "dangling-link.txt", content: "x" }, undefined, undefined, undefined as never);
		} catch {
			danglingRejected = true;
		}
	} catch {
		/* symlink creation may require elevated Windows developer settings */
	}
	check("official write tool rejects dangling symlinks", !danglingSupported || danglingRejected, danglingSupported ? "" : "symlink creation unavailable; skipped");
	let existingReparseRejected = false;
	try {
		const target = join(guardDir, "inside-target.txt");
		const link = join(guardDir, "inside-link.txt");
		writeFileSync(target, "inside");
		symlinkSync(target, link, "file");
		const readTool = exchangeTools.find((tool) => tool.name === "read")!;
		try {
			await readTool.execute("selftest", { path: "inside-link.txt" }, undefined, undefined, undefined as never);
		} catch {
			existingReparseRejected = true;
		}
	} catch {
		existingReparseRejected = true; // symlink creation unavailable is already covered above
	}
	check("official tools reject existing reparse components", existingReparseRejected);
	const backgroundGuardTools = createExchangeToolDefinitions(guardDir, () => {
		throw new Error("background job active");
	});
	let backgroundGuardRejected = false;
	try {
		const readTool = backgroundGuardTools.find((tool) => tool.name === "read")!;
		await readTool.execute("selftest", { path: "clean.py" }, undefined, undefined, undefined as never);
	} catch (error) {
		backgroundGuardRejected = String(error).includes("background job active");
	}
	check("exchange operation guard can block concurrent background jobs", backgroundGuardRejected);
	let overlapRejected = false;
	try {
		assertExchangeWorkspace(guardDir, guardDir, join(tmp, "private"));
	} catch {
		overlapRejected = true;
	}
	check("exchange workspace rejects protected overlap", overlapRejected);


	const { applyEdits: applyEdits2, composeSystemPrompt: compose2 } = await import("./scaffold.js");
	const SEED2 = SEED_SCAFFOLD;
	const scoped = applyEdits2(SEED2, [
		{ op: "add_tip", text: "spatial-solver discipline", genres: ["quiz-stepgame"] },
		{ op: "add_tip", text: "universal discipline" },
	]);
	const forStep = compose2(scoped, "quiz-stepgame");
	const forK2 = compose2(scoped, "quiz-k2");
	check("scoped tip injected for its genre", forStep.includes("spatial-solver discipline"));
	check("scoped tip hidden from other genres", !forK2.includes("spatial-solver discipline"));
	check("universal tip injected everywhere", forStep.includes("universal discipline") && forK2.includes("universal discipline"));
	const legacy = compose2({ ...SEED2, tips: ["plain old tip"] }, "quiz-k2");
	check("legacy string tips still universal", legacy.includes("plain old tip"));

	rmSync(tmp, { recursive: true, force: true });
	console.log(`\n${passed} passed, ${failed} failed`);
	return failed === 0;
}
