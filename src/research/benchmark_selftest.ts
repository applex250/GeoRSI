/** Deterministic tests for the three-layer research benchmark (#65): manifest dataset
 * contracts, honest aggregation math, and artifact record parsing. */
import {
	RESEARCH_BENCHMARK_MANIFEST,
	aggregateBenchmarkRuns,
	benchmarkRecordFromArtifacts,
	validateResearchBenchmarkManifest,
	researchBenchmarkManifestFingerprint,
	type BenchmarkRunRecord,
	type ResearchBenchmarkStage,
} from "./benchmark.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

function record(taskId: string, stage: ResearchBenchmarkStage, repetition: number, scienceScore: number | null, eligible = true, validRate = 1): BenchmarkRunRecord {
	return { taskId, stage, repetition, runDir: `runs/fake/${taskId}__rep${repetition}`, scienceScore, overallScore: scienceScore, validRate, eligible, totalTokens: 50_000 };
}

async function main(): Promise<void> {
	console.log("== benchmark manifest with dataset contracts ==");
	check("manifest validates with dataset contracts", validateResearchBenchmarkManifest(RESEARCH_BENCHMARK_MANIFEST).length === 0);
	const quakeB = RESEARCH_BENCHMARK_MANIFEST.stages["stage-a"].find((task) => task.id === "quake_b");
	check("quake_b binds seed 20260909 (matches smoke-019/020 baseline contract)", quakeB?.dataset?.seed === 20260909);
	check("every stage-a task binds a dataset seed", RESEARCH_BENCHMARK_MANIFEST.stages["stage-a"].every((task) => task.dataset?.seed !== undefined));
	const broken = structuredClone(RESEARCH_BENCHMARK_MANIFEST);
	delete (broken.stages["stage-a"][0].dataset as { seed?: number }).seed;
	check("dataset without seed rejected in manifest validation", validateResearchBenchmarkManifest(broken).some((issue) => issue.includes("must bind a dataset seed")));
	const before = researchBenchmarkManifestFingerprint(RESEARCH_BENCHMARK_MANIFEST);
	check("manifest fingerprint changes with dataset content", researchBenchmarkManifestFingerprint(broken) !== before);

	console.log("== aggregation math ==");
	const twoByTwo = aggregateBenchmarkRuns(RESEARCH_BENCHMARK_MANIFEST, [
		record("quake_b", "stage-a", 1, 0.6),
		record("quake_b", "stage-a", 2, 0.8),
		record("flood_rp", "stage-a", 1, 0.4),
		record("flood_rp", "stage-a", 2, 0.4),
	]);
	// Honest denominator: the FULL stage weight sum (5) — tasks without runs score 0, never skipped.
	check("stage-a weighted mean divides by full stage weight", Math.abs(twoByTwo.stages["stage-a"].weightedScienceScore - ((0.7 + 0.4) / 5)) < 1e-12);
	check("validRate weighted over the same honest denominator", Math.abs(twoByTwo.stages["stage-a"].meanValidRate - (2 / 5)) < 1e-12);
	check("missing repetitions are listed", twoByTwo.stages["stage-b"].missingRepetitions.some((missing) => missing.taskId === "research-capstone-seismic-gis" && missing.repetition === 1));
	check("missing repetitions do not raise the score", twoByTwo.stages["stage-b"].weightedScienceScore === 0);
	check("developmentOverall averages stage-a and stage-b", Math.abs((twoByTwo.developmentOverall ?? -1) - (((0.7 + 0.4) / 5 + 0) / 2)) < 1e-12);
	check("held-out score null without held-out runs", twoByTwo.heldOutScore === null);

	const withGap = aggregateBenchmarkRuns(RESEARCH_BENCHMARK_MANIFEST, [record("quake_b", "stage-a", 1, 0.6)]);
	check("missing rep2 of quake_b flagged", withGap.stages["stage-a"].missingRepetitions.some((missing) => missing.taskId === "quake_b" && missing.repetition === 2));
	check("single rep scores honestly against the full denominator", Math.abs(withGap.stages["stage-a"].weightedScienceScore - (0.6 / 5)) < 1e-12);

	const ineligible = aggregateBenchmarkRuns(RESEARCH_BENCHMARK_MANIFEST, [
		record("quake_b", "stage-a", 1, null, false, 0.5),
		record("quake_b", "stage-a", 2, 0.8),
		record("flood_rp", "stage-a", 1, 0.4),
		record("flood_rp", "stage-a", 2, 0.4),
	]);
	check("ineligible run counts as zero, not silent skip", Math.abs(ineligible.stages["stage-a"].weightedScienceScore - ((((0 + 0.8) / 2 + 0.4)) / 5)) < 1e-12);
	check("ineligible task id listed", ineligible.stages["stage-a"].ineligibleTaskIds.includes("quake_b"));

	const bad = aggregateBenchmarkRuns(RESEARCH_BENCHMARK_MANIFEST, [
		record("quake_b", "stage-b", 1, 0.6),
		record("ghost-task", "stage-a", 1, 0.9),
	]);
	check("stage mismatch flagged", bad.issues.some((issue) => issue.includes("reported under stage stage-b")));
	check("unknown task flagged", bad.issues.some((issue) => issue.includes("unknown benchmark task")));
	const duplicated = aggregateBenchmarkRuns(RESEARCH_BENCHMARK_MANIFEST, [record("quake_b", "stage-a", 1, 0.6), record("quake_b", "stage-a", 1, 0.9)]);
	check("duplicate record flagged", duplicated.issues.some((issue) => issue.includes("duplicate benchmark record")));
	const heldOut = aggregateBenchmarkRuns(RESEARCH_BENCHMARK_MANIFEST, [record("poro_perm", "held-out", 1, 0.9)]);
	check("held-out runs report separately", heldOut.heldOutScore !== null && heldOut.developmentOverall === null);

	console.log("== artifact record parsing ==");
	const parsed = benchmarkRecordFromArtifacts("quake_b", "stage-a", 1, "runs/fake", (path) => {
		if (path.endsWith("research-score.json")) return { eligible: true, overall: 0.75, scienceScore: 0.7 };
		if (path.endsWith("runtime-attestation.json")) return { totalTokens: 123_456 };
		if (path.endsWith("plan.json")) return { nodes: [{ state: "completed" }, { state: "completed" }, { state: "failed" }, { state: "ready" }] };
		throw new Error(`unexpected path ${path}`);
	});
	check("record parses score/attestation/plan", parsed.scienceScore === 0.7 && parsed.eligible && parsed.totalTokens === 123_456 && Math.abs(parsed.validRate - 0.5) < 1e-12);
	const missing = benchmarkRecordFromArtifacts("quake_b", "stage-a", 1, "runs/empty", () => { throw new Error("missing"); });
	check("missing artifacts become honest zeros", missing.scienceScore === null && !missing.eligible && missing.validRate === 0 && missing.totalTokens === 0);

	console.log(`benchmark selftest passed (${passed} checks)`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});

console.log("== #84 side-items ==");
{
	const { SEED_STRATEGY_BUNDLE, effectiveRoleBudgets, REFERENCE_CONTEXT_WINDOW } = await import("./strategy-bundle.js");
	check("reference window scaling is identity", JSON.stringify(effectiveRoleBudgets(SEED_STRATEGY_BUNDLE, REFERENCE_CONTEXT_WINDOW)) === JSON.stringify(SEED_STRATEGY_BUNDLE.context.roleBudgets));
	const bigger = effectiveRoleBudgets(SEED_STRATEGY_BUNDLE, 1_200_000);
	check("bigger window scales budgets up to the clamp band", Object.entries(bigger).every(([role, value]) => value === 120_000 || value >= SEED_STRATEGY_BUNDLE.context.roleBudgets[role]!));
	const smaller = effectiveRoleBudgets(SEED_STRATEGY_BUNDLE, 150_000);
	check("smaller window scales budgets down but respects the floor", smaller.planner === 12_000 && Object.values(smaller).every((value) => value >= 4_000));
}
