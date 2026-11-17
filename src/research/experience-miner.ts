/** Converts trajectory failures into evidence-linked probation hypotheses. */
import type { ResearchFailure, ResearchFailureClass } from "./failure-taxonomy.js";
import type { StrategyComponent } from "./strategy-bundle.js";

export interface StrategyExperienceCandidate {
	id: string;
	status: "probation";
	failureClass: ResearchFailureClass;
	component: StrategyComponent;
	taskFamily: string;
	hypothesis: string;
	falsifier: string;
	evidenceIds: string[];
	origin: { runId: string; episodeId: string; nodeId: string };
	counterexamples: string[];
}

const HYPOTHESES: Partial<Record<ResearchFailureClass, { component: StrategyComponent; hypothesis: string; falsifier: string }>> = {
	"no-submission": { component: "recipe", hypothesis: "Require an early complete artifact and canonical submission immediately after the first successful computation.", falsifier: "The same family still produces no submission under the fixed manifest." },
	"invalid-artifact": { component: "verifier", hypothesis: "Run schema and non-degeneracy checks before submission.", falsifier: "Pre-submit verification passes but the grader still reports an invalid artifact." },
	"data-schema": { component: "recipe", hypothesis: "Audit columns, types, missing values, and row counts before selecting a method.", falsifier: "The audited schema is correct but execution still fails on schema handling." },
	"unit-mismatch": { component: "verifier", hypothesis: "Require explicit units and dimensional checks for every estimand and serialized output.", falsifier: "Unit checks pass but a fixed task still fails due to unit mismatch." },
	crs: { component: "verifier", hypothesis: "Require CRS, axis-order, geometry, and projected-metric checks before GIS operations.", falsifier: "All spatial checks pass but the replay result remains spatially invalid." },
	network: { component: "recovery", hypothesis: "Cache successful downloads by content hash and retry only bounded transient failures.", falsifier: "The cached/retried workflow uses more tokens without improving valid completion." },
	citation: { component: "verifier", hypothesis: "Validate DOI/URL metadata and claim-source links before synthesis.", falsifier: "Citation validation passes but frozen source checks still find a fabricated citation." },
	"numerical-instability": { component: "recipe", hypothesis: "Add finite-value, conditioning, and independent-estimator checks before accepting results.", falsifier: "Independent checks pass but the numeric artifact remains unstable on replay." },
	timeout: { component: "budget", hypothesis: "Use bounded node outputs, artifact references, and one explicit escalation instead of restarting full analysis.", falsifier: "Median tokens or timeout rate does not improve under paired repetitions." },
	verification: { component: "verifier", hypothesis: "Feed verifier issues back only to the failed node and rerun its descendants.", falsifier: "Local replan does not reduce repeated work or improve valid completion." },
	"unsupported-claim": { component: "communication", hypothesis: "Reject supported claims without evidence and uncertainty references.", falsifier: "Unsupported claim rate remains nonzero after the evidence gate." },
	"method-selection": { component: "planner", hypothesis: "Pin the estimator/method for this family and estimand in the plan before any compute, with the alternatives and the selection reason recorded as a decision.", falsifier: "The pinned method still fails or is overturned by the independent check on the fixed manifest." },
	"tool-routing": { component: "planner", hypothesis: "Expose only the tools the node kind can legitimately use and name the expected tool in the node objective.", falsifier: "Nodes still call unknown or capability-forbidden tools with the narrowed surface." },
	sandbox: { component: "recovery", hypothesis: "Fail closed on isolation/cleanup errors and re-run the node in a fresh exchange workspace rather than continuing with a compromised one.", falsifier: "Isolation failures recur on the fresh workspace under the same manifest." },
	budget: { component: "budget", hypothesis: "Give the stage a larger budgetScale or split it into an analysis stage and a write-up stage instead of retrying the same envelope.", falsifier: "The split/scaled stage still exhausts its budget on paired repetitions." },
	unknown: { component: "recovery", hypothesis: "Capture the failing node's full error text and tool receipts as a counter-example before changing anything else.", falsifier: "The failure reproduces with a classified cause once captured, so it belongs to another class." },
};

/** Hypothesis/falsifier template for a failure class (every class has one), for callers such
 * as the experience extractor that record counter-examples without evidence ids. */
export function failureHypothesis(failureClass: ResearchFailureClass): { component: StrategyComponent; hypothesis: string; falsifier: string } {
	return HYPOTHESES[failureClass] ?? HYPOTHESES.unknown!;
}

export function mineStrategyExperience(input: {
	failure: ResearchFailure;
	taskFamily: string;
	evidenceIds: string[];
	runId: string;
	episodeId: string;
	nodeId: string;
	id: string;
}): StrategyExperienceCandidate | null {
	const template = HYPOTHESES[input.failure.class];
	if (!template || input.evidenceIds.length === 0) return null;
	return {
		id: input.id,
		status: "probation",
		failureClass: input.failure.class,
		component: template.component,
		taskFamily: input.taskFamily,
		hypothesis: template.hypothesis,
		falsifier: template.falsifier,
		evidenceIds: [...new Set(input.evidenceIds)],
		origin: { runId: input.runId, episodeId: input.episodeId, nodeId: input.nodeId },
		counterexamples: [],
	};
}
