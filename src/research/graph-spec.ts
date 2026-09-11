/** Typed, evolvable WorkGraph specification (Phase-2): graph topology as a StrategyBundle
 * component. The Research Lead (offline strategy loop) mutates specs; every mutation result
 * must re-validate. Instantiation turns a validated spec into a concrete ResearchWorkGraph. */
import type { ResearchMission, ResearchTaskFamily, WorkNodeKind, ResearchWorkGraph, WorkNodeBudget } from "./contracts.js";
import { STAGES } from "./task-profile.js";
import { createWorkGraph, createWorkNode } from "./work-graph.js";

export const WORK_NODE_KINDS: readonly WorkNodeKind[] = [
	"frame-question", "value-assessment", "literature-search", "hypothesis", "data-acquisition", "data-audit",
	"quantitative-analysis", "gis-analysis", "sensitivity", "verification", "synthesis", "report", "presentation", "defense",
];

export interface GraphStageSpec {
	/** Stage id — becomes the node id prefix (NN-kind) when instantiated. */
	id: string;
	kind: WorkNodeKind;
	dependsOn: string[];
	/** Multiplier on the base node budget (wall/calls/output); default 1, hard-capped at 4. */
	budgetScale?: number;
	/** Optional thinking-level override for this stage (host-development only). */
	thinkingOverride?: "medium" | "high" | "xhigh";
}

export interface GraphSpec {
	stages: GraphStageSpec[];
}

export interface GraphSpecContext {
	/** Mission invariant: these stages MUST be present (mutators may never drop them). */
	requiredStages: readonly string[];
}

/** Per-family default WorkGraph template: the requiredStages chain for that family,
 * expressed as a GraphSpec. Family templates are the activation baseline (#82): fresh
 * runs without an evolved workGraph instantiate THEIR family's template — quantitative
 * gets data-audit, literature-hypothesis gets literature-search — through the same
 * validated GraphSpec pipeline as evolved strategies. */
export function familyGraphSpec(family: ResearchTaskFamily, requiredStages?: readonly WorkNodeKind[]): GraphSpec {
	// A mission's embedded requiredStages ARE the contract (smoke-019/020 pinned the 7
	// core stages); the full family chain applies only when the mission defers to it.
	const kinds = requiredStages && requiredStages.length > 0 ? requiredStages : STAGES[family];
	const allowed = new Set<string>(STAGES[family]);
	for (const kind of kinds) {
		if (!allowed.has(kind)) throw new Error(`stage ${kind} is not part of the ${family} family template`);
	}
	return { stages: kinds.map((kind, index) => ({ id: kind, kind, dependsOn: index === 0 ? [] : [kinds[index - 1]!] })) };
}

/** Structural validation independent of any mission. */
export function validateGraphSpec(spec: GraphSpec, allowedKinds: readonly WorkNodeKind[]): string[] {
	const issues: string[] = [];
	if (!spec.stages || spec.stages.length === 0) return ["graph spec must contain at least one stage"];
	const ids = new Set<string>();
	for (const stage of spec.stages) {
		if (!stage.id.trim() || !/^[a-z0-9][a-z0-9-]*$/i.test(stage.id)) issues.push(`invalid stage id: ${stage.id}`);
		if (ids.has(stage.id)) issues.push(`duplicate stage id: ${stage.id}`);
		ids.add(stage.id);
		if (!allowedKinds.includes(stage.kind)) issues.push(`stage ${stage.id} references unknown node kind: ${stage.kind}`);
		if (!Array.isArray(stage.dependsOn)) issues.push(`stage ${stage.id} dependsOn must be an array`);
		if (stage.dependsOn.includes(stage.id)) issues.push(`stage ${stage.id} depends on itself`);
		const scale = stage.budgetScale ?? 1;
		if (!Number.isSafeInteger(scale) || scale < 1 || scale > 4) issues.push(`stage ${stage.id} budgetScale must be an integer within 1..4`);
		if (stage.thinkingOverride !== undefined && !["medium", "high", "xhigh"].includes(stage.thinkingOverride)) issues.push(`stage ${stage.id} thinkingOverride must be medium|high|xhigh`);
	}
	for (const stage of spec.stages) {
		for (const dependency of stage.dependsOn) if (!ids.has(dependency)) issues.push(`stage ${stage.id} depends on unknown stage: ${dependency}`);
	}
	// cycle detection via Kahn's algorithm
	const indegree = new Map<string, number>(spec.stages.map((stage) => [stage.id, 0]));
	for (const stage of spec.stages) for (const dependency of stage.dependsOn) indegree.set(stage.id, (indegree.get(stage.id) ?? 0) + 1);
	const queue = spec.stages.filter((stage) => (indegree.get(stage.id) ?? 0) === 0).map((stage) => stage.id);
	let processed = 0;
	while (queue.length > 0) {
		const id = queue.shift()!;
		processed += 1;
		for (const stage of spec.stages) for (const dependency of stage.dependsOn) if (dependency === id) {
			const remaining = (indegree.get(stage.id) ?? 1) - 1;
			indegree.set(stage.id, remaining);
			if (remaining === 0) queue.push(stage.id);
		}
	}
	if (processed !== spec.stages.length) issues.push("graph spec contains a dependency cycle");
	return issues;
}

