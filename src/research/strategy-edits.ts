/** One-component-at-a-time StrategyBundle edit policy for causal attribution. */
import type { Scaffold } from "../scaffold.js";
import type { WorkNodeKind } from "./contracts.js";
import { mutateAddStage, mutateMergeStages, mutateRemoveStage, mutateSplitStage, type GraphSpec } from "./graph-spec.js";
import { strategyBundleFingerprint, validateStrategyBundle, type StrategyBundle, type ToolRecipe, type VerifierPolicy } from "./strategy-bundle.js";

export type StrategyEdit =
	| { component: "scaffold"; op: "replace-scaffold"; scaffold: Scaffold }
	| { component: "planner"; op: "set-max-replans"; value: number }
	| { component: "recipe"; op: "upsert-recipe"; family: string; recipe: ToolRecipe }
	| { component: "verifier"; op: "set-verifier"; family: string; policy: VerifierPolicy }
	| { component: "context"; op: "set-role-context-budget"; role: string; tokens: number }
	| { component: "recovery"; op: "set-max-node-attempts"; value: number }
	| { component: "budget"; op: "set-role-output-cap"; role: string; tokens: number }
	| { component: "communication"; op: "set-minimum-defense-questions"; value: number }
	| { component: "workGraph"; op: "add-stage"; afterId: string; kind: WorkNodeKind; newId?: string }
	| { component: "workGraph"; op: "remove-stage"; id: string }
	| { component: "workGraph"; op: "merge-stages"; keepId: string; mergeId: string }
	| { component: "workGraph"; op: "split-stage"; id: string; copies?: number };

export function applyStrategyEdit(bundle: StrategyBundle, edits: readonly StrategyEdit[], originRun?: string): StrategyBundle {
	if (edits.length !== 1) throw new Error("a research challenger must change exactly one StrategyBundle component");
	const edit = edits[0]!;
	const next = structuredClone(bundle) as StrategyBundle;
	switch (edit.op) {
		case "replace-scaffold":
			next.scaffold = structuredClone(edit.scaffold);
			break;
		case "set-max-replans":
			next.planner.maxReplans = Math.floor(edit.value);
			break;
		case "upsert-recipe": {
			const recipes = next.recipes[edit.family] ?? [];
			const index = recipes.findIndex((recipe) => recipe.id === edit.recipe.id);
			if (index >= 0) recipes[index] = structuredClone(edit.recipe);
			else recipes.push(structuredClone(edit.recipe));
			next.recipes[edit.family] = recipes;
			break;
		}
		case "set-verifier":
			next.verifiers[edit.family] = structuredClone(edit.policy);
			break;
		case "set-role-context-budget":
			next.context.roleBudgets[edit.role] = Math.floor(edit.tokens);
			break;
		case "set-max-node-attempts":
			next.recovery.maxNodeAttempts = Math.floor(edit.value);
			break;
		case "set-role-output-cap":
			next.budget.roleOutputCaps[edit.role] = Math.floor(edit.tokens);
			break;
		case "set-minimum-defense-questions":
			next.communication.minimumDefenseQuestions = Math.floor(edit.value);
			break;
		case "add-stage":
			next.workGraph = mutateAddStage(workGraphOrDefault(next), contextFor(), edit.afterId, edit.kind, edit.newId);
			break;
		case "remove-stage":
			next.workGraph = mutateRemoveStage(workGraphOrDefault(next), contextFor(), edit.id);
			break;
		case "merge-stages":
			next.workGraph = mutateMergeStages(workGraphOrDefault(next), contextFor(), edit.keepId, edit.mergeId);
			break;
		case "split-stage":
			next.workGraph = mutateSplitStage(workGraphOrDefault(next), contextFor(), edit.id, edit.copies ?? 2);
			break;
	}
	next.lineage = { parentFingerprint: strategyBundleFingerprint(bundle), generation: bundle.lineage.generation + 1, changedComponent: edit.component, originRun };
	const issues = validateStrategyBundle(next);
	if (issues.length > 0) throw new Error(`invalid StrategyBundle edit: ${issues.join("; ")}`);
	if (strategyBundleFingerprint(next) === strategyBundleFingerprint(bundle)) throw new Error("StrategyBundle edit is a no-op");
	return next;
}


/** The canonical linear research pipeline used when a bundle has no explicit workGraph. */
export const DEFAULT_RESEARCH_STAGES: readonly WorkNodeKind[] = ["quantitative-analysis", "sensitivity", "verification", "synthesis", "report", "presentation", "defense"];

function workGraphOrDefault(bundle: StrategyBundle): GraphSpec {
	return bundle.workGraph ?? { stages: DEFAULT_RESEARCH_STAGES.map((kind, index) => ({ id: kind, kind, dependsOn: index === 0 ? [] : [DEFAULT_RESEARCH_STAGES[index - 1]!] })) };
}

function contextFor(): { requiredStages: readonly string[] } {
	// Structural mutations never drop required stages: remove-stage itself refuses protected
	// kinds, and every operator re-validates against the full default stage set.
	return { requiredStages: DEFAULT_RESEARCH_STAGES };
}
