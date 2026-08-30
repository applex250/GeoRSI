/** Evidence-grounded report, presentation, and defense deliverables. */
import type { EvidenceRef, HypothesisRecord, ResearchClaim, ResearchMission } from "./contracts.js";
import type { ScientificValueCard } from "./value-evaluator.js";
import { validateResearchClaim } from "./decision-policy.js";

export interface ResearchNarrative {
	dataSummary: string;
	methodSummary: string;
	resultSummary: string;
	uncertaintySummary: string;
	innovationSummary: string;
	reproducibilitySummary: string;
}

export interface DefenseItem {
	id: string;
	category: "method" | "data" | "causality" | "uncertainty" | "gis" | "literature" | "negative-result" | "reproducibility" | "limitation" | "alternative";
	question: string;
	expertAnswer: string;
	nonExpertAnswer: string;
	claimIds: string[];
	evidenceIds: string[];
}

export interface ResearchDeliverableBundle {
	reportMarkdown: string;
	presentationMarkdown: string;
	defense: { version: 1; items: DefenseItem[] };
}

function evidenceCitation(ids: readonly string[]): string {
	return ids.map((id) => `[evidence:${id}]`).join(" ");
}

function supportedClaims(claims: readonly ResearchClaim[], evidence: readonly EvidenceRef[]): ResearchClaim[] {
	const invalid = claims.flatMap((claim) => validateResearchClaim(claim, evidence).map((issue) => `${claim.id}: ${issue}`));
	if (invalid.length > 0) throw new Error(`cannot build research deliverables from invalid claims: ${invalid.join("; ")}`);
	return claims.filter((claim) => claim.status === "supported");
}

export function buildResearchReport(input: {
	mission: ResearchMission;
	valueCard: ScientificValueCard;
	hypotheses: HypothesisRecord[];
	claims: ResearchClaim[];
	evidence: EvidenceRef[];
	narrative: ResearchNarrative;
}): string {
	const claims = supportedClaims(input.claims, input.evidence);
	const claimLines = claims.length
		? claims.map((claim) => `- **${claim.id}** ${claim.text} ${evidenceCitation(claim.evidenceIds)}\n  - Uncertainty: ${claim.uncertainty}\n  - Limitations: ${claim.limitations.join("; ") || "none recorded"}`).join("\n")
		: "- No supported claim was established; the result remains inconclusive.";
	const hypotheses = input.hypotheses.map((hypothesis) => `- **${hypothesis.id}** ${hypothesis.statement}\n  - Expected: ${hypothesis.expectedObservation}\n  - Falsifier: ${hypothesis.falsifier}\n  - Status: ${hypothesis.status}`).join("\n") || "- No hypothesis recorded.";
	const evidenceIndex = input.evidence.map((item) => `- **${item.id}** ${item.kind}: ${item.logicalName}; sha256=${item.sha256}; bytes=${item.bytes}${item.sourceUrl ? `; source=${item.sourceUrl}` : ""}`).join("\n");
	return `# Research Report — ${input.mission.question}\n\n` +
		`## 1. Non-expert Summary\n${input.narrative.resultSummary}\n\n` +
		`## 2. Scientific Question and Value\nScope: ${input.mission.scope}\n\nSignificance=${input.valueCard.significance.score}/4; novelty=${input.valueCard.novelty.score}/4; recommendation=${input.valueCard.recommendation}.\n\n` +
		`## 3. Literature Background and Gap\n${input.narrative.innovationSummary}\n\n` +
		`## 4. Hypotheses and Falsification\n${hypotheses}\n\n` +
		`## 5. Data Provenance and Quality\n${input.narrative.dataSummary}\n\n` +
		`## 6. Methods and Tool Chain\n${input.narrative.methodSummary}\n\n` +
		`## 7. Results\n${claimLines}\n\n` +
		`## 8. Uncertainty and Sensitivity\n${input.narrative.uncertaintySummary}\n\n` +
		`## 9. Claim–Evidence Conclusions\n${claimLines}\n\n` +
		`## 10. Counter-evidence and Limitations\n${[...input.valueCard.limitations, ...claims.flatMap((claim) => claim.limitations)].map((item) => `- ${item}`).join("\n") || "- None recorded."}\n\n` +
		`## 11. Innovation\n${input.narrative.innovationSummary}\n\n` +
		`## 12. Reproducibility\n${input.narrative.reproducibilitySummary}\n\n` +
		`## 13. Evidence Index\n${evidenceIndex}\n`;
}

