/** Deterministic tests for the evolvable WorkGraph spec: validation, mission coverage,
 * instantiation, and the four structural mutation operators (Phase-2 self-evolution). */
import {
	WORK_NODE_KINDS,
	graphSpecCoverageIssues,
	instantiateGraphSpec,
	mutateAddStage,
	mutateMergeStages,
	mutateRemoveStage,
	mutateSplitStage,
	validateGraphSpec,
	type GraphSpec,
} from "./graph-spec.js";
import { validateWorkGraphForMission } from "./work-graph.js";
import { loadResearchMission } from "./live.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

const REQUIRED = ["quantitative-analysis", "sensitivity", "verification", "synthesis", "report", "presentation", "defense"];

function linearSpec(): GraphSpec {
	return {
		stages: REQUIRED.map((kind, index) => ({
			id: kind,
			kind: kind as GraphSpec["stages"][0]["kind"],
			dependsOn: index === 0 ? [] : [REQUIRED[index - 1]],
		})),
	};
}

function mission(): ReturnType<typeof loadResearchMission> {
	return loadResearchMission("config/research-mission-quant-smoke.json");
}

async function main(): Promise<void> {
	console.log("== graph spec: validation & coverage ==");
	const base = linearSpec();
	check("linear spec validates", validateGraphSpec(base, WORK_NODE_KINDS).length === 0);
	check("linear spec covers the quant smoke mission", graphSpecCoverageIssues(base, REQUIRED).length === 0);
	check("missing stage is reported", graphSpecCoverageIssues({ stages: base.stages.filter((stage) => stage.kind !== "verification") }, REQUIRED).some((issue) => issue.includes("verification")));

	const cyclic: GraphSpec = {
		stages: [
			{ id: "a", kind: "quantitative-analysis", dependsOn: ["b"] },
			{ id: "b", kind: "verification", dependsOn: ["a"] },
		],
	};
	check("cycle detection", validateGraphSpec(cyclic, []).some((issue) => issue.includes("cycle")));
	const selfDep: GraphSpec = { stages: [{ id: "a", kind: "quantitative-analysis", dependsOn: ["a"] }] };
	check("self-dependency detected", validateGraphSpec(selfDep, []).some((issue) => issue.includes("itself")));
	const unknownDep: GraphSpec = { stages: [{ id: "a", kind: "quantitative-analysis", dependsOn: ["ghost"] }] };
	check("unknown dependency detected", validateGraphSpec(unknownDep, []).some((issue) => issue.includes("unknown stage")));
	const badKind: GraphSpec = { stages: [{ id: "a", kind: "not-a-kind" as never, dependsOn: [] }] };
	check("unknown node kind detected", validateGraphSpec(badKind, WORK_NODE_KINDS).some((issue) => issue.includes("unknown node kind")));

	console.log("== instantiation ==");
	const m = mission();
	const instantiated = instantiateGraphSpec(base, m, { wallMs: 40 * 60 * 1000, maxModelCalls: 56, maxToolCalls: 48, maxOutputTokens: 131_072, maxAttempts: 2 });
	check("instantiated node count matches", instantiated.nodes.length === 7);
	check("instantiated ids keep NN-kind format", instantiated.nodes[0]!.id === "01-quantitative-analysis" && instantiated.nodes[6]!.id === "07-defense");
	check("instantiated graph passes mission validation", validateWorkGraphForMission(m, instantiated).length === 0);
	check("budget scale multiplies envelope", instantiateGraphSpec({ stages: [{ id: "quantitative-analysis", kind: "quantitative-analysis", dependsOn: [], budgetScale: 2 }] }, m, { wallMs: 1000, maxModelCalls: 10, maxToolCalls: 10, maxOutputTokens: 1000, maxAttempts: 2 }).nodes[0]!.budget.maxModelCalls === 20);

	console.log("== mutation operators ==");
	const context = { requiredStages: REQUIRED };
	const withFrame = mutateAddStage(base, context, "quantitative-analysis", "frame-question", "00-frame");
	check("add stage: inserted in series after anchor", withFrame.stages.some((stage) => stage.id === "00-frame" && stage.dependsOn.join(",") === "quantitative-analysis") && withFrame.stages.find((stage) => stage.id === "sensitivity")!.dependsOn.includes("00-frame"));
	check("add stage: still validates and covers", validateGraphSpec(withFrame, WORK_NODE_KINDS).length === 0 && graphSpecCoverageIssues(withFrame, REQUIRED).length === 0);

	// Removal is legal only for stages the mission does not require; required kinds are protected.
	const relaxedContext = { requiredStages: ["quantitative-analysis", "synthesis", "report", "presentation", "defense"] };
	const withoutVerification = mutateRemoveStage(base, relaxedContext, "verification");
	check("remove stage: non-required stage removed with reroute", withoutVerification.stages.length === 6 && withoutVerification.stages.find((stage) => stage.id === "synthesis")!.dependsOn.join(",") === "sensitivity");
	let removeRequiredRejected = false;
	try { mutateRemoveStage(base, context, "verification"); } catch (error) { removeRequiredRejected = String(error).includes("required stage"); }
	check("remove stage: protected kind rejected", removeRequiredRejected);
	let removeUnknownRejected = false;
	try { mutateRemoveStage(base, context, "does-not-exist"); } catch { removeUnknownRejected = true; }
	check("remove stage: unknown id rejected", removeUnknownRejected);

		const splitFirst = mutateSplitStage(base, context, "sensitivity", 2);
	const merged = mutateMergeStages(splitFirst, context, "sensitivity-1", "sensitivity-2");
	check("merge stage: same-kind pair merges back", merged.stages.length === 7 && merged.stages.some((stage) => stage.id === "sensitivity"));
	let mergeDifferentKindRejected = false;
	try { mutateMergeStages(base, context, "quantitative-analysis", "synthesis"); } catch (error) { mergeDifferentKindRejected = String(error).includes("same kind"); }
	check("merge stage: cross-kind rejected", mergeDifferentKindRejected);
	const split = mutateSplitStage(base, context, "sensitivity", 2);
	check("split stage: two parallel passes", split.stages.filter((stage) => stage.id.startsWith("sensitivity")).length === 2 && split.stages.find((stage) => stage.id === "verification")!.dependsOn.filter((dependency) => dependency.startsWith("sensitivity")).length === 2);
	check("split stage: still validates and covers", validateGraphSpec(split, WORK_NODE_KINDS).length === 0 && graphSpecCoverageIssues(split, REQUIRED).length === 0);

	console.log(`graph-spec selftest passed (${passed} checks)`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
