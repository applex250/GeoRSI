/** Evidence-grounded report, presentation, and defense deliverables.
 *
 * Draft validation is split in two, deliberately:
 *  - `draft-normalizer.ts` owns SHAPE. Field names, containers, heading spelling, slide markers and
 *    citation placement are repaired deterministically before anything is judged, so a purely
 *    formal mismatch can never cost the model a round trip (smoke-021b burned 3.48M tokens doing
 *    exactly that).
 *  - this file owns SUBSTANCE. What remains here is the packaged gate: item counts, category
 *    coverage, and whether the cited evidence actually exists in this run.
 */
import type { DefenseItem, EvidenceRef, HypothesisRecord, ResearchClaim, ResearchMission } from "./contracts.js";
import type { ScientificValueCard } from "./value-evaluator.js";
import { validateResearchClaim } from "./decision-policy.js";
import { DEFENSE_CATEGORY_KINDS, DEFENSE_REQUIRED_CATEGORIES, DEFENSE_REQUIRED_ITEMS, normalizeDefenseDraft, normalizePresentationDraft, normalizeReportDraft } from "./draft-normalizer.js";

export { DEFENSE_CATEGORY_KINDS };

export interface GroundedNarrativeSection {
	text: string;
	evidenceIds: string[];
	claimIds?: string[];
	decisionIds?: string[];
}

export interface ResearchNarrative {
	dataSummary: GroundedNarrativeSection;
	methodSummary: GroundedNarrativeSection;
	resultSummary: GroundedNarrativeSection;
	uncertaintySummary: GroundedNarrativeSection;
	innovationSummary: GroundedNarrativeSection;
	reproducibilitySummary: GroundedNarrativeSection;
}

export type { DefenseItem };

export interface ResearchDeliverableBundle {
	reportMarkdown: string;
	presentationMarkdown: string;
	defense: { version: 1; items: DefenseItem[] };
}

function evidenceCitation(ids: readonly string[]): string {
	return ids.map((id) => `[evidence:${id}]`).join(" ");
}

function grounded(section: GroundedNarrativeSection): string {
	return `${section.text} ${evidenceCitation(section.evidenceIds)}`.trim();
}

function validateNarrative(narrative: ResearchNarrative, claims: readonly ResearchClaim[], evidence: readonly EvidenceRef[]): void {
	const knownEvidence = new Set(evidence.map((item) => item.id));
	const knownClaims = new Set(claims.map((claim) => claim.id));
	for (const [name, section] of Object.entries(narrative)) {
		if (!section.text.trim() || section.evidenceIds.length === 0) throw new Error(`narrative section ${name} requires text and evidence`);
		for (const id of section.evidenceIds) if (!knownEvidence.has(id)) throw new Error(`narrative section ${name} references unknown evidence ${id}`);
		for (const id of section.claimIds ?? []) if (!knownClaims.has(id)) throw new Error(`narrative section ${name} references unknown claim ${id}`);
	}
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
	validateNarrative(input.narrative, input.claims, input.evidence);
	const claimLines = claims.length
		? claims.map((claim) => `- **${claim.id}** ${claim.text} ${evidenceCitation(claim.evidenceIds)}\n  - Uncertainty: ${claim.uncertainty}\n  - Limitations: ${claim.limitations.join("; ") || "none recorded"}`).join("\n")
		: "- No supported claim was established; the result remains inconclusive.";
	const hypotheses = input.hypotheses.map((hypothesis) => `- **${hypothesis.id}** ${hypothesis.statement}\n  - Expected: ${hypothesis.expectedObservation}\n  - Falsifier: ${hypothesis.falsifier}\n  - Status: ${hypothesis.status}`).join("\n") || "- No hypothesis recorded.";
	const evidenceIndex = input.evidence.map((item) => `- **${item.id}** ${item.kind}: ${item.logicalName}; sha256=${item.sha256}; bytes=${item.bytes}${item.sourceUrl ? `; source=${item.sourceUrl}` : ""}`).join("\n");
	return `# Research Report — ${input.mission.question}\n\n` +
		`## 1. Non-expert Summary\n${grounded(input.narrative.resultSummary)}\n\n` +
		`## 2. Scientific Question and Value\nScope: ${input.mission.scope}\n\nSignificance=${input.valueCard.significance.score}/4; novelty=${input.valueCard.novelty.score}/4; recommendation=${input.valueCard.recommendation}.\n\n` +
		`## 3. Literature Background and Gap\n${grounded(input.narrative.innovationSummary)}\n\n` +
		`## 4. Hypotheses and Falsification\n${hypotheses}\n\n` +
		`## 5. Data Provenance and Quality\n${grounded(input.narrative.dataSummary)}\n\n` +
		`## 6. Methods and Tool Chain\n${grounded(input.narrative.methodSummary)}\n\n` +
		`## 7. Results\n${claimLines}\n\n` +
		`## 8. Uncertainty and Sensitivity\n${grounded(input.narrative.uncertaintySummary)}\n\n` +
		`## 9. Claim–Evidence Conclusions\n${claimLines}\n\n` +
		`## 10. Counter-evidence and Limitations\n${[...input.valueCard.limitations, ...claims.flatMap((claim) => claim.limitations)].map((item) => `- ${item}`).join("\n") || "- None recorded."}\n\n` +
		`## 11. Innovation\n${grounded(input.narrative.innovationSummary)}\n\n` +
		`## 12. Reproducibility\n${grounded(input.narrative.reproducibilitySummary)}\n\n` +
		`## 13. Evidence Index\n${evidenceIndex}\n`;
}

