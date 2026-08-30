/** One-component-at-a-time StrategyBundle edit policy for causal attribution. */
import type { Scaffold } from "../scaffold.js";
import { strategyBundleFingerprint, validateStrategyBundle, type StrategyBundle, type ToolRecipe, type VerifierPolicy } from "./strategy-bundle.js";

export type StrategyEdit =
	| { component: "scaffold"; op: "replace-scaffold"; scaffold: Scaffold }
	| { component: "planner"; op: "set-max-replans"; value: number }
	| { component: "recipe"; op: "upsert-recipe"; family: string; recipe: ToolRecipe }
	| { component: "verifier"; op: "set-verifier"; family: string; policy: VerifierPolicy }
	| { component: "context"; op: "set-role-context-budget"; role: string; tokens: number }
	| { component: "recovery"; op: "set-max-node-attempts"; value: number }
	| { component: "budget"; op: "set-role-output-cap"; role: string; tokens: number }
	| { component: "communication"; op: "set-minimum-defense-questions"; value: number };

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
	}
	next.lineage = { parentFingerprint: strategyBundleFingerprint(bundle), generation: bundle.lineage.generation + 1, changedComponent: edit.component, originRun };
	const issues = validateStrategyBundle(next);
	if (issues.length > 0) throw new Error(`invalid StrategyBundle edit: ${issues.join("; ")}`);
	if (strategyBundleFingerprint(next) === strategyBundleFingerprint(bundle)) throw new Error("StrategyBundle edit is a no-op");
	return next;
}
