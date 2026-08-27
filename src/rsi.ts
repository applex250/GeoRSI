/**
 * GeoRSI main loop.
 *
 * Generation cycle (port of OpenRSI_self's validated pipeline):
 *   read FEEDBACK.md -> goal verdict -> propose N (angle-rotated, think-first)
 *   -> critique panel prunes before compute -> evaluate survivors on the
 *   training suite (mean PRIVATE fitness) -> adversarial verification of a
 *   challenger (fresh re-eval; average of 2 runs must beat champion)
 *   -> accept/reject champion -> memory reflection -> board append.
 *
 * Long-run properties:
 *   - crash-safe: append-only board.jsonl + atomic state.json snapshots
 *   - resume: `--resume` continues the same run (generation counter,
 *     champion, history) instead of restarting from zero
 *   - budget stop + stagnation stop
 *   - held-out final exam with the champion scaffold
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { ROOT } from "./config.js";
import { getPiRuntime, TOKENS } from "./provider.js";
import { loadProblems, makeEvalContext, type Problem } from "./bench/eval.js";
import { SEED_SCAFFOLD, type Scaffold } from "./scaffold.js";
import { Journal, loadRunState, saveRunState, fingerprint, readJournalTail, atomicWriteJson, type RunState } from "./journal.js";
import { solveEpisode, setBudgetExhausted, type EpisodeResult } from "./inner/solve.js";
import { propose, ANGLES } from "./outer/improve.js";
import { critiquePanel } from "./outer/critique.js";
import { makeGoalPlan, checkGoal, readFeedback, type GoalPlan } from "./goal.js";
import { writeReports, type EpisodeRecord, type FindingRow } from "./board.js";
import { openMemory, addMemory, defaultObservation, snapshotMemory, type MemoryItem } from "./memory.js";
import { knowledgePath, loadKnowledge, recordUsage, storeVersion } from "./knowledge.js";
import { runHeldoutExam } from "./exam.js";
import type { RsiEvent } from "./tui/events.js";
import { RunController } from "./loopctl.js";
import { weightedFitnessMean } from "./metrics.js";

export interface RsiOptions {
	cfg: Config;
	runName: string;
	resume: boolean;
	gensOverride?: number;
	log?: (m: string) => void;
	/** optional structured event sink (TUI); absent in headless runs */
	emit?: (ev: RsiEvent) => void;
	/** optional pause/stop gate (TUI) */
	controller?: RunController;
}

function nowTs(): string {
	return new Date().toISOString().replace("T", " ").slice(0, 19);
}

interface EvaluationLearning {
	memoryItems: MemoryItem[];
	knowledgeUsage: { ids: string[]; fitness: number }[];
}

interface ScaffoldEvaluation {
	mean: number | null;
	detail: EpisodeRecord[];
	learning: EvaluationLearning;
}