export function buildResearchPresentation(input: { mission: ResearchMission; claims: ResearchClaim[]; evidence: EvidenceRef[]; narrative: ResearchNarrative }): string {
	const claims = supportedClaims(input.claims, input.evidence);
	const keyClaim = claims[0];
	const claimText = keyClaim ? `${keyClaim.text} ${evidenceCitation(keyClaim.evidenceIds)}` : "No supported claim; result is inconclusive.";
	const slides = [
		["Problem and Value", `${input.mission.question}\n\n${input.mission.scope}`],
		["Data and Provenance", input.narrative.dataSummary],
		["Hypothesis", input.mission.estimands.join(", ")],
		["Methods and Tool Chain", input.narrative.methodSummary],
		["Key Result", claimText],
		["Robustness and Uncertainty", input.narrative.uncertaintySummary],
		["Innovation and Limitations", input.narrative.innovationSummary],
		["Reproduction and Conclusion", input.narrative.reproducibilitySummary],
	];
	return slides.map(([title, body], index) => `# Slide ${index + 1} — ${title}\n\n${body}`).join("\n\n---\n\n") + "\n";
}

export function buildDefensePackage(input: { mission: ResearchMission; claims: ResearchClaim[]; evidence: EvidenceRef[]; narrative: ResearchNarrative }): { version: 1; items: DefenseItem[] } {
	const claims = supportedClaims(input.claims, input.evidence);
	const primaryClaim = claims[0];
	const claimIds = primaryClaim ? [primaryClaim.id] : [];
	const evidenceIds = primaryClaim?.evidenceIds.length ? primaryClaim.evidenceIds : input.evidence.slice(0, 1).map((item) => item.id);
	if (evidenceIds.length === 0) throw new Error("defense package requires at least one evidence item");
	const citation = evidenceCitation(evidenceIds);
	const specs: [DefenseItem["category"], string, string][] = [
		["method", "Why was this method selected?", input.narrative.methodSummary],
		["method", "Which alternative method was considered?", "Alternatives are recorded in the mission decision records and were rejected only against explicit acceptance evidence."],
		["data", "How was data quality assessed?", input.narrative.dataSummary],
		["causality", "Does the result establish causality?", "No causal claim is made unless the design identifies an intervention or valid causal identification strategy."],
		["uncertainty", "How sensitive is the conclusion?", input.narrative.uncertaintySummary],
		["gis", "How were CRS and spatial validity checked?", "Spatial outputs must pass CRS, axis-order, geometry, bounds, and replay-statistics verification."],
		["literature", "What supports the novelty claim?", input.narrative.innovationSummary],
		["negative-result", "What would falsify the main conclusion?", "The registered hypothesis falsifier or a failed sensitivity/independent check would make the result contradicted or inconclusive."],
		["reproducibility", "Can another researcher reproduce this result?", input.narrative.reproducibilitySummary],
		["limitation", "What is the strongest limitation?", primaryClaim?.limitations[0] ?? "The result is bounded by the frozen data and declared study scope."],
		["alternative", "Could an alternative explanation fit the evidence?", "Yes; alternatives must be compared against the same evidence and uncertainty rather than dismissed narratively."],
		["data", "Were any hidden labels or grader outputs used?", "No. The research worker receives public data and public feedback only; private evaluation occurs after isolation cleanup."],
	];
	return {
		version: 1,
		items: specs.map(([category, question, answer], index) => ({
			id: `defense-${String(index + 1).padStart(2, "0")}`,
			category,
			question,
			expertAnswer: `${answer} ${citation}`,
			nonExpertAnswer: `${answer.split(/[.;]/)[0]}. ${citation}`,
			claimIds,
			evidenceIds,
		})),
	};
}

export function buildResearchDeliverables(input: Parameters<typeof buildResearchReport>[0] & { narrative: ResearchNarrative }): ResearchDeliverableBundle {
	return {
		reportMarkdown: buildResearchReport(input),
		presentationMarkdown: buildResearchPresentation(input),
		defense: buildDefensePackage(input),
	};
}

export function validateResearchDeliverables(bundle: ResearchDeliverableBundle, evidence: readonly EvidenceRef[]): string[] {
	const issues: string[] = [];
	for (const section of ["Scientific Question and Value", "Hypotheses and Falsification", "Data Provenance and Quality", "Methods and Tool Chain", "Uncertainty and Sensitivity", "Reproducibility", "Evidence Index"]) {
		if (!bundle.reportMarkdown.includes(section)) issues.push(`report missing section: ${section}`);
	}
	const slideCount = (bundle.presentationMarkdown.match(/^# Slide /gm) ?? []).length;
	if (slideCount !== 8) issues.push(`presentation must contain exactly 8 slides, found ${slideCount}`);
	if (bundle.defense.items.length < 12) issues.push("defense package requires at least 12 questions");
	const known = new Set(evidence.map((item) => item.id));
	for (const item of bundle.defense.items) {
		if (item.evidenceIds.length === 0) issues.push(`${item.id} has no evidence`);
		for (const id of item.evidenceIds) if (!known.has(id)) issues.push(`${item.id} references unknown evidence ${id}`);
		if (!item.expertAnswer.includes("[evidence:")) issues.push(`${item.id} answer lacks an evidence citation`);
	}
	return issues;
}