export function buildResearchPresentation(input: { mission: ResearchMission; claims: ResearchClaim[]; evidence: EvidenceRef[]; narrative: ResearchNarrative }): string {
	const claims = supportedClaims(input.claims, input.evidence);
	validateNarrative(input.narrative, input.claims, input.evidence);
	const keyClaim = claims[0];
	const claimText = keyClaim ? `${keyClaim.text} ${evidenceCitation(keyClaim.evidenceIds)}` : "No supported claim; result is inconclusive.";
	const slides = [
		["Problem and Value", `${input.mission.question}\n\n${input.mission.scope}`],
		["Data and Provenance", grounded(input.narrative.dataSummary)],
		["Hypothesis", input.mission.estimands.join(", ")],
		["Methods and Tool Chain", grounded(input.narrative.methodSummary)],
		["Key Result", claimText],
		["Robustness and Uncertainty", grounded(input.narrative.uncertaintySummary)],
		["Innovation and Limitations", grounded(input.narrative.innovationSummary)],
		["Reproduction and Conclusion", grounded(input.narrative.reproducibilitySummary)],
	];
	return slides.map(([title, body], index) => `# Slide ${index + 1} — ${title}\n\n${body}`).join("\n\n---\n\n") + "\n";
}

export function buildDefensePackage(input: { mission: ResearchMission; claims: ResearchClaim[]; evidence: EvidenceRef[]; narrative: ResearchNarrative }): { version: 1; items: DefenseItem[] } {
	const claims = supportedClaims(input.claims, input.evidence);
	validateNarrative(input.narrative, input.claims, input.evidence);
	const primaryClaim = claims[0];
	const claimIds = primaryClaim ? [primaryClaim.id] : [];
	// Category-applicable filter (smoke-018): single-family missions have no geodata/source
	// evidence, so gis/literature questions would be structurally unanswerable. Skip specs whose
	// category cannot be supported by the evidence kinds actually present.
	const availableKinds = new Set(input.evidence.map((reference) => reference.kind));
	const applicable = (category: DefenseItem["category"]): boolean => {
		// gis/literature questions are only answerable when their signature evidence actually
		// exists in the package (geodata artifacts / scholarly sources) — otherwise they are
		// structurally ungrounded for single-family missions.
		if (category === "gis") return availableKinds.has("geodata");
		if (category === "literature") return availableKinds.has("source");
		const allowed = DEFENSE_CATEGORY_KINDS[category];
		return !allowed || [...allowed].some((kind) => availableKinds.has(kind));
	};
	const allSpecs: [DefenseItem["category"], string, GroundedNarrativeSection, string?][] = [
		["method", "Why was this method selected?", input.narrative.methodSummary],
		["method", "Which alternative method was considered?", input.narrative.methodSummary, "The package supports only the recorded method choice; alternatives require their own decision and comparison evidence."],
		["data", "How was data quality assessed?", input.narrative.dataSummary],
		["causality", "Does the result establish causality?", input.narrative.resultSummary, "The supported claims are bounded by the recorded design; no stronger causal interpretation is established by this package."],
		["uncertainty", "How sensitive is the conclusion?", input.narrative.uncertaintySummary],
		["gis", "How were CRS and spatial validity checked?", input.narrative.methodSummary, "The cited GIS artifacts and verifier evidence bound the spatial-validity claim."],
		["literature", "What supports the novelty claim?", input.narrative.innovationSummary],
		["negative-result", "What would falsify the main conclusion?", input.narrative.uncertaintySummary, "The registered sensitivity and uncertainty evidence defines when the result becomes contradicted or inconclusive."],
		["reproducibility", "Can another researcher reproduce this result?", input.narrative.reproducibilitySummary],
		["limitation", "What is the strongest limitation?", input.narrative.resultSummary, primaryClaim?.limitations[0] ?? "The package records no stronger limitation claim."],
		["alternative", "Could an alternative explanation fit the evidence?", input.narrative.resultSummary, "Yes. The current evidence supports only the bounded claim and does not eliminate every alternative explanation."],
		["data", "What evidence shows the reported result came from the declared data?", input.narrative.dataSummary],
		["uncertainty", "Which intervals or distributions back the reported numbers?", input.narrative.uncertaintySummary],
		["method", "What preprocessing could have biased the estimate?", input.narrative.methodSummary],
		["data", "How were outliers and duplicates handled?", input.narrative.dataSummary],
		["reproducibility", "What would a replication need to match?", input.narrative.reproducibilitySummary],
	];
	const specs = allSpecs.filter(([category]) => applicable(category));
	return {
		version: 1,
		items: specs.map(([category, question, section, override], index) => {
			const evidenceIds = [...section.evidenceIds];
			const itemClaimIds = section.claimIds?.length ? section.claimIds : claimIds;
			const answer = override ?? section.text;
			const citation = evidenceCitation(evidenceIds);
			return {
				id: `defense-${String(index + 1).padStart(2, "0")}`,
				category,
				question,
				expertAnswer: `${answer} ${citation}`,
				nonExpertAnswer: `${answer.split(/[.;]/)[0]}. ${citation}`,
				claimIds: itemClaimIds,
				evidenceIds,
			};
		}),
	};
}