/** Evaluate a scaffold on a fixed input snapshot; learning commits later. */
async function evaluateScaffold(
	cfg: Config,
	problems: Problem[],
	scaffold: Scaffold,
	runDir: string,
	role: string,
	model: Parameters<typeof solveEpisode>[0]["model"],
	memory: ReturnType<typeof openMemory>,
	emit: (ev: RsiEvent) => void = () => {},
	controller?: RunController,
	log: (m: string) => void = () => {},
	): Promise<ScaffoldEvaluation> {
	const evalCtx = makeEvalContext(cfg, ROOT);
	const detail: EpisodeRecord[] = [];
	const evaluated: { problem: Problem; result: EpisodeResult }[] = [];
	const weighted: { fitness: number | null; weight: number }[] = [];
	const evalMemory = snapshotMemory(memory);
	const repeats = Math.max(1, Math.floor(cfg.episodes_per_problem || 1));
	for (let repeat = 0; repeat < repeats; repeat++) {
		for (const problem of problems) {
			await controller?.waitIfPaused();
			const tag = repeats === 1 ? `${role}-${problem.id}` : `${role}-r${repeat + 1}-${problem.id}`;
			const workspace = join(runDir, "episodes", tag);
			const result = await solveEpisode({
				cfg,
				problem,
				evalCtx,
				scaffold,
				model,
				workspace,
				memory: evalMemory,
				log,
				tag,
				emit,
				persistKnowledgeUsage: false,
			});
			evaluated.push({ problem, result });
			weighted.push({ fitness: result.fitness, weight: problem.weight });
			detail.push({
				problem: problem.id,
				fitness: result.fitness,
				bestPublic: result.bestPublic,
				submits: result.submits,
				secs: Math.round(result.secs),
				error: result.error,
			});
		}
	}
	// Fixed denominator: an ERR/null episode is a failed task, not missing data.
	if (problems.length === 0) return { mean: null, detail, learning: { memoryItems: [], knowledgeUsage: [] } };
	const mean = weightedFitnessMean(weighted);
	emit({
		type: "suite_done",
		mean,
		perProblem: detail.map((d) => ({ problem: d.problem, fitness: d.fitness })),
	});

	// Stage learning locally. Candidate, verification, and hold-out callers
	// decide later whether this evidence is allowed to enter durable state.
	const memoryItems: MemoryItem[] = [];
	const knowledgeUsage: { ids: string[]; fitness: number }[] = [];
	for (const { problem, result: res } of evaluated) {
		const obs = defaultObservation(res.problemId, res.bestPublic, res.fitness == null);
		for (const text of obs.slice(0, 1)) {
			memoryItems.push({
				ts: Date.now(),
				problem: res.problemId,
				genre: problem.genre,
				tag: res.error ? "failure" : "note",
				text,
				publicScore: res.bestPublic,
			});
		}
		if (res.fitness != null && res.knowledgeIds.length > 0) {
			knowledgeUsage.push({ ids: res.knowledgeIds, fitness: res.fitness });
		}
	}
	return { mean, detail, learning: { memoryItems, knowledgeUsage } };
}

function commitEvaluationLearning(memory: ReturnType<typeof openMemory>, learning: EvaluationLearning): void {
	for (const item of learning.memoryItems) addMemory(memory, item);
	for (const usage of learning.knowledgeUsage) recordUsage(usage.ids, usage.fitness);
}

/** Champion tips outlive their run: accepted tips become knowledge nodes
 * tagged with the suite's genres, so future runs (any model) inherit them. */
function promoteChampionTipsToKnowledge(runName: string, gen: number, champion: Scaffold, problems: Problem[]): void {
	try {
		const genres = [...new Set(problems.map((p) => p.genre))];
		const tips = champion.tips
			.map((t) => (typeof t === "string" ? { text: t, genres: undefined as string[] | undefined } : t))
			.filter((t) => t.text?.trim());
		if (tips.length === 0) return;
		const path = knowledgePath();
		const existing = new Set<string>();
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				existing.add(JSON.parse(line).text as string);
			} catch {
				/* torn tail */
			}
		}
		const fresh = tips.filter((t) => !existing.has(t.text));
		if (fresh.length === 0) return;
		const stamp = Date.now().toString(36);
		const lines = fresh.map((t, i) =>
			JSON.stringify({
				id: `tip_${stamp}_${i}`,
				text: t.text.slice(0, 400),
				tags: t.genres?.length ? t.genres : genres,
				scope: t.genres?.length || genres.length === 1 ? "regional" : "generic",
				stats: { uses: 0, wins: 0, fitness_sum: 0 },
				origin: { run: runName, gen },
				status: "active",
			}),
		);
		appendFileSync(path, lines.join("\n") + "\n");
		console.log(`[knowledge] promoted ${fresh.length} champion tip(s) from g${gen} of ${runName}`);
	} catch (e) {
		console.error(`[knowledge] promotion failed: ${(e as Error).message}`);
	}
}

