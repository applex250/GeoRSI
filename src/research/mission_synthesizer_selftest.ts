/** Deterministic tests for workspace-tier mission synthesis: fallback classification, model
 * classification through a fake harness (structured tool capture), and the synthesized
 * mission passing every gate the research engine applies before scheduling. */
import { join } from "node:path";
import { ROOT, loadConfig } from "../config.js";
import type { HarnessOpts } from "../piharness.js";
import { validateResearchMission } from "./contracts.js";
import { DEV_NODE_BUDGET, familyGraphSpec, graphSpecCoverageIssues, instantiateGraphSpec, tieredStages, validateGraphSpec, WORK_NODE_KINDS } from "./graph-spec.js";
import { classifyQuestionViaModel, fallbackClassification, normaliseClassification, synthesizeMission, type QuestionClassification, type ResearchHarnessLike } from "./mission-synthesizer.js";
import { requiredDeliverableIds } from "./deliverables.js";
import { validateWorkGraphForMission } from "./work-graph.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

const UPLOAD = { id: "upload_" + "a".repeat(32), name: "rainfall.csv", sha256: "b".repeat(64), bytes: 1234 };

async function main(): Promise<void> {
	console.log("== fallback classification ==");
	const lit = fallbackClassification("近十年黄土高原植被恢复的研究进展有哪些？请做文献综述", false);
	check("literature wording without files classifies as a simple literature study", lit.family === "literature-hypothesis" && lit.tier === "simple" && lit.source === "fallback");
	const quant = fallbackClassification("请估计这份降雨数据的年际趋势并给出不确定性", true);
	check("uploaded data with estimation wording classifies as quantitative/medium", quant.family === "quantitative" && quant.tier === "medium");
	check("gis wording classifies as gis-remote-sensing", fallbackClassification("基于Landsat影像计算NDVI并分析空间分布", false).family === "gis-remote-sensing");
	check("integrated multi-source study with files classifies as capstone/complex", fallbackClassification("对该盆地做多源数据综合评估", true).family === "capstone" && fallbackClassification("对该盆地做多源数据综合评估", true).tier === "complex");
	check("fallback always yields at least one estimand, unit and criterion", [lit, quant].every((item) => item.estimands.length > 0 && item.units.length > 0 && item.successCriteria.length > 0));

	console.log("== normalisation of model answers ==");
	const garbage = normaliseClassification({ family: "astrology", tier: 7, estimands: [], units: "km", success_criteria: [42], keywords: null }, "问题", false);
	check("malformed model fields degrade to the fallback field by field", garbage.family === lit.family && garbage.tier === "simple" && garbage.estimands.length === 1 && garbage.source === "model");
	const good = normaliseClassification({ family: "quantitative", tier: "complex", estimands: ["b-value", "b-value", " Mc "], units: ["dimensionless"], success_criteria: ["evidence-bound"], keywords: ["gr", "gr"], rationale: "x".repeat(900) }, "问题", true);
	check("valid model fields pass through, deduplicated and bounded", good.family === "quantitative" && good.tier === "complex" && good.estimands.length === 2 && good.keywords.length === 1 && good.rationale.length === 400);

	console.log("== synthesized mission passes every engine gate ==");
	for (const family of ["quantitative", "gis-remote-sensing", "literature-hypothesis", "capstone"] as const) {
		for (const tier of ["simple", "medium", "complex"] as const) {
			for (const uploads of [[], [UPLOAD]]) {
				const classification: QuestionClassification = { ...fallbackClassification("测试问题", uploads.length > 0), family, tier, source: "model" };
				const mission = synthesizeMission({ runId: "run_" + "c".repeat(12), question: "测试问题：请评估。", classification, uploads });
				const label = `${family}/${tier}/${uploads.length ? "files" : "no-files"}`;
				check(`${label} mission validates`, validateResearchMission(mission).length === 0);
				check(`${label} requires only the report`, requiredDeliverableIds(mission).size === 1 && requiredDeliverableIds(mission).has("report"));
				check(`${label} stages equal the tier template`, mission.taskProfile.requiredStages.join(",") === tieredStages(family, tier, { hasFiles: uploads.length > 0 }).join(","));
				check(`${label} carries python+network capabilities`, ["python", "network", "filesystem"].every((capability) => mission.taskProfile.capabilities.includes(capability)));
				check(`${label} data contract present iff files were uploaded`, (mission.dataset !== undefined) === (uploads.length > 0) && (!mission.dataset || (mission.dataset.type === "file" && mission.dataset.seed === 0)));
				const spec = familyGraphSpec(family, mission.taskProfile.requiredStages);
				const graph = instantiateGraphSpec(spec, mission, DEV_NODE_BUDGET);
				check(`${label} graph passes spec, coverage and mission validation`, validateGraphSpec(spec, WORK_NODE_KINDS).length === 0 && graphSpecCoverageIssues(spec, mission.taskProfile.requiredStages).length === 0 && validateWorkGraphForMission(mission, graph).length === 0);
			}
		}
	}
	const simpleLit = synthesizeMission({ runId: "run_" + "d".repeat(12), question: "综述", classification: { ...fallbackClassification("综述", false), family: "literature-hypothesis", tier: "simple" }, uploads: [] });
	check("simple literature tier relaxes the scholarly minimum to 2", simpleLit.taskProfile.sourceRequirements[0]!.minimumCount === 2);
	const mediumLit = synthesizeMission({ runId: "run_" + "e".repeat(12), question: "综述", classification: { ...fallbackClassification("综述", false), family: "literature-hypothesis", tier: "medium" }, uploads: [] });
	check("medium literature tier keeps the scholarly minimum of 3", mediumLit.taskProfile.sourceRequirements[0]!.minimumCount === 3);

	console.log("== model classification through a fake harness ==");
	const cfg = loadConfig(join(ROOT, "config", "research-competition-luna.json"));
	const policy = cfg.research_model!;
	const receipt = { version: 1, id: "receipt-1", provider: policy.provider, model: policy.model, api: policy.api, requestedThinking: policy.thinking_level, effectiveThinking: policy.thinking_level, inputTokens: 10, outputTokens: 5, totalTokens: 15, success: true } as const;
	const fakeHarness = (answer: Record<string, unknown> | null): ((opts: HarnessOpts) => ResearchHarnessLike) => (opts) => ({
		async init() {},
		async prompt() {
			if (answer) await opts.customTools[0]!.execute("call-1", answer as never, undefined as never, undefined as never, undefined as never);
			return { aborted: false, timedOut: false, stalled: false, error: null, tokens: 15, secs: 1, modelCalls: [receipt as never] };
		},
		abort() {},
		dispose() {},
	});
	const modelled = await classifyQuestionViaModel({ question: "估计b值", fileNotes: ["catalog.csv: 1000 rows"], model: {} as never, policy, cwd: ROOT, createHarness: fakeHarness({ family: "quantitative", tier: "medium", estimands: ["b-value"], units: ["dimensionless"], success_criteria: ["audit passes"], keywords: ["gutenberg"], rationale: "numeric estimation on data" }) });
	check("a structured tool answer becomes a model classification with receipts", modelled.classification.source === "model" && modelled.classification.family === "quantitative" && modelled.classification.estimands[0] === "b-value" && modelled.receipts.length === 1);
	const silent = await classifyQuestionViaModel({ question: "近十年研究进展综述", fileNotes: [], model: {} as never, policy, cwd: ROOT, createHarness: fakeHarness(null) });
	check("a session that never calls the tool falls back deterministically but keeps its receipts", silent.classification.source === "fallback" && silent.classification.family === "literature-hypothesis" && silent.receipts.length === 1);
	console.log(`mission-synthesizer selftest passed (${passed} checks)`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