export interface CommunicationDrafts {
	/** report node's report.md (raw). */
	reportMarkdown?: string;
	/** presentation node's presentation.md (raw). */
	presentationMarkdown?: string;
	/** defense node's defense.json (parsed object or raw JSON string). */
	defenseItems?: unknown;
	/** Claim ids the defense drafts may reference; unknown ids are dropped by the normalizer. */
	claimIds?: readonly string[];
}

/** Normalized draft + the audit trail of what code repaired.
 * `issues` block (the draft is unusable); `notes` are advisory quality gaps the packaging step
 * tops up from the deterministic template. */
export interface DraftNormalization {
	normalized: { version: 1; items: DefenseItem[] } | undefined;
	coercions: string[];
	issues: string[];
	notes: string[];
}

export function reportDraftIssues(content: string): string[] {
	return normalizeReportDraft(content).issues;
}

export function presentationDraftIssues(content: string): string[] {
	return normalizePresentationDraft(content).issues;
}

export function defenseDraftIssues(items: unknown, evidence: readonly EvidenceRef[], claimIds?: readonly string[]): DraftNormalization {
	const result = normalizeDefenseDraft(items, evidence, claimIds);
	return {
		// Usable as soon as anything grounded survives: the template tops it up rather than
		// discarding the node's work outright.
		normalized: result.issues.length === 0 && result.items.length > 0 ? { version: 1, items: result.items } : undefined,
		coercions: result.coercions,
		issues: result.issues,
		notes: result.notes,
	};
}

