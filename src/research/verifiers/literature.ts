/** Deterministic provenance/citation/hypothesis gate for literature research. */
import type { HypothesisRecord, ResearchClaim } from "../contracts.js";
import { errorIssue, verificationResult, warningIssue, type ScientificVerificationResult, type VerificationIssue } from "./base.js";

export interface ScholarlySourceRecord {
	id: string;
	title: string;
	authors: string[];
	year: number;
	doi?: string;
	url?: string;
	retrievedAt: string;
	contentHash: string;
	primary: boolean;
	supportsClaimIds: string[];
	contradictsClaimIds: string[];
}

export interface LiteratureVerificationInput {
	sources: ScholarlySourceRecord[];
	claims: ResearchClaim[];
	hypotheses: HypothesisRecord[];
	searchQueries: string[];
	minimumSources: number;
	requireContraryEvidence: boolean;
	noveltyScope: string;
	noveltySearchCutoff: string;
}

function validUrl(value: string | undefined): boolean {
	if (!value) return false;
	try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; }
	catch { return false; }
}

function validDoi(value: string | undefined): boolean {
	return !!value && /^10\.\d{4,9}\/[\S]+$/i.test(value);
}

export function verifyLiteratureResearch(input: LiteratureVerificationInput): ScientificVerificationResult {
	const issues: VerificationIssue[] = [];
	if (input.searchQueries.length === 0 || input.searchQueries.some((query) => !query.trim())) issues.push(errorIssue("search-trace", "at least one non-empty literature search query is required"));
	if (input.sources.length < input.minimumSources) issues.push(errorIssue("source-count", `at least ${input.minimumSources} scholarly sources are required`));
	const ids = new Set<string>();
	const identities = new Set<string>();
	for (const source of input.sources) {
		if (!source.id.trim() || ids.has(source.id)) issues.push(errorIssue("duplicate-source-id", `invalid or duplicate source id: ${source.id}`));
		ids.add(source.id);
		if (!source.title.trim() || source.authors.length === 0 || !Number.isSafeInteger(source.year) || source.year < 1500 || source.year > 2100) issues.push(errorIssue("source-metadata", `incomplete source metadata: ${source.id}`));
		if (!validDoi(source.doi) && !validUrl(source.url)) issues.push(errorIssue("source-identity", `source needs a valid DOI or URL: ${source.id}`));
		if (!source.retrievedAt || Number.isNaN(Date.parse(source.retrievedAt))) issues.push(errorIssue("retrieved-at", `source retrieval time is invalid: ${source.id}`));
		if (!/^[a-f0-9]{64}$/i.test(source.contentHash)) issues.push(errorIssue("source-hash", `source content hash is invalid: ${source.id}`));
		const identity = (source.doi ?? source.url ?? source.title).toLowerCase();
		if (identities.has(identity)) issues.push(warningIssue("duplicate-source", `duplicate scholarly source: ${source.id}`));
		identities.add(identity);
	}
	const sourceClaimLinks = new Map<string, { support: number; contrary: number }>();
	for (const source of input.sources) {
		for (const claimId of source.supportsClaimIds) sourceClaimLinks.set(claimId, { support: (sourceClaimLinks.get(claimId)?.support ?? 0) + 1, contrary: sourceClaimLinks.get(claimId)?.contrary ?? 0 });
		for (const claimId of source.contradictsClaimIds) sourceClaimLinks.set(claimId, { support: sourceClaimLinks.get(claimId)?.support ?? 0, contrary: (sourceClaimLinks.get(claimId)?.contrary ?? 0) + 1 });
	}
	for (const claim of input.claims.filter((claim) => claim.status === "supported")) {
		if ((sourceClaimLinks.get(claim.id)?.support ?? 0) === 0) issues.push(errorIssue("claim-source", `supported literature claim lacks a linked source: ${claim.id}`));
		if (input.requireContraryEvidence && (sourceClaimLinks.get(claim.id)?.contrary ?? 0) === 0) issues.push(warningIssue("contrary-evidence", `no contrary evidence recorded for claim: ${claim.id}`));
	}
	for (const hypothesis of input.hypotheses) {
		if (!hypothesis.statement.trim() || !hypothesis.expectedObservation.trim() || !hypothesis.falsifier.trim()) issues.push(errorIssue("hypothesis", `hypothesis is not falsifiable: ${hypothesis.id}`));
	}
	if (!input.noveltyScope.trim() || !input.noveltySearchCutoff.trim()) issues.push(errorIssue("novelty-boundary", "novelty claims require a search scope and cutoff"));
	const checks = {
		searchTrace: input.searchQueries.length > 0 && input.searchQueries.every(Boolean),
		sourceCount: input.sources.length >= input.minimumSources,
		metadata: input.sources.every((source) => !!source.title && source.authors.length > 0 && Number.isSafeInteger(source.year)),
		identity: input.sources.every((source) => validDoi(source.doi) || validUrl(source.url)),
		provenance: input.sources.every((source) => /^[a-f0-9]{64}$/i.test(source.contentHash) && !Number.isNaN(Date.parse(source.retrievedAt))),
		claimSupport: input.claims.filter((claim) => claim.status === "supported").every((claim) => (sourceClaimLinks.get(claim.id)?.support ?? 0) > 0),
		falsifiableHypotheses: input.hypotheses.every((hypothesis) => !!hypothesis.statement && !!hypothesis.expectedObservation && !!hypothesis.falsifier),
		noveltyBoundary: !!input.noveltyScope.trim() && !!input.noveltySearchCutoff.trim(),
	};
	return verificationResult("literature-v1", issues, checks);
}
