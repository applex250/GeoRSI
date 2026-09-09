/** Research-stage taxonomy layered over the existing benchmark task profile. */
import { profileTask, type TaskProfileInput } from "../task-profile.js";
import type { ResearchNetworkMode, ResearchTaskFamily, ResearchTaskProfile, WorkNodeKind } from "./contracts.js";

export interface ResearchTaskProfileInput extends TaskProfileInput {
	research?: {
		family?: ResearchTaskFamily;
		networkMode?: ResearchNetworkMode;
		requiredStages?: WorkNodeKind[];
		capabilities?: string[];
		verifierProfile?: ResearchTaskProfile["verifierProfile"];
		deliverableSchema?: string;
	};
}

const STAGES: Record<ResearchTaskFamily, WorkNodeKind[]> = {
	quantitative: ["frame-question", "value-assessment", "hypothesis", "data-audit", "quantitative-analysis", "sensitivity", "verification", "synthesis", "report", "presentation", "defense"],
	"gis-remote-sensing": ["frame-question", "value-assessment", "hypothesis", "data-audit", "gis-analysis", "sensitivity", "verification", "synthesis", "report", "presentation", "defense"],
	"literature-hypothesis": ["frame-question", "value-assessment", "literature-search", "hypothesis", "verification", "synthesis", "report", "presentation", "defense"],
	capstone: ["frame-question", "value-assessment", "literature-search", "hypothesis", "data-acquisition", "data-audit", "quantitative-analysis", "gis-analysis", "sensitivity", "verification", "synthesis", "report", "presentation", "defense"],
};

const CAPABILITIES: Record<ResearchTaskFamily, string[]> = {
	quantitative: ["filesystem", "python", "statistics", "artifact-register", "claim-record", "context-memory"],
	"gis-remote-sensing": ["filesystem", "python", "gis", "artifact-register", "claim-record", "context-memory"],
	"literature-hypothesis": ["filesystem", "network", "literature", "citation", "claim-record", "context-memory"],
	capstone: ["filesystem", "network", "literature", "python", "statistics", "gis", "citation", "artifact-register", "claim-record", "context-memory"],
};

function inferFamily(input: ResearchTaskProfileInput): ResearchTaskFamily {
	if (input.research?.family) return input.research.family;
	const legacy = profileTask(input);
	const genre = legacy.genre.toLowerCase();
	if (/capstone|integrated|综合/.test(genre)) return "capstone";
	if (/literature|review|hypothesis|文献/.test(genre)) return "literature-hypothesis";
	if (legacy.preferredInnerRole === "gis") return "gis-remote-sensing";
	return "quantitative";
}

export function profileResearchTask(input: ResearchTaskProfileInput): ResearchTaskProfile {
	const family = inferFamily(input);
	const verifierProfile = input.research?.verifierProfile ?? (
		family === "quantitative" ? "quantitative-v1" :
		family === "gis-remote-sensing" ? "gis-v1" :
		family === "literature-hypothesis" ? "literature-v1" : "capstone-v1"
	);
	return {
		family,
		requiredStages: [...new Set(input.research?.requiredStages ?? STAGES[family])],
		capabilities: [...new Set(input.research?.capabilities ?? CAPABILITIES[family])],
		verifierProfile,
		deliverableSchema: input.research?.deliverableSchema ?? `georsi-${family}-research-v1`,
		sourceRequirements: family === "literature-hypothesis" || family === "capstone"
			? [{ id: "scholarly-sources", description: "traceable scholarly sources supporting background and novelty", minimumCount: 3, primaryPreferred: true }]
			: [],
		networkMode: input.research?.networkMode ?? (family === "literature-hypothesis" || family === "capstone" ? "open" : "blocked"),
	};
}
