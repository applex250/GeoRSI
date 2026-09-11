/** Deterministic tests for the draft-shape layer.
 *
 * The first case is a REGRESSION FIXTURE, not a synthetic edge case: it reproduces the exact key
 * set the defense node emitted on smoke-021b (`answer` + `evidence` + `evidence_id` +
 * `evidence_ids`, with the real `[evidence:sha256:…]` marker). That draft was substantively
 * correct and scored 0/12 under the old validator, which cost 21 compute rounds and 3.48M tokens.
 * Under the normalizer it must pass with zero issues, and the same run must package it as a `node`
 * deliverable rather than silently falling back to the deterministic template.
 */
import type { DefenseItem, EvidenceRef, ResearchClaim, ResearchMission } from "./contracts.js";
import { buildResearchDeliverablesWithSources, buildResearchReport, defenseDraftIssues, type GroundedNarrativeSection, type ResearchNarrative } from "./deliverables.js";
import { normalizeDefenseDraft, normalizePresentationDraft, normalizeReportDraft } from "./draft-normalizer.js";
import { validateResearchDeliverables } from "./deliverables.js";
import type { ScientificValueCard } from "./value-evaluator.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const HASHES = [
	"42ab3f2612412a335addd2c2c10afe2acc2a2f5e863fa28aee360c02dca69154",
	"7c1d88b0a4f24b6f9e0d5c3b2a1f7e8d6c5b4a39281706f5e4d3c2b1a0987654",
	"9e02f6a1c3d5b7e9081726354a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6",
	"a1b3c5d7e9f1023456789abcdeffedcba9876543210fedcba9876543210abcd",
].map((hash) => hash.slice(0, 64));

const ID = {
	toolOutput: `sha256:${HASHES[0]}`,
	figure: `sha256:${HASHES[1]}`,
	script: `sha256:${HASHES[2]}`,
	table: `sha256:${HASHES[3]}`,
	dataset: `sha256:${"b".repeat(64)}`,
};

function ref(id: string, kind: EvidenceRef["kind"]): EvidenceRef {
	return { id, kind, sha256: id.replace(/^sha256:/, ""), logicalName: `${kind}-artifact`, producerNodeId: "05-analysis", mediaType: "application/octet-stream", bytes: 1024 };
}

const EVIDENCE: EvidenceRef[] = [ref(ID.toolOutput, "tool-output"), ref(ID.figure, "figure"), ref(ID.script, "script"), ref(ID.table, "table"), ref(ID.dataset, "dataset")];

/** The exact shape recorded in runs/luna-smoke-021b-host — field names included. */
function smoke021bItem(id: string, category: string, question: string, evidenceId: string): Record<string, unknown> {
	return {
		id,
		category,
		question,
		answer: `${question} Grounded answer derived from the recorded artifacts. [evidence:${evidenceId}]`,
		evidence: evidenceId,
		evidence_id: evidenceId,
		evidenceIds: [evidenceId],
		evidence_ids: [evidenceId],
	};
}

function smoke021bDraft(): Record<string, unknown>[] {
	return [
		smoke021bItem("m1", "method", "What was the primary estimator?", ID.toolOutput),
		smoke021bItem("m2", "method", "Why was this method selected?", ID.script),
		smoke021bItem("m3", "method", "Which alternative was considered?", ID.table),
		smoke021bItem("d1", "data", "How was data quality assessed?", ID.table),
		smoke021bItem("d2", "data", "How were duplicates handled?", ID.toolOutput),
		smoke021bItem("d3", "data", "What shows the result came from the declared data?", ID.toolOutput),
		smoke021bItem("u1", "uncertainty", "How sensitive is the conclusion?", ID.figure),
		smoke021bItem("u2", "uncertainty", "Which intervals back the reported numbers?", ID.toolOutput),
		smoke021bItem("u3", "uncertainty", "What would falsify the main conclusion?", ID.figure),
		smoke021bItem("r1", "reproducibility", "Can another researcher reproduce this?", ID.script),
		smoke021bItem("r2", "reproducibility", "What would a replication need to match?", ID.toolOutput),
		smoke021bItem("l1", "limitation", "What is the strongest limitation?", ID.toolOutput),
	];
}

