/**
 * Selftest: no-LLM verification of every piece of pure logic plus the real
 * eval protocol against a scratch python script. Fast enough to run before
 * any paid episode.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, composeSystemPrompt, SEED_SCAFFOLD } from "./scaffold.js";
import { Journal, atomicWriteJson, loadRunState, saveRunState, fingerprint, readJournalTail, type RunState } from "./journal.js";
import { runEval, guessGenre, type Problem } from "./bench/eval.js";
import { openMemory, addMemory, recall, renderMemory, defaultObservation } from "./memory.js";
import { deterministicTrend } from "./goal.js";
import { renderLeaderboard, renderFindings } from "./board.js";
import { loadConfig, SUPPORTED_MODELS, modelSpec } from "./config.js";
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
	check("prompt_append reaches system prompt", sysp.includes("Always plot residuals."));

	console.log("== journal / resume ==");
	const tmp = join(process.cwd(), "runs", ".selftest");
	rmSync(tmp, { recursive: true, force: true });
	mkdirSync(tmp, { recursive: true });
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
	};
	saveRunState(tmp, st);
	const st2 = loadRunState(tmp);
	check("state roundtrip", st2?.bestFitness === 0.62 && st2?.champion.tips.length === 1);
	check("no tmp files left", !existsSync(join(tmp, "state.json.tmp")));
	check("fingerprint deterministic", fingerprint(["a", 1]) === fingerprint(["a", 1]) && fingerprint(["a", 1]) !== fingerprint(["a", 2]));
	atomicWriteJson(join(tmp, "x.json"), { a: 1 });
	check("atomicWriteJson works", JSON.parse(readFileSync(join(tmp, "x.json"), "utf8")).a === 1);

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

	console.log("== memory ==");
	const store = openMemory(tmp);
	addMemory(store, { ts: Date.now() - 1000, problem: "quake_b", genre: "seismology", tag: "note", text: "Mc choice matters most", publicScore: 0.8 });
	addMemory(store, { ts: Date.now(), problem: "flood_rp", genre: "hydrology", tag: "note", text: "use L-moments for Gumbel", publicScore: 0.9 });
	const rec = recall(store, "quake_b", "seismology", 2);
	check("recall ranks same problem first", rec[0]?.text === "Mc choice matters most");
	check("render memory non-empty", renderMemory(rec).includes("Mc choice"));
	check("default observation failure path", defaultObservation("x", null, true)[0]!.includes("no valid submission"));

	console.log("== goal trend ==");
	check("trend: improving", deterministicTrend([0.1, 0.2, 0.3, 0.4]) === true);
	check("trend: flat/declining", deterministicTrend([0.5, 0.4, 0.4, 0.3]) === false);
	check("trend: single point defaults on-track", deterministicTrend([0.3]) === true);

	console.log("== board ==");
	const md = renderLeaderboard([{ generation: 1, role: "challenger", fitness: 0.55, mean: 0.55, detail: [{ problem: "quake_b", fitness: 0.55, bestPublic: 0.6, submits: 2, secs: 30, error: null }] }]);
	check("leaderboard renders", md.includes("| 1 | challenger | 0.5500 |") && md.includes("quake_b:0.550"));
	const fmd = renderFindings([{ generation: 2, mechanism: "adds L-moment estimator tip | pipe", expected: "+0.05", fitness: 0.61, accepted: true }]);
	check("findings escapes pipes", fmd.includes("adds L-moment estimator tip / pipe") && fmd.includes("ACCEPTED"));

	console.log("== supported model list ==");
	check("7 models fixed (4 gateway + 1 local + 2 openrouter)", SUPPORTED_MODELS.length === 7);
	const muse = modelSpec("muse-spark-1.2-contributor");
	check("muse is proxy + responses", muse?.route === "proxy" && muse?.api === "openai-responses");
	check("hy3/ox-alpha/mimo direct chat", ["hy3", "ox-alpha-free", "mimo-v2.5"].every((id) => modelSpec(id)?.route === "direct" && modelSpec(id)?.api === "openai-completions"));
	const dsv4f = modelSpec("dsv4f");
	check("dsv4f is local endpoint", dsv4f?.endpoint === "local" && dsv4f?.route === "direct" && dsv4f?.contextWindow === 262144 && dsv4f?.maxOutput === 65536);
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
	const goodCfg = loadConfig(join(process.cwd(), "config.json"));
	check("config models are supported", !!modelSpec(goodCfg.inner_model) && !!modelSpec(goodCfg.outer_model));
	check("local_base_url present", /^http:\/\/.+\/v1$/.test(goodCfg.local_base_url));

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

	console.log("== model profiles ==");
	const { loadProfiles, resolveThinking, assertVisionAllowed, getProfile } = await import("./models.js");
	loadProfiles();
	check("model profiles parse", !!getProfile("hy3") && !!getProfile("dsv4f"));
	const oxA = getProfile("stealth/ox-alpha");
	check("openrouter ox-alpha profiled", oxA.vision_raw_api === true && !!oxA.reasoning.mandatory);
	const rHy3Max = resolveThinking("hy3", "max");
	check("hy3 max clamps to real ceiling xhigh", rHy3Max.level === "xhigh" && rHy3Max.clamped);
	check("ox-alpha-free high clamps to trusted medium", resolveThinking("ox-alpha-free", "high").level === "medium");
	const rDsv = resolveThinking("dsv4f", "max");
	check("dsv4f deep thinking uses thinking_budget", (rDsv.extraBody as Record<string, unknown>).thinking_budget === 16384);
	check(
		"muse strips reasoning params",
		Object.keys(resolveThinking("muse-spark-1.2-contributor", "high").extraBody).length === 0,
	);
	let visionBlocked = false;
	try {
		assertVisionAllowed("dsv4f", true);
	} catch {
		visionBlocked = true;
	}
	check("vision gate blocks unsupported model", visionBlocked);
	assertVisionAllowed("ox-alpha-free", true); // raw API supports images - must not throw

	console.log("== anti-cheat guard ==");
	const { scanWorkspaceForBreaches } = await import("./guard.js");
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

	const { protectedManifest, verifyManifest, scanTextForBreaches } = await import("./guard.js");
	const fakeProblem = join(tmp, "fakeproblem");
	mkdirSync(join(fakeProblem, "reference"), { recursive: true });
	writeFileSync(join(fakeProblem, "eval.py"), "print(1)\n");
	writeFileSync(join(fakeProblem, "reference", "solution.py"), "x = 1\n");
	const manifest = protectedManifest(fakeProblem);
	check("manifest hashes grading assets", Object.keys(manifest).length === 2);
	check("manifest verifies untouched dir", verifyManifest(fakeProblem, manifest).length === 0);
	writeFileSync(join(fakeProblem, "eval.py"), "print(2)\n");
	check("manifest detects eval.py tampering", verifyManifest(fakeProblem, manifest).includes("eval.py"));
	const toolBreaches = scanTextForBreaches("tool_execution_start read file=../../problems/k2_c001/answers.private.jsonl");
	check("tool-log scan flags gold reads", toolBreaches.length === 1 && toolBreaches[0].pattern === "answers.private");

	console.log("== genres ==");
	check("genre guess", guessGenre("quake_b") === "seismology" && guessGenre("flood_rp") === "hydrology" && guessGenre("poro_perm") === "petrophysics");

	console.log("== scoped tips ==");
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
