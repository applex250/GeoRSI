/** Trusted runtime facts required before a research package is competition-eligible. */
import { createHash } from "node:crypto";
import { stableJson } from "./event-ledger.js";
import type { ResearchMission, ResearchTaskProfile } from "./contracts.js";
import type { EvidenceRef } from "./contracts.js";
import type { ScientificVerificationResult } from "./verifiers/base.js";

export interface ModelCallReceipt {
	id: string;
	provider: string;
	model: string;
	requestedThinking: string;
	effectiveThinking: string;
	inputTokens: number | null;
	outputTokens: number | null;
	reasoningTokens: number | null;
	totalTokens: number;
	success: boolean;
}

export interface ComputeReplayAttestation {
	passed: boolean;
	backend: "sandboxie-app-level" | "host-audit" | "deterministic-test-double";
	processOwnershipVerified: boolean;
}

export interface FamilyVerificationAttestation {
	profile: string;
	result: ScientificVerificationResult;
	inputHash: string;
	evidenceIds: string[];
}

export interface ContraryEvidenceLink {
	sourceEvidenceId: string;
	claimId: string;
}

export interface ResearchRuntimeAttestation {
	version: 1;
	runMode: "competition" | "deterministic-demo";
	unitTestsPassed: boolean;
	guardViolations: string[];
	cleanupPassed: boolean;
	isolationBackend: "sandboxie-app-level" | "host-audit" | "deterministic-test-double";
	modelCalls: ModelCallReceipt[];
	familyVerifications: FamilyVerificationAttestation[];
	contraryEvidenceLinks: ContraryEvidenceLink[];
	totalTokens: number;
	wallSeconds: number;
}

export function runtimeAttestationHash(attestation: ResearchRuntimeAttestation): string {
	return createHash("sha256").update(stableJson(attestation)).digest("hex");
}

export function requiredFamilyVerifierProfiles(profile: ResearchTaskProfile): string[] {
	return profile.family === "capstone" ? ["gis-v1", "literature-v1", "quantitative-v1"] : [profile.verifierProfile];
}

export function validateRuntimeAttestation(attestation: ResearchRuntimeAttestation, compute: ComputeReplayAttestation, mission: ResearchMission, evidence: readonly EvidenceRef[], claimIds: readonly string[]): string[] {
	const issues: string[] = [];
	if (attestation.version !== 1) issues.push("runtime attestation version must be 1");
	if (!attestation.unitTestsPassed) issues.push("unit tests were not attested as passed");
	if (attestation.guardViolations.length) issues.push("runtime guard violations are present");
	if (!attestation.cleanupPassed) issues.push("runtime cleanup did not pass");
	if (!compute.passed) issues.push("compute replay did not pass");
	if (attestation.runMode === "competition") {
		if (attestation.isolationBackend !== "sandboxie-app-level") issues.push("competition runtime requires Sandboxie app-level isolation");
		if (compute.backend !== "sandboxie-app-level" || !compute.processOwnershipVerified) issues.push("competition compute replay requires verified Sandboxie ownership");
		if (attestation.modelCalls.length === 0) issues.push("competition runtime requires model-call receipts");
	} else {
		issues.push("deterministic demo is not competition-eligible runtime evidence");
	}
	for (const receipt of attestation.modelCalls) {
		if (receipt.provider !== "ai-pixel" || receipt.model !== "gpt-5.6-luna" || receipt.requestedThinking !== "xhigh" || receipt.effectiveThinking !== "xhigh") issues.push(`forbidden or downgraded model receipt: ${receipt.id}`);
	}
	if (attestation.modelCalls.some((receipt) => !receipt.success)) issues.push("failed model receipts are present");
	if (attestation.totalTokens !== attestation.modelCalls.reduce((sum, receipt) => sum + receipt.totalTokens, 0)) issues.push("runtime token total does not match model receipts");
	const requiredProfiles = requiredFamilyVerifierProfiles(mission.taskProfile);
	const actualProfiles = attestation.familyVerifications.map((item) => item.profile).sort();
	if (new Set(actualProfiles).size !== actualProfiles.length || JSON.stringify(actualProfiles) !== JSON.stringify([...requiredProfiles].sort())) issues.push(`family verifier profiles must match exactly: ${requiredProfiles.join(",")}`);
	const knownEvidence = new Set(evidence.map((item) => item.id));
	for (const verification of attestation.familyVerifications) {
		if (verification.result.profile !== verification.profile || !verification.result.passed || !verification.inputHash || verification.evidenceIds.length === 0 || verification.evidenceIds.some((id) => !knownEvidence.has(id))) issues.push(`invalid family verifier attestation: ${verification.profile}`);
	}
	const knownClaims = new Set(claimIds);
	for (const link of attestation.contraryEvidenceLinks) {
		if (!knownEvidence.has(link.sourceEvidenceId) || evidence.find((item) => item.id === link.sourceEvidenceId)?.kind !== "source" || !knownClaims.has(link.claimId)) issues.push("contrary evidence link is invalid");
	}
	if (mission.sourcePolicy.requireContraryEvidence && attestation.contraryEvidenceLinks.length === 0) issues.push("required contrary evidence links are missing");
	return issues;
}