// ---------------------------------------------------------------------------------------------
// 1. Regression: the smoke-021b draft must now pass with zero issues
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — regression (smoke-021b)");
{
	const result = normalizeDefenseDraft(smoke021bDraft(), EVIDENCE);
	check("smoke-021b draft normalizes with ZERO blocking issues", result.issues.length === 0);
	check("all 12 items survive", result.items.length === 12);
	check("every item carries the canonical field name", result.items.every((item) => item.id && item.category && item.question && item.expertAnswer && item.nonExpertAnswer && Array.isArray(item.evidenceIds)));
	check("every expertAnswer embeds an [evidence:…] marker", result.items.every((item) => item.expertAnswer.includes("[evidence:")));
	check("every item stays grounded in real evidence", result.items.every((item) => item.evidenceIds.length > 0 && item.evidenceIds.every((id) => EVIDENCE.some((candidate) => candidate.id === id))));
	check("the rename is recorded as a coercion", result.coercions.some((entry) => entry.includes('read expertAnswer from field "answer"')));
	check("coverage of the four required categories holds", ["method", "data", "uncertainty", "reproducibility"].every((category) => result.items.some((item) => item.category === category)));

	const legacy = defenseDraftIssues(smoke021bDraft(), EVIDENCE);
	check("defenseDraftIssues reports no issues and yields a package", legacy.issues.length === 0 && legacy.normalized?.items.length === 12);
}

// ---------------------------------------------------------------------------------------------
// 2. Container variants
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — container shapes");
{
	const base = smoke021bDraft();
	const asItems = normalizeDefenseDraft({ items: base }, EVIDENCE);
	check("{ items: [...] } is unwrapped", asItems.items.length === 12 && asItems.issues.length === 0);

	const nested = normalizeDefenseDraft({ defense: { items: base } }, EVIDENCE);
	check("{ defense: { items: [...] } } is unwrapped", nested.items.length === 12 && nested.issues.length === 0);

	const fenced = normalizeDefenseDraft("Here is the package:\n```json\n" + JSON.stringify(base) + "\n```\n", EVIDENCE);
	check("fenced JSON string is parsed", fenced.items.length === 12 && fenced.issues.length === 0);

	const keyed = normalizeDefenseDraft(Object.fromEntries(base.map((item) => [String(item.id), item])), EVIDENCE);
	check("id-keyed object map becomes the item list", keyed.items.length === 12 && keyed.issues.length === 0);
}