/** Mission-coverage validation: requiredStages and deliverable stages must be present. */
export function graphSpecCoverageIssues(spec: GraphSpec, requiredStages: readonly string[]): string[] {
	const issues: string[] = [];
	const kinds = new Set(spec.stages.map((stage) => stage.kind));
	for (const stage of requiredStages) if (!kinds.has(stage as WorkNodeKind)) issues.push(`graph spec is missing required stage: ${stage}`);
	return issues;
}

export function cloneSpec(spec: GraphSpec): GraphSpec {
	return { stages: spec.stages.map((stage) => ({ ...stage, dependsOn: [...stage.dependsOn] })) };
}

function stageById(spec: GraphSpec, id: string): GraphStageSpec {
	const stage = spec.stages.find((candidate) => candidate.id === id);
	if (!stage) throw new Error(`graph spec has no stage: ${id}`);
	return stage;
}

/** Insert a new stage in series after afterId: dependents of afterId additionally depend on the
 * new stage, so it sits on the critical path (e.g. a redundant verification pass). */
export function mutateAddStage(spec: GraphSpec, context: GraphSpecContext, afterId: string, kind: WorkNodeKind, newId?: string): GraphSpec {
	stageById(spec, afterId);
	const id = newId ?? `${kind}-${Date.now().toString(36)}`;
	const next = cloneSpec(spec);
	next.stages.push({ id, kind, dependsOn: [afterId] });
	for (const stage of next.stages) if (stage.dependsOn.includes(afterId) && stage.id !== id) stage.dependsOn.push(id);
	const issues = [...validateGraphSpec(next, WORK_NODE_KINDS), ...graphSpecCoverageIssues(next, context.requiredStages)];
	if (issues.length > 0) throw new Error(`mutateAddStage produced an invalid spec: ${issues.join("; ")}`);
	return next;
}

/** Remove a stage and reroute its dependents to its dependencies. Refuses required stages. */
export function mutateRemoveStage(spec: GraphSpec, context: GraphSpecContext, id: string): GraphSpec {
	const stage = stageById(spec, id);
	if (context.requiredStages.includes(stage.kind)) throw new Error(`cannot remove required stage kind: ${stage.kind}`);
	const next = cloneSpec(spec);
	const target = next.stages.find((candidate) => candidate.id === id)!;
	const reroute = target.dependsOn;
	next.stages = next.stages.filter((candidate) => candidate.id !== id);
	for (const other of next.stages) other.dependsOn = unique(other.dependsOn.map((dependency) => (dependency === id ? reroute : dependency)).flat());
	const issues = [...validateGraphSpec(next, WORK_NODE_KINDS), ...graphSpecCoverageIssues(next, context.requiredStages)];
	if (issues.length > 0) throw new Error(`mutateRemoveStage produced an invalid spec: ${issues.join("; ")}`);
	return next;
}

