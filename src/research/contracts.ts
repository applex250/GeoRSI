/** Stable domain contracts for a long-horizon scientific mission. */
export type ResearchTaskFamily = "quantitative" | "gis-remote-sensing" | "literature-hypothesis" | "capstone";
export type ResearchNetworkMode = "blocked" | "open";

export type WorkNodeKind =
	| "frame-question"
	| "value-assessment"
	| "literature-search"
	| "hypothesis"
	| "data-acquisition"
	| "data-audit"
	| "quantitative-analysis"
	| "gis-analysis"
	| "sensitivity"
	| "verification"
	| "synthesis"
	| "report"
	| "presentation"
	| "defense";

export type WorkNodeState = "pending" | "ready" | "running" | "verifying" | "completed" | "failed" | "blocked" | "cancelled";

export interface AcceptanceCriterion {
	id: string;
	description: string;
	kind: "schema" | "artifact" | "metric" | "evidence" | "replay";
	required: boolean;
	threshold?: number;
}

export interface DeliverableSpec {
	id: string;
	kind: "json" | "table" | "figure" | "geodata" | "report" | "presentation" | "defense";
	path: string;
	required: boolean;
	description: string;
}

export interface SourceRequirement {
	id: string;
	description: string;
	minimumCount: number;
	primaryPreferred?: boolean;
}

export interface SourcePolicy {
	networkMode: ResearchNetworkMode;
	requireProvenance: boolean;
	requireContentHash: boolean;
	requireLicenseMetadata: boolean;
	requireRetrievedAt: boolean;
	requireContraryEvidence: boolean;
}

export interface ResearchTaskProfile {
	family: ResearchTaskFamily;
	requiredStages: WorkNodeKind[];
	capabilities: string[];
	verifierProfile: "quantitative-v1" | "gis-v1" | "literature-v1" | "capstone-v1";
	deliverableSchema: string;
	sourceRequirements: SourceRequirement[];
	networkMode: ResearchNetworkMode;
}

export interface ResearchMission {
	version: 1;
	id: string;
	question: string;
	scope: string;
	estimands: string[];
	units: string[];
	assumptions: string[];
	constraints: string[];
	successCriteria: AcceptanceCriterion[];
	requiredDeliverables: DeliverableSpec[];
	sourcePolicy: SourcePolicy;
	taskProfile: ResearchTaskProfile;
}

export interface WorkNodeBudget {
	wallMs: number;
	maxModelCalls: number;
	maxToolCalls: number;
	maxOutputTokens: number;
	maxAttempts: number;
}

export interface WorkNode {
	id: string;
	kind: WorkNodeKind;
	title: string;
	state: WorkNodeState;
	dependsOn: string[];
	inputEvidenceIds: string[];
	expectedOutputs: string[];
	acceptanceCriteriaIds: string[];
	allowedCapabilities: string[];
	budget: WorkNodeBudget;
	attempts: number;
	outputArtifactIds: string[];
	acceptanceEvidenceIds: string[];
	failureCode?: string;
	failureMessage?: string;
	startedAt?: string;
	completedAt?: string;
}

export interface ResearchWorkGraph {
	version: 1;
	missionId: string;
	createdAt: string;
	updatedAt: string;
	nodes: WorkNode[];
}

export interface HypothesisRecord {
	id: string;
	statement: string;
	rationaleEvidenceIds: string[];
	expectedObservation: string;
	falsifier: string;
	status: "proposed" | "supported" | "contradicted" | "inconclusive" | "retracted";
}

export interface DecisionRecord {
	id: string;
	nodeId: string;
	question: string;
	alternatives: string[];
	selected: string;
	evidenceIds: string[];
	assumptions: string[];
	expectedObservation: string;
	falsifier: string;
	uncertainty: string;
}

export interface EvidenceRef {
	id: string;
	kind: "source" | "dataset" | "script" | "tool-output" | "table" | "figure" | "geodata" | "verifier";
	sha256: string;
	logicalName: string;
	producerNodeId: string;
	mediaType: string;
	bytes: number;
	sourceUrl?: string;
	retrievedAt?: string;
	license?: string;
}

export interface ResearchClaim {
	id: string;
	text: string;
	status: "proposed" | "supported" | "contradicted" | "inconclusive" | "retracted";
	evidenceIds: string[];
	uncertainty: string;
	limitations: string[];
}

export function validateResearchMission(mission: ResearchMission): string[] {
	const issues: string[] = [];
	if (mission.version !== 1) issues.push("mission version must be 1");
	if (!mission.id.trim()) issues.push("mission id is required");
	if (!mission.question.trim()) issues.push("research question is required");
	if (!mission.scope.trim()) issues.push("research scope is required");
	if (mission.estimands.length === 0) issues.push("at least one estimand is required");
	if (mission.units.length === 0) issues.push("at least one unit declaration is required");
	if (mission.successCriteria.length === 0) issues.push("success criteria are required");
	if (!mission.successCriteria.some((criterion) => criterion.required)) issues.push("at least one required success criterion is needed");
	const criterionIds = new Set<string>();
	for (const criterion of mission.successCriteria) {
		if (!criterion.id.trim() || criterionIds.has(criterion.id)) issues.push(`invalid or duplicate criterion id: ${criterion.id}`);
		criterionIds.add(criterion.id);
		if (!criterion.description.trim()) issues.push(`criterion ${criterion.id} needs a description`);
	}
	const deliverableIds = new Set<string>();
	for (const deliverable of mission.requiredDeliverables) {
		if (!deliverable.id.trim() || deliverableIds.has(deliverable.id)) issues.push(`invalid or duplicate deliverable id: ${deliverable.id}`);
		deliverableIds.add(deliverable.id);
		if (!deliverable.path.trim() || deliverable.path.includes("..") || /^[/\\]|^[A-Za-z]:/.test(deliverable.path)) {
			issues.push(`deliverable ${deliverable.id} must use a safe relative path`);
		}
	}
	if (mission.taskProfile.requiredStages.length === 0) issues.push("task profile requires at least one stage");
	return issues;
}