// ---------------------------------------------------------------------------------------------
// 3. Field-name and category synonyms
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — synonyms");
{
	const synonyms = smoke021bDraft().map((item) => ({ ...item, category: { method: "Methods & Tools", data: "Data Quality", uncertainty: "Uncertainty and Sensitivity", reproducibility: "Reproducibility", limitation: "Limitations" }[String(item.category)] ?? item.category }));
	const result = normalizeDefenseDraft(synonyms, EVIDENCE);
	check("category synonyms map to canonical tokens", result.notes.length === 0 && result.items.every((item) => ["method", "data", "uncertainty", "reproducibility", "limitation"].includes(item.category)));
	check("category normalization is recorded", result.coercions.some((entry) => entry.includes('normalized category "Methods & Tools" -> "method"')));

	const alt = normalizeDefenseDraft(smoke021bDraft().map((item) => {
		const { answer, evidenceIds, ...rest } = item as Record<string, unknown>;
		return { ...rest, expert_answer: answer, citations: evidenceIds };
	}), EVIDENCE);
	check("expert_answer / citations spellings are accepted", alt.items.length === 12 && alt.notes.length === 0);

	// Vocabulary nobody enumerated: pure stem matching, no alias entry for any of these spellings.
	const exotic = normalizeDefenseDraft(smoke021bDraft().map((item) => {
		const { answer, evidenceIds, evidence, evidence_id, evidence_ids, category, question, ...rest } = item as Record<string, unknown>;
		return { ...rest, qa_type: category, prompt_v2: question, scientific_answer_v3: answer, supporting_refs: evidenceIds, layer: "x" };
	}), EVIDENCE);
	check("un-enumerated spellings resolve by stem", exotic.items.length === 12 && exotic.notes.length === 0);
	check("stem matches are labelled in the audit trail", exotic.coercions.some((entry) => entry.includes("(fuzzy match)")));
	check("a prose field is not mistaken for evidence", exotic.coercions.every((entry) => !entry.includes('"layer"')));

	// Object-valued answer that carries its own grounding.
	const nestedAnswer = normalizeDefenseDraft(smoke021bDraft().map((item) => {
		const { answer, evidenceIds, evidence, evidence_id, evidence_ids, ...rest } = item as Record<string, unknown>;
		return { ...rest, answer: { text: answer, evidenceIds: [String((evidenceIds as string[])[0])] } };
	}), EVIDENCE);
	check("an object-valued answer exposes its own evidence", nestedAnswer.items.length === 12 && nestedAnswer.items.every((item) => item.expertAnswer.includes("[evidence:")));
	check("the unpacking is recorded", nestedAnswer.coercions.some((entry) => entry.includes("unpacked object-valued field")));

	// Markdown table draft.
	const table = ["| Question | Category | Answer | Evidence |", "| --- | --- | --- | --- |", ...smoke021bDraft().map((item, index) => `| ${item.question} | ${item.category} | ${index === 0 ? item.answer : String(item.answer).replace(/\[evidence:[^\]]+\]/, "")} | ${(item.evidenceIds as string[])[0]} |`)].join("\n");
	const fromTable = normalizeDefenseDraft(table, EVIDENCE);
	check("a markdown-table draft is read as items", fromTable.items.length === 12 && fromTable.notes.length === 0);
	check("the table parse is recorded", fromTable.coercions.some((entry) => entry.includes("markdown table")));

	// Unrecognized category, but the evidence admits exactly one category (dataset -> data only).
	const inferred = normalizeDefenseDraft(smoke021bDraft().map((item) => item.id === "d1" ? { ...item, category: "provenance-and-inputs", evidenceIds: [ID.dataset], evidence: ID.dataset, evidence_id: ID.dataset, evidence_ids: [ID.dataset], answer: String(item.answer).replace(/\[evidence:[^\]]+\]/, `[evidence:${ID.dataset}]`) } : item), EVIDENCE);
	check("a category is inferred when the evidence admits exactly one", inferred.items.length === 12 && inferred.items.some((item) => item.category === "data" && item.id === "d1"));
	check("the inference is recorded", inferred.coercions.some((entry) => entry.includes("inferred category")));

	// Ambiguous evidence + unrecognized category is dropped rather than guessed.
	const ambiguous = normalizeDefenseDraft(smoke021bDraft().map((item) => item.id === "d1" ? { ...item, category: "misc", evidenceIds: [ID.table], evidence: ID.table, evidence_id: ID.table, evidence_ids: [ID.table], answer: String(item.answer).replace(/\[evidence:[^\]]+\]/, `[evidence:${ID.table}]`) } : item), EVIDENCE);
	check("an ambiguous category is dropped, not guessed", ambiguous.items.length === 11 && ambiguous.coercions.some((entry) => entry.includes("cannot be inferred unambiguously")));
}

// ---------------------------------------------------------------------------------------------
// 4. Evidence-id coercion
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — evidence ids");
{
	// Inline markers only: no id-bearing field at all.
	const inline = smoke021bDraft().map((item) => {
		const record = { ...item } as Record<string, unknown>;
		for (const key of ["evidence", "evidence_id", "evidenceIds", "evidence_ids"]) delete record[key];
		return record;
	});
	const fromInline = normalizeDefenseDraft(inline, EVIDENCE);
	check("ids are recovered from inline [evidence:…] markers", fromInline.items.length === 12 && fromInline.issues.length === 0);

	// Bare 64-hex ids without the sha256: prefix.
	const bare = smoke021bDraft().map((item) => {
		const raw = String(item.evidenceIds instanceof Array ? (item.evidenceIds as string[])[0] : "").replace(/^sha256:/, "");
		const record = { ...item, evidenceIds: [raw] } as Record<string, unknown>;
		return record;
	});
	const fromBare = normalizeDefenseDraft(bare, EVIDENCE);
	check("a bare sha256 hex id resolves to its canonical sha256: form", fromBare.items.length === 12 && fromBare.items[0]!.evidenceIds[0] === ID.toolOutput);
}

