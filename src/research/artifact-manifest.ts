/** Trusted, sanitized index for a reproducible research package. */
import { createHash } from "node:crypto";
import type { EvidenceRef, ResearchClaim, ResearchMission, ResearchWorkGraph } from "./contracts.js";
import type { ResearchEnvironment } from "./environment-capture.js";
import type { ResearchRuntimeAttestation } from "./runtime-attestation.js";
import { runtimeAttestationHash } from "./runtime-attestation.js";
import { stableJson } from "./event-ledger.js";
import { workGraphFingerprint } from "./work-graph.js";

export interface ResearchPackageManifest {
	version: 1;
	missionId: string;
	createdAt: string;
	missionFingerprint: string;
	workGraphFingerprint: string;
	workGraphStateHash: string;
	eventLedgerRootHash: string | null;
	environmentFingerprint: string;
	environmentHash: string;
	runtimeAttestationHash: string;
	evidence: EvidenceRef[];
	evidenceIndexHash: string;
	claimIds: string[];
	claimHashes: string[];
	deliverables: { id: string; path: string; sha256: string; bytes: number; required: boolean }[];
	manifestHash: string;
}

export function researchObjectHash(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function createResearchPackageManifest(input: {
	mission: ResearchMission;
	graph: ResearchWorkGraph;
	eventLedgerRootHash: string | null;
	environment: ResearchEnvironment;
	runtimeAttestation: ResearchRuntimeAttestation;
	evidence: EvidenceRef[];
	claims: ResearchClaim[];
	deliverables: { id: string; path: string; sha256: string; bytes: number; required: boolean }[];
	now?: Date;
}): ResearchPackageManifest {
	const sortedEvidence = [...input.evidence].sort((left, right) => left.id.localeCompare(right.id));
	const sortedClaims = [...input.claims].sort((left, right) => left.id.localeCompare(right.id));
	const unsigned: Omit<ResearchPackageManifest, "manifestHash"> = {
		version: 1,
		missionId: input.mission.id,
		createdAt: (input.now ?? new Date()).toISOString(),
		missionFingerprint: researchObjectHash(input.mission).slice(0, 24),
		workGraphFingerprint: workGraphFingerprint(input.graph),
		workGraphStateHash: researchObjectHash(input.graph),
		eventLedgerRootHash: input.eventLedgerRootHash,
		environmentFingerprint: input.environment.fingerprint,
		environmentHash: researchObjectHash(input.environment),
		runtimeAttestationHash: runtimeAttestationHash(input.runtimeAttestation),
		evidence: sortedEvidence,
		evidenceIndexHash: researchObjectHash(sortedEvidence),
		claimIds: sortedClaims.map((claim) => claim.id),
		claimHashes: sortedClaims.map((claim) => researchObjectHash(claim)),
		deliverables: [...input.deliverables].sort((left, right) => left.id.localeCompare(right.id)),
	};
	return { ...unsigned, manifestHash: researchObjectHash(unsigned) };
}

export interface ResearchPackageSeal {
	version: 1;
	manifestHash: string;
	replayHash: string;
	scoreHash: string;
	sealedAt: string;
	sealHash: string;
}

export function createResearchPackageSeal(manifest: ResearchPackageManifest, replay: unknown, score: unknown, now = new Date()): ResearchPackageSeal {
	const unsigned: Omit<ResearchPackageSeal, "sealHash"> = { version: 1, manifestHash: manifest.manifestHash, replayHash: researchObjectHash(replay), scoreHash: researchObjectHash(score), sealedAt: now.toISOString() };
	return { ...unsigned, sealHash: researchObjectHash(unsigned) };
}

export function verifyResearchPackageSeal(seal: ResearchPackageSeal, manifest: ResearchPackageManifest, replay: unknown, score: unknown): boolean {
	const { sealHash, ...unsigned } = seal;
	return seal.version === 1 && seal.manifestHash === manifest.manifestHash && seal.replayHash === researchObjectHash(replay) && seal.scoreHash === researchObjectHash(score) && sealHash === researchObjectHash(unsigned);
}

export function verifyResearchPackageManifest(manifest: ResearchPackageManifest): boolean {
	const { manifestHash, ...unsigned } = manifest;
	return manifest.version === 1 && manifestHash === researchObjectHash(unsigned);
}
