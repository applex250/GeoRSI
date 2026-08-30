/** Trusted, sanitized index for a reproducible research package. */
import { createHash } from "node:crypto";
import type { EvidenceRef, ResearchClaim, ResearchMission, ResearchWorkGraph } from "./contracts.js";
import type { ResearchEnvironment } from "./environment-capture.js";
import { stableJson } from "./event-ledger.js";
import { workGraphFingerprint } from "./work-graph.js";

export interface ResearchPackageManifest {
	version: 1;
	missionId: string;
	createdAt: string;
	missionFingerprint: string;
	workGraphFingerprint: string;
	eventLedgerRootHash: string | null;
	environmentFingerprint: string;
	evidence: EvidenceRef[];
	claimIds: string[];
	deliverables: { id: string; path: string; sha256: string; required: boolean }[];
	manifestHash: string;
}

function hash(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function createResearchPackageManifest(input: {
	mission: ResearchMission;
	graph: ResearchWorkGraph;
	eventLedgerRootHash: string | null;
	environment: ResearchEnvironment;
	evidence: EvidenceRef[];
	claims: ResearchClaim[];
	deliverables: { id: string; path: string; sha256: string; required: boolean }[];
	now?: Date;
}): ResearchPackageManifest {
	const unsigned: Omit<ResearchPackageManifest, "manifestHash"> = {
		version: 1,
		missionId: input.mission.id,
		createdAt: (input.now ?? new Date()).toISOString(),
		missionFingerprint: hash(input.mission).slice(0, 24),
		workGraphFingerprint: workGraphFingerprint(input.graph),
		eventLedgerRootHash: input.eventLedgerRootHash,
		environmentFingerprint: input.environment.fingerprint,
		evidence: [...input.evidence].sort((left, right) => left.id.localeCompare(right.id)),
		claimIds: input.claims.map((claim) => claim.id).sort(),
		deliverables: [...input.deliverables].sort((left, right) => left.id.localeCompare(right.id)),
	};
	return { ...unsigned, manifestHash: hash(unsigned) };
}

export function verifyResearchPackageManifest(manifest: ResearchPackageManifest): boolean {
	const { manifestHash, ...unsigned } = manifest;
	return manifest.version === 1 && manifestHash === hash(unsigned);
}