// ---------------------------------------------------------------------------------------------
// 5. Honesty: nothing is invented, ungrounded content is dropped and reported
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — honesty");
{
	const mixed = smoke021bDraft();
	mixed[0] = { ...mixed[0]!, evidenceIds: [ID.toolOutput, `sha256:${"0".repeat(64)}`], evidence_id: `sha256:${"0".repeat(64)}`, evidence_ids: [`sha256:${"0".repeat(64)}`], evidence: `sha256:${"0".repeat(64)}` };
	const result = normalizeDefenseDraft(mixed, EVIDENCE);
	check("an id that does not exist in this run is dropped, never repaired", result.items[0]!.evidenceIds.length === 1 && result.items[0]!.evidenceIds[0] === ID.toolOutput);
	check("the dropped id is recorded as a coercion", result.coercions.some((entry) => entry.includes("not present in this run")));

	// 13 items where one cites only fabricated evidence -> 12 grounded survive, zero issues.
	const withFabricated = [...smoke021bDraft(), { ...smoke021bItem("x1", "method", "Fabricated item?", `sha256:${"f".repeat(64)}`), evidenceIds: [`sha256:${"f".repeat(64)}`], evidence: `sha256:${"f".repeat(64)}`, evidence_id: `sha256:${"f".repeat(64)}`, evidence_ids: [`sha256:${"f".repeat(64)}`] }];
	const dropped = normalizeDefenseDraft(withFabricated, EVIDENCE);
	check("an item grounded only in fabricated evidence is dropped", dropped.items.length === 12 && !dropped.items.some((item) => item.id === "x1"));
	check("dropping garbage still yields a valid package", dropped.issues.length === 0);

	// All items fabricated -> substance failure, reported precisely.
	const allFabricated = smoke021bDraft().map((item) => ({ ...item, answer: String(item.answer).replace(/\[evidence:[^\]]+\]/g, ""), evidenceIds: [`sha256:${"1".repeat(64)}`], evidence: `sha256:${"1".repeat(64)}`, evidence_id: `sha256:${"1".repeat(64)}`, evidence_ids: [`sha256:${"1".repeat(64)}`] }));
	const empty = normalizeDefenseDraft(allFabricated, EVIDENCE);
	check("a fully fabricated draft is a blocking failure", empty.items.length === 0 && empty.issues.some((issue) => issue.includes("no grounded items")));

	// Category / evidence-kind mismatch: a method question backed only by a figure.
	const mismatched = smoke021bDraft();
	mismatched[0] = smoke021bItem("m1", "method", "Method question on figure evidence?", ID.figure);
	const kinds = normalizeDefenseDraft(mismatched, EVIDENCE);
	check("a category-kind mismatch is dropped, not force-grounded", kinds.items.length === 11 && kinds.coercions.some((entry) => entry.includes("cites only figure evidence")));
	check("a resulting shortfall is advisory, not blocking", kinds.issues.length === 0 && kinds.notes.some((note) => note.includes("grounded items")));

	// Dropping an entire required category is advisory too: packaging tops it up from the template.
	const nonMethod = smoke021bDraft().filter((item) => item.category !== "method");
	const noMethod = normalizeDefenseDraft([...nonMethod, ...nonMethod.slice(0, 3)], EVIDENCE);
	check("a missing required category is advisory, not blocking", noMethod.items.length === 12 && noMethod.issues.length === 0 && noMethod.notes.some((note) => note.includes("does not cover categor")));

	// Too few items is advisory: the template tops the set up.
	const short = normalizeDefenseDraft(smoke021bDraft().slice(0, 5), EVIDENCE);
	check("fewer than 12 items is advisory, not blocking", short.issues.length === 0 && short.notes.some((note) => note.includes("grounded items")));
}

// ---------------------------------------------------------------------------------------------
// 6. Structural repairs: ids, derived plain answer, idempotence
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — structural repairs");
{
	const dupes = smoke021bDraft().map((item) => ({ ...item, id: "same-id" }));
	const result = normalizeDefenseDraft(dupes, EVIDENCE);
	check("duplicate ids are renumbered", new Set(result.items.map((item) => item.id)).size === 12);
	check("missing nonExpertAnswer is derived from the expert answer", result.items.every((item) => item.nonExpertAnswer.length > 0));

	const canonical = smoke021bDraft().map((item) => {
		const { answer, evidence, evidence_id, evidence_ids, ...rest } = item as Record<string, unknown>;
		return { ...rest, expertAnswer: answer, nonExpertAnswer: `${String(answer).split(".")[0]}.` };
	});
	const second = normalizeDefenseDraft(normalizeDefenseDraft(canonical, EVIDENCE).items, EVIDENCE);
	check("normalizing an already-canonical draft is a no-op", second.items.length === 12 && second.issues.length === 0);
	const third = normalizeDefenseDraft(second.items, EVIDENCE);
	check("normalization is idempotent (no coercions on the second pass)", third.coercions.length === 0);
}

