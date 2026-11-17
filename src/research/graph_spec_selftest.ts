/** Deterministic tests for the evolvable WorkGraph spec: validation, mission coverage,
 * instantiation, and the four structural mutation operators (Phase-2 self-evolution). */
import {
	DEV_NODE_BUDGET,
	WORK_NODE_KINDS,
	familyGraphSpec,
	graphSpecCoverageIssues,
	instantiateGraphSpec,
	mutateAddStage,
	mutateMergeStages,
	mutateRemoveStage,
	mutateSplitStage,
	tieredStages,
	validateGraphSpec,
	type GraphSpec,
	type ResearchTier,
} from "./graph-spec.js";
import { validateWorkGraphForMission } from "./work-graph.js";
import { loadResearchMission, validateCompetitionMissionShape } from "./live.js";
import { STAGES } from "./task-profile.js";

const RESEARCH_LIKE_BUDGET = { wallMs: 40 * 60 * 1000, maxModelCalls: 56, maxToolCalls: 48, maxOutputTokens: 131_072, maxAttempts: 2 };

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

	console.log("== family graph templates (#82) ==");
	const quantTemplate = familyGraphSpec("quantitative");
	const literatureTemplate = familyGraphSpec("literature-hypothesis");
	check("quantitative template includes data-audit", quantTemplate.stages.some((stage) => stage.id === "data-audit"));
	check("literature template includes literature-search", literatureTemplate.stages.some((stage) => stage.id === "literature-search"));
	check("literature template omits data-audit", !literatureTemplate.stages.some((stage) => stage.id === "data-audit"));
	for (const family of ["quantitative", "gis-remote-sensing", "literature-hypothesis", "capstone"] as const) {
		const template = familyGraphSpec(family);
		check(`template ${family} validates + covers its family`, validateGraphSpec(template, WORK_NODE_KINDS).length === 0 && graphSpecCoverageIssues(template, STAGES[family]).length === 0);
	}
	const pinnedSpec = familyGraphSpec("quantitative", m.taskProfile.requiredStages);
	check("mission-pinned stages override the template chain", pinnedSpec.stages.length === m.taskProfile.requiredStages.length && !pinnedSpec.stages.some((stage) => stage.id === "hypothesis"));
	const pinnedInstantiated = instantiateGraphSpec(pinnedSpec, m, RESEARCH_LIKE_BUDGET);
	check("pinned template instantiates to the smoke-019/020 parity graph", pinnedInstantiated.nodes.length === 7 && pinnedInstantiated.nodes[0]!.id === "01-quantitative-analysis");
	let foreignStageRejected = false;
	try { familyGraphSpec("quantitative", ["literature-search" as never]); } catch (error) { foreignStageRejected = String(error).includes("not part of"); }
	check("stages foreign to the family are rejected", foreignStageRejected);
	const familyInstantiated = instantiateGraphSpec(familyGraphSpec("quantitative"), m, RESEARCH_LIKE_BUDGET);
	check("family template instantiates to a mission-valid graph", validateWorkGraphForMission(m, familyInstantiated).length === 0);
	check("family template ids keep NN-kind format", familyInstantiated.nodes[0]!.id === "01-frame-question");

	console.log("== competition dataset contract gate (#82) ==");
	const competitionMission = structuredClone(m);
	check("competition mission with dataset passes shape", validateCompetitionMissionShape(competitionMission).length === 0);
	const noDataset = structuredClone(competitionMission);
	delete (noDataset as { dataset?: unknown }).dataset;
	check("competition mission without dataset is rejected", validateCompetitionMissionShape(noDataset).some((issue) => issue.includes("dataset contract")));
	const noSeed = structuredClone(competitionMission);
	delete (noSeed.dataset as { seed?: unknown }).seed;
	check("competition dataset without seed is rejected", validateCompetitionMissionShape(noSeed).some((issue) => issue.includes("seed")));

	console.log("== workspace tiers (development composition root) ==");
	const families = Object.keys(STAGES) as (keyof typeof STAGES)[];
	for (const family of families) {
		for (const tier of ["simple", "medium", "complex"] as ResearchTier[]) {
			const stages = tieredStages(family, tier);
			const template = STAGES[family];
			check(`${family}/${tier} is a subset of the family template in template order`, stages.every((kind, index) => template.indexOf(kind) > (index === 0 ? -1 : template.indexOf(stages[index - 1]!))));
			for (const spine of ["verification", "synthesis", "report"]) check(`${family}/${tier} keeps the ${spine} spine`, stages.includes(spine as (typeof stages)[number]));
			check(`${family}/${tier} never carries competition deliverables`, !stages.includes("presentation") && !stages.includes("defense"));
			const spec = familyGraphSpec(family, stages);
			check(`${family}/${tier} instantiates through the validated GraphSpec pipeline`, validateGraphSpec(spec, WORK_NODE_KINDS).length === 0 && graphSpecCoverageIssues(spec, stages).length === 0);
			const graph = instantiateGraphSpec(spec, { ...m, taskProfile: { ...m.taskProfile, family, requiredStages: stages } }, DEV_NODE_BUDGET);
			check(`${family}/${tier} report node gets the ×2 communication scale on the dev budget`, graph.nodes.find((node) => node.kind === "report")!.budget.maxModelCalls === DEV_NODE_BUDGET.maxModelCalls * 2);
		}
		check(`${family} tiers grow monotonically`, tieredStages(family, "simple").length <= tieredStages(family, "medium").length && tieredStages(family, "medium").length <= tieredStages(family, "complex").length);
	}
	check("simple literature tier is the four-stage spine", tieredStages("literature-hypothesis", "simple").join(",") === "literature-search,verification,synthesis,report");
	check("uploaded files add a data audit to a quantitative tier", tieredStages("quantitative", "simple", { hasFiles: true }).includes("data-audit") && !tieredStages("quantitative", "simple").includes("data-audit"));
	check("files never add a data audit where the family has none", !tieredStages("literature-hypothesis", "simple", { hasFiles: true }).includes("data-audit"));

	console.log(`graph-spec selftest passed (${passed} checks)`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