export async function runRsi(opts: RsiOptions): Promise<{ state: RunState; runDir: string }> {
	const { cfg } = opts;
	const log = opts.log ?? ((m: string) => console.log(m));
	const emit = opts.emit ?? (() => {});
	const controller = opts.controller;
	const runDir = join(ROOT, "runs", opts.runName);
	mkdirSync(runDir, { recursive: true });

	const allProblems = loadProblems(cfg, ROOT, true);
	const problems = allProblems.filter((p) => !p.heldout);
	const nGens = opts.gensOverride ?? cfg.generations;
	const initialKnowledge = loadKnowledge();
	const fp = fingerprint([
		{ config: cfg, gens: nGens },
		{ problems: allProblems.map((p) => ({ id: p.id, genre: p.genre, heldout: p.heldout, weight: p.weight, overrides: p.overrides })) },
	]);
	const manifestPath = join(runDir, "run-manifest.json");
	if (!existsSync(manifestPath)) {
		atomicWriteJson(manifestPath, {
			version: 1,
			fingerprint: fp,
			createdAt: new Date().toISOString(),
			node: process.version,
			platform: `${process.platform}/${process.arch}`,
			config: cfg,
			generations: nGens,
			problems: allProblems.map((p) => ({ id: p.id, genre: p.genre, heldout: p.heldout, weight: p.weight, overrides: p.overrides })),
			seedScaffold: cfg.seed_scaffold ?? SEED_SCAFFOLD,
			knowledgeVersion: storeVersion(initialKnowledge),
			rag: { enabled: cfg.rag_enabled === true, budgetChars: cfg.rag_budget_chars ?? 2400 },
		});
	}

	const { inner, outer } = await getPiRuntime(cfg, ROOT);
	const journal = new Journal(runDir);
	const memory = openMemory(runDir);

	let state = loadRunState(runDir);
	let goalPlan: GoalPlan | null = null;

	if (opts.resume && state && state.fingerprint === fp) {
		log(`resuming run "${opts.runName}" at generation ${state.generation} (best=${state.bestFitness?.toFixed(4) ?? "—"})`);
		// carry the spent budget across process restarts
		TOKENS.total = state.tokensUsed ?? 0;
		goalPlan = (await readGoalPlan(runDir)) ?? (await makeGoalPlan(outer, defaultGoalText(cfg)));
	} else {
		if (state && opts.resume) {
			throw new Error(
				`run fingerprint mismatch (config changed since the run started): refusing to resume. ` +
					`Use a fresh run name or drop --resume.`,
			);
		}
		if (state && !opts.resume) {
			log(`note: run dir already has state; starting fresh run (old files kept)`);
		}
		goalPlan = await makeGoalPlan(outer, defaultGoalText(cfg));
		await writeGoalPlan(runDir, goalPlan);
		log(`goal criteria:\n${goalPlan.criteria.map((c) => `  - ${c}`).join("\n")}`);
		journal.append({ kind: "note", ts: nowTs(), generation: 0, text: `goal plan: ${goalPlan.criteria.join(" | ")}` });

		// gen 0 baseline
		log("\n[gen 0] baseline episode suite ...");
		emit({ type: "phase", phase: "baseline suite", detail: "seed scaffold" });
		const seed = cfg.seed_scaffold ?? SEED_SCAFFOLD;
		const baseline = await evaluateScaffold(cfg, problems, seed, runDir, "g0", inner, memory, emit, controller, log);
		const { mean, detail } = baseline;
		commitEvaluationLearning(memory, baseline.learning);
		log(`[gen 0] baseline mean fitness=${mean?.toFixed(4) ?? "ERR"} tokens=${TOKENS.total}`);
		journal.append({
			kind: "episode",
			ts: nowTs(),
			generation: 0,
			role: "champion-baseline",
			fitness: mean,
			detail,
			tokens: TOKENS.total,
		});
		state = {
			version: 1,
			name: opts.runName,
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			fingerprint: fp,
			generation: 0,
			champion: seed,
			bestFitness: mean,
			fitnessHistory: mean != null ? [mean] : [],
			stagnation: 0,
			tokensUsed: TOKENS.total,
		};
		saveRunState(runDir, state);
	}

	const findings: FindingRow[] = rebuildFindings(runDir);
	const suiteSummary = buildSuiteSummary(problems);
	emit({
		type: "run_start",
		runName: opts.runName,
		generations: nGens,
		problems: problems.map((p) => p.id),
		inner: cfg.inner_model,
		outer: cfg.outer_model,
	});

	for (let gen = state.generation + 1; gen <= nGens; gen++) {
		await controller?.waitIfPaused();
		if (controller?.stopRequested) {
			log("stop requested; saving state and exiting (resume with --resume).");
			break;
		}
		if (TOKENS.total > cfg.cost_cap_tokens) {
			log("token budget exhausted; stopping.");
			emit({ type: "budget_stop", tokens: TOKENS.total });
			setBudgetExhausted(true);
			break;
		}
		log(`\n===== GENERATION ${gen}/${nGens} (best=${state.bestFitness?.toFixed(4) ?? "—"}, tokens=${TOKENS.total}) =====`);
		emit({ type: "generation_start", generation: gen, total: nGens, best: state.bestFitness, tokens: TOKENS.total });

		const feedback = readFeedback(runDir);
		let steer = "";
		if (gen % 2 === 1 || state.fitnessHistory.length < 3) {
			emit({ type: "phase", phase: `gen ${gen}: goal check` });
			const verdict = await checkGoal(
				outer,
				goalPlan,
				state.fitnessHistory,
				`champion mean=${state.bestFitness?.toFixed(4) ?? "?"}; stagnation=${state.stagnation}; tokens=${TOKENS.total}`,
			);
			steer = verdict.steer;
			log(`[goal] onTrack=${verdict.onTrack} (${verdict.source})${steer ? ` steer: ${steer.slice(0, 120)}` : ""}`);
			emit({ type: "goal_verdict", generation: gen, onTrack: verdict.onTrack, source: verdict.source, steer });
			journal.append({ kind: "goal", ts: nowTs(), generation: gen, ...verdict });
		}

		// 1) propose (angle-rotated diversity)
		emit({ type: "phase", phase: `gen ${gen}: proposing`, detail: `${cfg.proposals} angles` });
		const proposals = [];
		for (let k = 0; k < cfg.proposals; k++) {
			const angle = ANGLES[(gen + k) % ANGLES.length];
			try {
				const p = await propose(outer, state.champion, angle, {
					historySummary: summarizeHistory(state.fitnessHistory, findings),
					feedback,
					goalSteer: steer,
					suiteSummary,
				});
				if (p) proposals.push(p);
				else log(`  [propose ${k + 1}] invalid/empty proposal`);
			} catch (e) {
				log(`  [propose ${k + 1}] failed: ${errStr(e)}`);
			}
		}
		if (proposals.length === 0) {
			log("  no valid proposals this generation");
			state.stagnation += 1;
			state.generation = gen;
			saveRunState(runDir, state);
			continue;
		}

		// 2) critique before compute
		emit({ type: "phase", phase: `gen ${gen}: critique panel` });
		const { survivors, scores } = await critiquePanel(
			outer,
			proposals,
			championSummary(state.champion),
			findings
				.slice(-8)
				.map((f) => `${f.mechanism} -> ${f.fitness?.toFixed(3) ?? "ERR"} (${f.accepted ? "accepted" : "rejected"})`)
				.join("; "),
			cfg.critics,
		);
		log(
			`  [critique] qualities=[${scores.map((s) => s.quality.toFixed(1)).join(",")}] -> ${survivors.length}/${proposals.length} survive`,
		);
		for (const [i, p] of proposals.entries()) {
			emit({
				type: "proposal",
				generation: gen,
				angle: p.angle,
				mechanism: p.mechanism,
				expected: p.expectedDelta,
				quality: scores[i]?.quality ?? null,
				survived: survivors.includes(p),
			});
			journal.append({
				kind: "proposal",
				ts: nowTs(),
				generation: gen,
				angle: p.angle,
				mechanism: p.mechanism,
				expected_delta: p.expectedDelta,
				edits: p.edits,
				quality: scores[i]?.quality ?? null,
				survived: survivors.includes(p),
			});
		}

		// archive every variant (incl. pruned) for audit
		const variantsDir = join(runDir, "variants");
		mkdirSync(variantsDir, { recursive: true });
		for (const [i, p] of proposals.entries()) {
			atomicWriteJson(join(variantsDir, `gen${gen}_v${i + 1}.json`), {
				angle: p.angle,
				edits: p.edits,
				mechanism: p.mechanism,
				expected_delta: p.expectedDelta,
				falsification: p.falsification,
				quality: scores[i]?.quality ?? null,
				scaffold: p.child,
			});
		}

		// 3) evaluate survivors
		let best: { mean: number; child: Scaffold; detail: EpisodeRecord[]; mechanism: string; learning: EvaluationLearning } | null = null;
		let bestFinding: FindingRow | null = null;
		for (const [i, p] of survivors.entries()) {
			await controller?.waitIfPaused();
			if (controller?.stopRequested) break;
			const child = p.child;
			child.generation = gen;
			log(`  [eval survivor ${i + 1}/${survivors.length}] ${p.mechanism.slice(0, 80)}`);
			emit({ type: "phase", phase: `gen ${gen}: eval survivor ${i + 1}/${survivors.length}`, detail: p.mechanism.slice(0, 90) });
			const evaluation = await evaluateScaffold(cfg, problems, child, runDir, `g${gen}-s${i + 1}`, inner, memory, emit, controller, log);
			const { mean, detail } = evaluation;
			log(`    -> mean fitness=${mean?.toFixed(4) ?? "ERR"}`);
			const finding: FindingRow = {
				generation: gen,
				mechanism: p.mechanism,
				expected: p.expectedDelta,
				fitness: mean,
				accepted: false,
			};
			findings.push(finding);
			journal.append({
				kind: "episode",
				ts: nowTs(),
				generation: gen,
				role: "challenger",
				mechanism: p.mechanism,
				fitness: mean,
				detail,
				tokens: TOKENS.total,
			});
			if (mean != null && (!best || mean > best.mean)) {
				best = { mean, child, detail, mechanism: p.mechanism, learning: evaluation.learning };
				bestFinding = finding;
			}
		}

		// 4) adversarial verification: fresh re-eval; avg of 2 must beat champion
		if (controller?.stopRequested) {
			log("stop requested; skipping verification.");
		} else if (best && state.bestFitness != null && best.mean > state.bestFitness) {
			log(`  [verify] challenger ${best.mean.toFixed(4)} > champion ${state.bestFitness.toFixed(4)}: fresh re-eval`);
			emit({ type: "phase", phase: `gen ${gen}: adversarial verify` });
			const verification = await evaluateScaffold(cfg, problems, best.child, runDir, `g${gen}-verify`, inner, memory, emit, controller, log);
			const v = verification;
			const avg = v.mean != null ? (best.mean + v.mean) / 2 : null;
			log(`  [verify] re-eval=${v.mean?.toFixed(4) ?? "ERR"} avg=${avg?.toFixed(4) ?? "—"}`);
			emit({ type: "verify", first: best.mean, second: v.mean, avg, champion: state.bestFitness });
			journal.append({
				kind: "episode",
				ts: nowTs(),
				generation: gen,
				role: "verification",
				fitness: v.mean,
				detail: v.detail,
				tokens: TOKENS.total,
			});
			if (avg != null && avg > state.bestFitness + 0.01) {
				log(`  *** NEW CHAMPION ${state.bestFitness.toFixed(4)} -> ${avg.toFixed(4)} ***`);
				emit({
					type: "champion_change",
					generation: gen,
					from: state.bestFitness,
					to: avg,
					mechanism: best.mechanism,
				});
				state.champion = best.child;
				state.bestFitness = avg;
				state.stagnation = 0;
				if (bestFinding) bestFinding.accepted = true;
				promoteChampionTipsToKnowledge(opts.runName, gen, best.child, problems);
				commitEvaluationLearning(memory, best.learning);
				commitEvaluationLearning(memory, verification.learning);
				journal.append({
					kind: "accept",
					ts: nowTs(),
					generation: gen,
					fitness: avg,
					mechanism: best.child.tips.slice(-1)[0] ?? "prompt edit",
				});
			} else {
				log(`  verification failed; champion keeps ${state.bestFitness.toFixed(4)}`);
				state.stagnation += 1;
			}
		} else if (best && state.bestFitness == null) {
			// champion never scored; adopt any scoring child
			state.champion = best.child;
			state.bestFitness = best.mean;
			state.stagnation = 0;
			commitEvaluationLearning(memory, best.learning);
			log(`  *** NEW CHAMPION (first scoring child) ${best.mean.toFixed(4)} ***`);
			emit({ type: "champion_change", generation: gen, from: null, to: best.mean, mechanism: best.mechanism });
			if (bestFinding) bestFinding.accepted = true;
			promoteChampionTipsToKnowledge(opts.runName, gen, best.child, problems);
			journal.append({
				kind: "accept",
				ts: nowTs(),
				generation: gen,
				fitness: best.mean,
				mechanism: best.mechanism,
			});
		} else {
			state.stagnation += 1;
			log(`  champion keeps ${state.bestFitness?.toFixed(4) ?? "—"} (stagnation ${state.stagnation}/${cfg.stagnation_limit})`);
			emit({ type: "champion_keep", generation: gen, best: state.bestFitness, stagnation: state.stagnation, limit: cfg.stagnation_limit });
		}

		if (state.bestFitness != null) state.fitnessHistory.push(state.bestFitness);
		state.generation = gen;
		state.tokensUsed = TOKENS.total;
		saveRunState(runDir, state);
		atomicWriteJson(join(runDir, "champion_scaffold.json"), state.champion);

		// rebuild board + reports from journal
		const rows = rebuildBoard(runDir);
		writeReports(runDir, rows, findings);

		if (state.stagnation >= cfg.stagnation_limit) {
			log("stagnation limit reached; early stop.");
			break;
		}
	}

	// 5) held-out final exam
	const hasHeldout = allProblems.some((p) => p.heldout);
	if (hasHeldout && !controller?.stopRequested) {
		log("\n[final] held-out exam with champion scaffold ...");
		emit({ type: "heldout_start", problems: allProblems.filter((p) => p.heldout).map((p) => p.id) });
		const report = await runHeldoutExam(opts.cfg, opts.runName, state.champion, log);
		emit({
			type: "heldout_done",
			mean: report.heldoutMean,
			results: report.results.map((r) => ({ problem: r.problem, fitness: r.fitness })),
		});
		journal.append({ kind: "note", ts: nowTs(), generation: state.generation, text: `held-out exam: ${report.summary}` });
	}
	journal.append({
		kind: "note",
		ts: nowTs(),
		generation: state.generation,
		text: `run complete: best=${state.bestFitness?.toFixed(4) ?? "—"} tokens=${TOKENS.total}`,
	});
	journal.close();
	log(`\nDONE best=${state.bestFitness?.toFixed(4) ?? "—"} tokens=${TOKENS.total} artifacts: ${runDir}`);
	emit({
		type: "run_end",
		best: state.bestFitness,
		tokens: TOKENS.total,
		reason: controller?.stopRequested ? "stopped by user" : "completed",
	});
	return { state, runDir };
}