/** Phase-(a): deliverables prefer the communication nodes' own artifacts when they pass the same
 * validation as packaged output; deterministic template build remains the fallback. */
/** `node` = entirely the node's own draft; `augmented` = node draft topped up with deterministic
 * template content; `template` = the node's draft was unusable and none of it was kept. */
export type DeliverableSource = "node" | "augmented" | "template";

export interface DeliverableBuildResult {
	bundle: ResearchDeliverableBundle;
	sources: { report: DeliverableSource; presentation: DeliverableSource; defense: DeliverableSource };
	/** Deterministic repairs and augmentations applied to each draft (audit trail; never a failure). */
	coercions: { report: string[]; presentation: string[]; defense: string[] };
	/** Substance-only reasons a node draft was replaced or topped up by the template. */
	draftIssues: { report: string[]; presentation: string[]; defense: string[] };
}

/** Split a report into `title -> section text` so a missing mandated section can be filled from the
 * deterministic template instead of discarding the whole report. */
function reportSections(markdown: string): Map<string, string> {
	const sections = new Map<string, string>();
	for (const part of markdown.split(/\n(?=#{1,6}\s)/)) {
		const match = /^#{1,6}\s+(?:\d+\.\s*)?(.+?)\s*$/m.exec(part);
		if (match) sections.set(match[1]!.trim(), part.trim());
	}
	return sections;
}

export function buildResearchDeliverablesWithSources(input: Parameters<typeof buildResearchReport>[0] & { narrative: ResearchNarrative; drafts?: CommunicationDrafts }): DeliverableBuildResult {
	const sources: DeliverableBuildResult["sources"] = { report: "template", presentation: "template", defense: "template" };
	const coercions: DeliverableBuildResult["coercions"] = { report: [], presentation: [], defense: [] };
	const draftIssues: DeliverableBuildResult["draftIssues"] = { report: [], presentation: [], defense: [] };
	const templateReport = buildResearchReport(input);
	const templatePresentation = buildResearchPresentation(input);
	const templateDefense = buildDefensePackage(input);
	let reportMarkdown = templateReport;
	let presentationMarkdown = templatePresentation;
	let defense: ResearchDeliverableBundle["defense"] = templateDefense;

	if (input.drafts?.reportMarkdown !== undefined) {
		// Take the NORMALIZED markdown, not the raw draft: heading canonicalization is part of the fix.
		const result = normalizeReportDraft(input.drafts.reportMarkdown);
		coercions.report = result.coercions;
		draftIssues.report = result.issues;
		if (result.issues.length === 0) {
			reportMarkdown = result.markdown;
			sources.report = "node";
		} else {
			// Top up: keep the node's report and splice in only the sections it is missing. Appending
			// template sections also restores the citation count, so the node's own prose survives
			// instead of the whole node being replaced by the template.
			const missing = result.issues.filter((issue) => issue.startsWith("missing section: ")).map((issue) => issue.slice("missing section: ".length));
			const templateSections = reportSections(templateReport);
			const fill = missing.map((title) => templateSections.get(title)).filter((section): section is string => !!section);
			if (fill.length > 0) {
				const evidenceIndexSplit = result.markdown.search(/\n#{1,6}\s+\d*\.?\s*Evidence Index/);
				const merged = evidenceIndexSplit >= 0
					? `${result.markdown.slice(0, evidenceIndexSplit)}\n\n${fill.join("\n\n")}${result.markdown.slice(evidenceIndexSplit)}`
					: `${result.markdown}\n\n${fill.join("\n\n")}`;
				const rechecked = normalizeReportDraft(merged);
				coercions.report.push(...rechecked.coercions);
				if (rechecked.issues.length === 0) {
					reportMarkdown = rechecked.markdown;
					sources.report = "augmented";
					coercions.report.push(`report: kept the node draft and filled ${fill.length} missing section(s) from the deterministic template: ${missing.join(", ")}`);
				}
			}
		}
	}
	if (input.drafts?.presentationMarkdown !== undefined) {
		const result = normalizePresentationDraft(input.drafts.presentationMarkdown);
		coercions.presentation = result.coercions;
		draftIssues.presentation = result.issues;
		if (result.issues.length === 0) { presentationMarkdown = result.markdown; sources.presentation = "node"; }
	}
	if (input.drafts?.defenseItems !== undefined) {
		const result = defenseDraftIssues(input.drafts.defenseItems, input.evidence, input.drafts.claimIds);
		coercions.defense = result.coercions;
		draftIssues.defense = [...result.issues, ...result.notes];
		if (result.normalized) {
			// Augment: keep every grounded node item, then top up from the template for anything the
			// node did not cover (missing categories, or a shortfall against the packaged minimum).
			const items = [...result.normalized.items];
			const ids = new Set(items.map((item) => item.id));
			// Required-category template items first, so a topping-up pass closes coverage before it
			// pads the count.
			const pool = [...templateDefense.items].sort((left, right) => Number(!DEFENSE_REQUIRED_CATEGORIES.includes(left.category)) - Number(!DEFENSE_REQUIRED_CATEGORIES.includes(right.category)));
			let added = 0;
			for (const candidate of pool) {
				const needCategory = DEFENSE_REQUIRED_CATEGORIES.includes(candidate.category) && !items.some((item) => item.category === candidate.category);
				if (!needCategory && items.length >= DEFENSE_REQUIRED_ITEMS) break;
				let id = candidate.id;
				let suffix = 2;
				while (ids.has(id)) { id = `${candidate.id}-tpl${suffix === 2 ? "" : suffix}`; suffix += 1; }
				ids.add(id);
				items.push({ ...candidate, id });
				added += 1;
			}
			if (added > 0) {
				coercions.defense.push(`defense: kept ${result.normalized.items.length} node item(s) and added ${added} deterministic template item(s) to complete coverage and reach ${DEFENSE_REQUIRED_ITEMS} items`);
				sources.defense = "augmented";
			} else {
				sources.defense = "node";
			}
			if (items.length >= DEFENSE_REQUIRED_ITEMS) defense = { version: 1, items };
		}
	}
	return { bundle: { reportMarkdown, presentationMarkdown, defense }, sources, coercions, draftIssues };
}

export function buildResearchDeliverables(input: Parameters<typeof buildResearchReport>[0] & { narrative: ResearchNarrative }): ResearchDeliverableBundle {
	return buildResearchDeliverablesWithSources(input).bundle;
}

export function validateResearchDeliverables(bundle: ResearchDeliverableBundle, evidence: readonly EvidenceRef[]): string[] {
	const issues: string[] = [];
	for (const section of ["Scientific Question and Value", "Hypotheses and Falsification", "Data Provenance and Quality", "Methods and Tool Chain", "Uncertainty and Sensitivity", "Reproducibility", "Evidence Index"]) {
		if (!bundle.reportMarkdown.includes(section)) issues.push(`report missing section: ${section}`);
	}
	const slideCount = (bundle.presentationMarkdown.match(/^# Slide /gm) ?? []).length;
	if (slideCount !== 8) issues.push(`presentation must contain exactly 8 slides, found ${slideCount}`);
	if (bundle.defense.items.length < 12) issues.push("defense package requires at least 12 questions");
	const known = new Map(evidence.map((item) => [item.id, item]));
	const relevantKinds = DEFENSE_CATEGORY_KINDS;
	for (const item of bundle.defense.items) {
		if (item.evidenceIds.length === 0) issues.push(`${item.id} has no evidence`);
		for (const id of item.evidenceIds) if (!known.has(id)) issues.push(`${item.id} references unknown evidence ${id}`);
		const allowed = relevantKinds[item.category];
		if (allowed && !item.evidenceIds.some((id) => allowed.has(known.get(id)?.kind ?? "source"))) issues.push(`${item.id} lacks category-relevant evidence`);
		if (!item.expertAnswer.includes("[evidence:")) issues.push(`${item.id} answer lacks an evidence citation`);
	}
	return issues;
}