/** Merge two adjacent same-kind stages into the keeper (union of dependencies). */
export function mutateMergeStages(spec: GraphSpec, context: GraphSpecContext, keepId: string, mergeId: string): GraphSpec {
	const keep = stageById(spec, keepId);
	const merge = stageById(spec, mergeId);
	if (keep.kind !== merge.kind) throw new Error(`can only merge stages of the same kind: ${keep.kind} vs ${merge.kind}`);
	const next = cloneSpec(spec);
	const keeper = next.stages.find((candidate) => candidate.id === keepId)!;
	keeper.dependsOn = unique([...keeper.dependsOn, ...merge.dependsOn]).filter((dependency) => dependency !== mergeId && dependency !== keepId);
	next.stages = next.stages.filter((candidate) => candidate.id !== mergeId);
	for (const other of next.stages) other.dependsOn = unique(other.dependsOn.map((dependency) => (dependency === mergeId ? keepId : dependency)));
	// Canonical id restoration: merging derived clones (sensitivity-1 + sensitivity-2) restores
	// the base id (sensitivity) when free, so evolve cycles return to canonical stage ids.
	const baseId = keepId.replace(/-\d+$/, "");
	if (baseId !== keepId && !next.stages.some((candidate) => candidate.id === baseId)) {
		keeper.id = baseId;
		for (const other of next.stages) other.dependsOn = other.dependsOn.map((dependency) => (dependency === keepId ? baseId : dependency));
	}
	const issues = [...validateGraphSpec(next, WORK_NODE_KINDS), ...graphSpecCoverageIssues(next, context.requiredStages)];
	if (issues.length > 0) throw new Error(`mutateMergeStages produced an invalid spec: ${issues.join("; ")}`);
	return next;
}

/** Split a stage into `copies` parallel independent passes (e.g. sensitivity per threshold). */
export function mutateSplitStage(spec: GraphSpec, context: GraphSpecContext, id: string, copies = 2): GraphSpec {
	if (copies < 2 || copies > 4) throw new Error("split copies must be within 2..4");
	const stage = stageById(spec, id);
	const next = cloneSpec(spec);
	const original = next.stages.find((candidate) => candidate.id === id)!;
	next.stages = next.stages.filter((candidate) => candidate.id !== id);
	const cloneIds: string[] = [];
	for (let index = 0; index < copies; index += 1) {
		const cloneId = copies === 1 ? id : `${id}-${index + 1}`;
		cloneIds.push(cloneId);
		next.stages.push({ ...original, id: cloneId, dependsOn: [...original.dependsOn], budgetScale: original.budgetScale });
	}
	for (const other of next.stages) if (cloneIds.includes(other.id) === false) other.dependsOn = unique(other.dependsOn.flatMap((dependency) => (dependency === id ? cloneIds : [dependency])));
	const issues = [...validateGraphSpec(next, WORK_NODE_KINDS), ...graphSpecCoverageIssues(next, context.requiredStages)];
	if (issues.length > 0) throw new Error(`mutateSplitStage produced an invalid spec: ${issues.join("; ")}`);
	return next;
}

/** Instantiate a validated spec against a mission: NN-kind node ids, scaled budgets. */
export function instantiateGraphSpec(spec: GraphSpec, mission: ResearchMission, baseBudget: WorkNodeBudget, now = new Date()): ResearchWorkGraph {
	const criterion = mission.successCriteria.find((item) => item.required)?.id ?? mission.successCriteria[0]?.id ?? "research-evidence";
	const idByStage = new Map<string, string>();
	spec.stages.forEach((stage, index) => idByStage.set(stage.id, `${String(index + 1).padStart(2, "0")}-${stage.id}`));
	const nodes = spec.stages.map((stage, index) => {
		const scale = stage.budgetScale ?? 1;
		const budget: WorkNodeBudget = {
			wallMs: Math.round(baseBudget.wallMs * scale),
			maxModelCalls: Math.round(baseBudget.maxModelCalls * scale),
			maxToolCalls: Math.round(baseBudget.maxToolCalls * scale),
			maxOutputTokens: Math.round(baseBudget.maxOutputTokens * scale),
			maxAttempts: baseBudget.maxAttempts,
		};
		return createWorkNode({
			id: `${String(index + 1).padStart(2, "0")}-${stage.id}`,
			kind: stage.kind,
			thinking: stage.thinkingOverride,
			title: stage.id.replace(/-/g, " "),
			dependsOn: stage.dependsOn.map((dependency) => idByStage.get(dependency) ?? dependency),
			inputEvidenceIds: [],
			expectedOutputs: [`${stage.id}-output`],
			acceptanceCriteriaIds: [criterion],
			allowedCapabilities: mission.taskProfile.capabilities,
			budget,
		});
	});
	return createWorkGraph(mission.id, nodes, now);
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}