function defaultGoalText(cfg: Config): string {
	return `Raise the mean private fitness of a geoscience research agent across the training suite ` +
		`${cfg.problems.filter((p) => !p.heldout).map((p) => p.id).join(", ")} over ${cfg.generations} generations, ` +
		`without overfitting (held-out fitness must follow).`;
}

/** Describe what the suite actually contains so the outer model proposes
 * task-relevant edits. The stale hardcoded description ("quantitative
 * problems") misdirected every proposal in the k2evo runs of 2026-08-25 —
 * estimator-robustness tips for MCQ quiz batches. */
function buildSuiteSummary(problems: Problem[]): string {
	return problems
		.map((p) => {
			const o = p.overrides ?? ({} as Problem["overrides"]);
			if (o.type === "quiz") {
				return `- ${p.id}: quiz batch, scope key "${p.genre}" — the agent answers a JSONL question sheet (mcq/tf/fill/value) in one episode and submits an answers file; strategy space: answering discipline, batching, verification, time allocation`;
			}
			if (o.judge) {
				return `- ${p.id}: open analysis task, scope key "${p.genre}" — the agent works with python on data/ and submits results graded against a hidden reference`;
			}
			return `- ${p.id}: quantitative analysis task, scope key "${p.genre}"`;
		})
		.join("\n");
}