// ---------------------------------------------------------------------------------------------
// 7. Report + presentation
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — report and presentation");
{
	const report = [
		"# Research Report — test mission",
		"## 1. Non-expert Summary",
		`Text [evidence:${ID.toolOutput}]`,
		"## 2. Scientific Question & Value",
		"## 3. Literature Background and Gap",
		"## 4. Hypotheses and Falsification",
		"## 5. Data Provenance and Quality",
		"## 6. Methods and Tool Chain",
		`## 7. Results [evidence:${ID.script}]`,
		"## 8. Uncertainty and Sensitivity",
		"## 9. Claim–Evidence Conclusions",
		"## 10. Counter-evidence and Limitations",
		"## 11. Innovation",
		"## 12. Reproducibility",
		`## 13. Evidence Index [evidence:${ID.table}]`,
	].join("\n");
	const normalized = normalizeReportDraft(report);
	check("a near-miss report heading is rewritten to the mandated title", normalized.markdown.includes("## 2. Scientific Question and Value"));
	check("the canonicalized report has no issues", normalized.issues.length === 0);
	check("heading repair is recorded", normalized.coercions.some((entry) => entry.includes("canonicalized heading")));

	const ungrounded = normalizeReportDraft(report.replace(/\[evidence:[^\]]+\]/g, ""));
	check("a report without citations is a substance failure", ungrounded.issues.some((issue) => issue.includes("fewer than 3 evidence citations")));

	const deck = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => index === 3 ? `## Slide 3: Third finding\n\nBody [evidence:${ID.table}]` : index === 5 ? `**Slide 5**\n\nBody [evidence:${ID.figure}]` : `Slide ${index} — Finding ${index}\n\nBody [evidence:${ID.toolOutput}]`).join("\n\n---\n\n");
	const deckResult = normalizePresentationDraft(deck);
	check("mixed slide markers canonicalize to exactly 8 slides", deckResult.issues.length === 0 && (deckResult.markdown.match(/^# Slide /gm) ?? []).length === 8);
	check("hashed markers are rewritten", deckResult.markdown.includes("# Slide 3 — Third finding"));
	check("bold markers are rewritten", deckResult.markdown.includes("# Slide 5"));

	const sections = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => `# Section ${index}\n\nBody [evidence:${ID.toolOutput}]`).join("\n\n---\n\n");
	const rebuilt = normalizePresentationDraft(sections);
	check("a '---'-delimited deck is rebuilt into 8 slides", rebuilt.issues.length === 0 && rebuilt.coercions.some((entry) => entry.includes("rebuilt 8 slides")));

	const withEmpty = deck + "\n\n---\n\n# Slide 9 — Placeholder\n\n";
	const trimmed = normalizePresentationDraft(withEmpty);
	check("an empty trailing slide is dropped", trimmed.issues.length === 0 && trimmed.coercions.some((entry) => entry.includes("empty body")));
}

// ---------------------------------------------------------------------------------------------
// 8. End to end: the smoke-021b draft ships as a `node` deliverable
// ---------------------------------------------------------------------------------------------

console.log("draft normalizer — end to end packaging");
{
	const mission = { version: 1, id: "selftest", question: "Does the estimator recover the exponent?", scope: "bounded single-family synthetic catalog", estimands: ["slope b"], units: [], assumptions: [], constraints: [], successCriteria: [], requiredDeliverables: [], sourcePolicy: {}, taskProfile: {} } as unknown as ResearchMission;
	const section = (text: string): GroundedNarrativeSection => ({ text, evidenceIds: [ID.toolOutput] });
	const narrative: ResearchNarrative = {
		dataSummary: section("data"), methodSummary: section("method"), resultSummary: section("result"),
		uncertaintySummary: section("uncertainty"), innovationSummary: section("innovation"), reproducibilitySummary: section("reproducibility"),
	};
	const claims: ResearchClaim[] = [{ id: "C1", text: "The estimator recovers the exponent within the recorded interval.", status: "supported", evidenceIds: [ID.toolOutput], uncertainty: "bootstrap CI recorded", limitations: ["single family"] }];
	const dimension = { score: 3, rationale: "recorded", evidenceIds: [ID.toolOutput] };
	const valueCard = { significance: dimension, novelty: dimension, falsifiability: dimension, dataFeasibility: dimension, methodologicalValue: dimension, potentialImpact: dimension, limitations: ["single family"], recommendation: "proceed" } as ScientificValueCard;

	const built = buildResearchDeliverablesWithSources({ mission, valueCard, hypotheses: [], claims, evidence: EVIDENCE, narrative, drafts: { defenseItems: smoke021bDraft() } });
	check("the node's own defense draft is packaged as source=node", built.sources.defense === "node");
	check("the packaged bundle passes the substantive validator", validateResearchDeliverables(built.bundle, EVIDENCE).length === 0);
	check("packaged defense items carry the canonical field names", built.bundle.defense.items.every((item: DefenseItem) => typeof item.expertAnswer === "string" && item.expertAnswer.includes("[evidence:")));
	check("the packaged report/presentation still come from the deterministic template", built.sources.report === "template" && built.sources.presentation === "template");
	check("buildResearchReport remains callable on the same fixture", buildResearchReport({ mission, valueCard, hypotheses: [], claims, evidence: EVIDENCE, narrative }).includes("Scientific Question and Value"));

	// A PARTIAL draft must not become a failure: keep what the node grounded, top up the rest.
	const partial = buildResearchDeliverablesWithSources({ mission, valueCard, hypotheses: [], claims, evidence: EVIDENCE, narrative, drafts: { defenseItems: smoke021bDraft().slice(0, 5) } });
	check("a partial draft is packaged as source=augmented, not rejected", partial.sources.defense === "augmented");
	check("every grounded node item is preserved", smoke021bDraft().slice(0, 5).every((item) => partial.bundle.defense.items.some((packaged: DefenseItem) => packaged.id === item.id)));
	check("the augmented package reaches the minimum item count", partial.bundle.defense.items.length >= 12);
	check("the augmented package covers all four required categories", ["method", "data", "uncertainty", "reproducibility"].every((category) => partial.bundle.defense.items.some((item: DefenseItem) => item.category === category)));
	check("the augmented bundle passes the substantive validator", validateResearchDeliverables(partial.bundle, EVIDENCE).length === 0);
	check("the top-up is recorded as a coercion", partial.coercions.defense.some((entry) => entry.includes("added") && entry.includes("template item")));
	check("ids stay unique after augmentation", new Set(partial.bundle.defense.items.map((item: DefenseItem) => item.id)).size === partial.bundle.defense.items.length);

	// A draft that grounded nothing keeps zero node content: honest full fallback.
	const fabricated = smoke021bDraft().map((item) => ({ ...item, answer: String(item.answer).replace(/\[evidence:[^\]]+\]/g, ""), evidenceIds: [`sha256:${"c".repeat(64)}`], evidence: `sha256:${"c".repeat(64)}`, evidence_id: `sha256:${"c".repeat(64)}`, evidence_ids: [`sha256:${"c".repeat(64)}`] }));
	const fallback = buildResearchDeliverablesWithSources({ mission, valueCard, hypotheses: [], claims, evidence: EVIDENCE, narrative, drafts: { defenseItems: fabricated } });
	check("a fully fabricated draft falls back to source=template", fallback.sources.defense === "template");
	check("the fallback bundle is still valid", validateResearchDeliverables(fallback.bundle, EVIDENCE).length === 0);
	check("the fabrication is reported", fallback.draftIssues.defense.some((issue) => issue.includes("no grounded items")));

	// Report augmentation: keep the node's prose, fill only the missing sections.
	const reportSection = (title: string, body: string) => `## ${title}\n${body}`;
	const partialReport = [
		"# Research Report — node draft",
		reportSection("Scientific Question and Value", `Node prose. [evidence:${ID.toolOutput}]`),
		reportSection("Data Provenance and Quality", `Node prose. [evidence:${ID.table}]`),
		reportSection("Methods and Tool Chain", `Node prose. [evidence:${ID.script}]`),
	].join("\n\n");
	const augmented = buildResearchDeliverablesWithSources({ mission, valueCard, hypotheses: [], claims, evidence: EVIDENCE, narrative, drafts: { reportMarkdown: partialReport } });
	check("a partial report is packaged as source=augmented", augmented.sources.report === "augmented");
	check("the node's own report prose is preserved", augmented.bundle.reportMarkdown.includes("Node prose."));
	check("the augmented report passes the packaged gate", validateResearchDeliverables(augmented.bundle, EVIDENCE).filter((issue) => issue.startsWith("report")).length === 0);
	check("the report top-up is recorded", augmented.coercions.report.some((entry) => entry.includes("filled") && entry.includes("missing section")));
}

console.log(`\nDRAFT NORMALIZER OK (${passed} checks)`);