function summarizeHistory(history: number[], findings: FindingRow[]): string {
	const h = history.slice(-6).map((f) => f.toFixed(3)).join(", ");
	const f = findings
		.slice(-5)
		.map((x) => `"${x.mechanism.slice(0, 70)}" -> ${x.fitness?.toFixed(3) ?? "ERR"} ${x.accepted ? "(accepted)" : "(rejected)"}`)
		.join("\n");
	return `fitness history: [${h}]\nrecent proposals:\n${f}`;
}

function championSummary(s: Scaffold): string {
	return JSON.stringify(
		{ system_prompt_head: s.system_prompt.slice(0, 400), tips: s.tips, eval_budget_hint: s.eval_budget_hint },
		null,
		1,
	);
}

function rebuildBoard(runDir: string): Parameters<typeof writeReports>[1] {
	return readJournalTail(runDir, 400)
		.filter((r) => r.kind === "episode")
		.map((r) => ({
			generation: r.generation,
			role: String(r.role ?? ""),
			fitness: (r.fitness as number | null) ?? null,
			mean: (r.fitness as number | null) ?? null,
			detail: (r.detail as EpisodeRecord[]) ?? [],
		}));
}

function rebuildFindings(runDir: string): FindingRow[] {
	const recs = readJournalTail(runDir, 800);
	const rows: FindingRow[] = [];
	for (const r of recs) {
		if (r.kind === "episode" && r.role === "challenger") {
			rows.push({
				generation: r.generation,
				mechanism: String(r.mechanism ?? ""),
				expected: String(r.expected_delta ?? "?"),
				fitness: (r.fitness as number | null) ?? null,
				accepted: false,
			});
		}
	}
	// acceptance joins on generation: an accept record marks that gen's best row
	for (const r of recs) {
		if (r.kind === "accept") {
			const g = r.generation;
			for (let i = rows.length - 1; i >= 0; i--) {
				if (rows[i].generation === g) {
					rows[i].accepted = true;
					break;
				}
			}
		}
	}
	return rows;
}

async function writeGoalPlan(runDir: string, plan: GoalPlan): Promise<void> {
	atomicWriteJson(join(runDir, "goal_plan.json"), plan);
}

async function readGoalPlan(runDir: string): Promise<GoalPlan | null> {
	const p = join(runDir, "goal_plan.json");
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf8")) as GoalPlan;
	} catch {
		return null;
	}
}

function errStr(e: unknown): string {
	return e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 160) : String(e).slice(0, 160);
}
