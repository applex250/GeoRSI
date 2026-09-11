/** Deterministic draft normalization — shape is owned by code, content is owned by the model.
 *
 * WHY THIS MODULE EXISTS (smoke-021b, 2026-09-11)
 * ----------------------------------------------
 * The defense node burned 3.48M tokens across 21 compute rounds without ever submitting. Its
 * `defense.json` was substantively correct — 12 items, four categories, real evidence ids, an
 * `[evidence:…]` marker in every body — but it wrote the answers under the key `answer` while the
 * packaged validator read `expertAnswer`. Every rejection therefore read
 * "defense.json draft: m1: answer lacks an evidence citation", which was perfectly consistent with
 * the model's own hypothesis ("my citations are malformed"), so it rewrote citations for 21 rounds
 * and never touched the field name. Its own purpose strings show it reverse-engineering the
 * validator at runtime ("Search non-compute runtime files for the defense validator").
 *
 * The lesson is general, not defense-specific: any gate that can fail for a *purely formal* reason
 * (field name, container shape, heading spelling, citation-marker placement) must be repaired by
 * deterministic code BEFORE it is allowed to reject. Rejection is reserved for substantive failures
 * — too few items, no real evidence attached, missing category coverage — where the model is the
 * only one who can supply the missing content.
 *
 * WHAT A COERCION MAY DO
 * ----------------------
 * Rename, unwrap, renumber, re-derive and drop. It may NEVER fabricate: no invented question, no
 * invented answer, no invented evidence id. In particular, appending an `[evidence:…]` marker is
 * legal only when the id is *already* attached to that item (explicitly or inline in its own text)
 * and exists in this run's evidence index. Everything else is reported, not repaired.
 *
 * Every repair is emitted as a human-readable coercion string so the event ledger and the
 * submission metadata can prove exactly what code changed and what the model actually authored.
 */
import type { DefenseItem, EvidenceRef } from "./contracts.js";

/** Minimum grounded items the packaged defense requires. */
export const DEFENSE_REQUIRED_ITEMS = 12;
/** Categories the packaged defense must cover (mirrors the packaged validator, no stricter). */
export const DEFENSE_REQUIRED_CATEGORIES: readonly DefenseItem["category"][] = ["method", "data", "uncertainty", "reproducibility"];

/** Which evidence kinds can ground which question category. Kept here (not in deliverables.ts) so
 * the normalizer can repair category/evidence mismatches before the packaged gate ever sees them. */
export const DEFENSE_CATEGORY_KINDS: Partial<Record<DefenseItem["category"], Set<EvidenceRef["kind"]>>> = {
	method: new Set(["script", "tool-output", "table", "verifier", "geodata"]),
	data: new Set(["dataset", "table", "tool-output", "source"]),
	uncertainty: new Set(["table", "figure", "verifier", "tool-output"]),
	gis: new Set(["geodata", "figure", "verifier"]),
	literature: new Set(["source"]),
	reproducibility: new Set(["script", "verifier", "tool-output"]),
};

export interface DefenseNormalization {
	/** Whatever survived normalization — always returned, even when `issues` is non-empty. */
	items: DefenseItem[];
	/** Every deterministic repair applied, in order. Audit trail; never a blocker. */
	coercions: string[];
	/** Blocking: the draft is unusable as a whole (unreadable container, zero grounded items). */
	issues: string[];
	/** Advisory: the draft is usable but thin (fewer than 12 items, or a category it never covers).
	 * These are worth one guided retry and are then topped up from the deterministic template by
	 * `buildResearchDeliverablesWithSources` — they must never fail a run on their own. */
	notes: string[];
}

export interface TextNormalization {
	markdown: string;
	coercions: string[];
	issues: string[];
}

// ---------------------------------------------------------------------------------------------
// Field, category and container aliases
// ---------------------------------------------------------------------------------------------

type CanonicalField = "id" | "category" | "question" | "expertAnswer" | "nonExpertAnswer" | "claimIds" | "evidenceIds";

/** Field-name synonyms, highest priority first. Keys are compared after `normalizeKey`, so
 * `expert_answer`, `expertAnswer` and `Expert Answer` are the same key. */
const FIELD_EXACT_ALIASES: Record<CanonicalField, readonly string[]> = {
	id: ["id", "questionid", "qid", "key", "slug", "refid", "ref", "name"],
	category: ["category", "type", "kind", "domain", "dimension", "aspect", "classification", "class"],
	question: ["question", "q", "prompt", "questiontext", "query", "ask", "title", "heading"],
	expertAnswer: ["expertanswer", "expert", "detailedanswer", "scientificanswer", "technicalanswer", "answer", "response", "explanation", "answertext", "a", "content", "body", "text"],
	nonExpertAnswer: ["nonexpertanswer", "plainlanguageanswer", "plainanswer", "laymananswer", "simplifiedanswer", "simpleanswer", "generalanswer", "publicanswer", "nonexpert", "plain"],
	claimIds: ["claimids", "claimid", "claims", "claimrefs", "supportingclaimids", "relatedclaimids", "relatedclaims"],
	evidenceIds: [
		"evidenceids", "evidenceid", "evidence", "evidences", "citation", "citations", "citedevidence", "citedevidenceids",
		"sourceevidenceids", "supportingevidenceids", "supportingevidence", "evidencerefs", "references", "refs", "sources",
		"artifacts", "artifactids", "provenance", "grounding", "basis", "support",
	],
};

/** Semantic stems for the SECOND matching pass. Widen here instead of enumerating spellings: any
 * key that carries the stem (e.g. `supporting_refs`, `scientific_answer_v2`, `qa_type`) resolves
 * without a new alias entry, which is what keeps unenumerated model vocabulary from becoming a
 * rejection. `exclude` blocks a stem from stealing a neighbouring field's key. */
const FIELD_STEMS: Record<CanonicalField, { stems: readonly string[]; exclude: readonly string[] }> = {
	id: { stems: ["questionid", "qid", "slug", "key", "ref"], exclude: [] },
	category: { stems: ["category", "categ", "type", "kind", "class", "dimension", "aspect", "domain", "topic"], exclude: ["evidence", "citation", "answer", "question"] },
	question: { stems: ["question", "quest", "prompt", "query"], exclude: ["evidence", "citation", "claim", "answer", "response"] },
	// Order matters: `nonExpertAnswer` is resolved before `expertAnswer`, and the exclusion lists
	// keep `answer` from swallowing `not_expert_answer` or `answer_evidence_ids`.
	nonExpertAnswer: { stems: ["nonexpert", "plain", "layman", "simple", "simplified", "public", "accessible"], exclude: ["evidence", "citation", "claim", "question"] },
	expertAnswer: { stems: ["expertanswer", "expertans", "answer", "response", "reply", "explanation", "rationale", "detail"], exclude: ["nonexpert", "plain", "layman", "simple", "evidence", "citation", "claim", "category", "categ", "question", "artifact", "support", "basis", "provenance"] },
	claimIds: { stems: ["claim"], exclude: ["evidence", "citation", "answer", "question"] },
	evidenceIds: { stems: ["evidence", "evid", "citation", "cite", "source", "reference", "artifact", "proof", "grounding", "support", "basis", "provenance"], exclude: ["answer", "question", "claim", "categ", "text", "note", "desc", "rationale", "summary", "name"] },
};

/** Resolution order. `nonExpertAnswer` before `expertAnswer`, `claimIds` before `evidenceIds`:
 * the more specific field claims its key first, so the generic stems cannot steal it. */
const FIELD_ORDER: readonly CanonicalField[] = ["id", "category", "question", "nonExpertAnswer", "expertAnswer", "claimIds", "evidenceIds"];

/** Human-readable field names for the audit trail. */
const FIELD_LABELS: Record<CanonicalField, string> = {
	id: "id", category: "category", question: "question", expertAnswer: "expertAnswer",
	nonExpertAnswer: "nonExpertAnswer", claimIds: "claimIds", evidenceIds: "evidenceIds",
};

const EVIDENCE_LIKE = /^(sha256:)?[0-9a-f]{64}$/i;

/** Category synonyms. Single-table missions use the four required categories; the rest are
 * accepted when the model volunteers them and the evidence actually supports them. */
const CATEGORY_ALIASES: Readonly<Record<string, DefenseItem["category"]>> = {
	method: "method", methods: "method", methodology: "method", methodsandtools: "method", methodstools: "method",
	methodandtoolchain: "method", methodsandtoolchain: "method", methodchoice: "method", approach: "method",
	approachandmethod: "method", technique: "method", techniques: "method", procedure: "method", processing: "method",
	preprocessing: "method", toolchain: "method", analysis: "method",
	data: "data", dataquality: "data", dataset: "data", inputdata: "data", dataprovenance: "data", provenance: "data",
	datasource: "data", samples: "data",
	uncertainty: "uncertainty", uncertaintyandsensitivity: "uncertainty", sensitivity: "uncertainty", error: "uncertainty",
	statisticaluncertainty: "uncertainty", confidence: "uncertainty",
	reproducibility: "reproducibility", reproduction: "reproducibility", replicability: "reproducibility",
	repeatability: "reproducibility", reproducibilityandconclusion: "reproducibility",
	causality: "causality", causal: "causality", causalinterpretation: "causality", inference: "causality",
	gis: "gis", spatial: "gis", geospatial: "gis", spatialvalidity: "gis", crs: "gis",
	literature: "literature", background: "literature", novelty: "literature", priorwork: "literature",
	negativeresult: "negative-result", negative: "negative-result", falsification: "negative-result", falsifier: "negative-result",
	limitation: "limitation", limitations: "limitation", weakness: "limitation", caveat: "limitation",
	alternative: "alternative", alternatives: "alternative", alternativeexplanation: "alternative",
};

/** Container keys probed (in order) when the draft root is an object instead of an array. */
const CONTAINER_KEYS = ["items", "questions", "qa", "qna", "qas", "defense", "defenseitems", "entries", "list", "drafts", "package", "result", "output", "data", "body", "content"];

function normalizeKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------------------------
// Value coercion primitives
// ---------------------------------------------------------------------------------------------

/** Lenient JSON parse: tolerates BOM, ```json fences, and leading/trailing prose. */
function lenientJsonParse(raw: string): unknown {
	const cleaned = raw.replace(/^\uFEFF/, "").replace(/```(?:json|JSON)?/g, "").trim();
	const candidates = [cleaned];
	const firstArray = cleaned.indexOf("[");
	const lastArray = cleaned.lastIndexOf("]");
	if (firstArray >= 0 && lastArray > firstArray) candidates.push(cleaned.slice(firstArray, lastArray + 1));
	const firstObject = cleaned.indexOf("{");
	const lastObject = cleaned.lastIndexOf("}");
	if (firstObject >= 0 && lastObject > firstObject) candidates.push(cleaned.slice(firstObject, lastObject + 1));
	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate);
		} catch { /* try the next shape */ }
	}
	return undefined;
}

/** Read a markdown table of Q&A rows into item records. Headers are matched with the same field
 * resolution as JSON keys, so `| Question | Answer | Evidence |` and `| q | answer | citations |`
 * both work. Returns undefined when the text is not a usable table. */
function parseMarkdownTable(text: string, coercions: string[]): Record<string, unknown>[] | undefined {
	const rows = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("|") && line.endsWith("|"));
	if (rows.length < 3) return undefined;
	const split = (line: string): string[] => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
	const headers = split(rows[0]!);
	if (headers.every((header) => /^:?-{2,}:?$/.test(header))) return undefined;
	const body = rows.slice(1).filter((line) => !split(line).every((cell) => /^:?-{2,}:?$/.test(cell)));
	if (body.length === 0) return undefined;
	const items: Record<string, unknown>[] = [];
	for (const line of body) {
		const cells = split(line);
		const item: Record<string, unknown> = {};
		for (const [index, header] of headers.entries()) if (header && cells[index] !== undefined) item[header] = cells[index];
		items.push(item);
	}
	coercions.push(`parsed a markdown table of ${items.length} rows into items`);
	return items;
}

function looksLikeItem(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const keys = Object.keys(value as Record<string, unknown>).map(normalizeKey);
	const wanted = [...FIELD_EXACT_ALIASES.question, ...FIELD_EXACT_ALIASES.expertAnswer, ...FIELD_EXACT_ALIASES.category];
	return keys.some((key) => wanted.includes(key) || key.includes("answer") || key.includes("question"));
}

/** Unwrap any reasonable container into a flat item array. Returns undefined only when the draft
 * is not a list of Q&A records in any recognizable shape. */
function unwrapContainer(raw: unknown, coercions: string[], depth = 0): unknown[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (depth > 4) return undefined;
	if (typeof raw === "string") {
		const parsed = lenientJsonParse(raw);
		if (parsed !== undefined) {
			coercions.push("parsed draft content as JSON (raw string)");
			return unwrapContainer(parsed, coercions, depth + 1);
		}
		// A draft written as a markdown table is a legitimate way to express Q&A pairs; reading it
		// is far cheaper than making the node re-emit the same content as JSON.
		const table = parseMarkdownTable(raw, coercions);
		if (table) return table;
		return undefined;
	}
	if (Array.isArray(raw)) {
		// A single wrapped item (`[{...}]` where the item itself holds the list) is unwrapped too.
		if (raw.length === 1 && !looksLikeItem(raw[0])) {
			const inner = unwrapContainer(raw[0], coercions, depth + 1);
			if (inner && inner.length > 0) {
				coercions.push("unwrapped single-element array around the item list");
				return inner;
			}
		}
		return raw;
	}
	if (typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	if (looksLikeItem(record)) return [record];
	const byNormalizedKey = new Map<string, [string, unknown]>();
	for (const [key, value] of Object.entries(record)) byNormalizedKey.set(normalizeKey(key), [key, value]);
	for (const wanted of CONTAINER_KEYS) {
		const hit = byNormalizedKey.get(wanted);
		if (!hit) continue;
		const inner = unwrapContainer(hit[1], coercions, depth + 1);
		if (inner && inner.length > 0) {
			coercions.push(`unwrapped object container key "${hit[0]}" into ${inner.length} items`);
			return inner;
		}
	}
	// A map of id -> item (e.g. {"method-1": {...}, "data-1": {...}}).
	const values = Object.values(record);
	if (values.length > 0 && values.every(looksLikeItem)) {
		coercions.push(`treated object of ${values.length} keyed entries as the item list`);
		return values;
	}
	// One more level of nesting (e.g. {defense: {drafts: [...]}}).
	for (const value of values) {
		if (!value || typeof value !== "object") continue;
		const inner = unwrapContainer(value, coercions, depth + 1);
		if (inner && inner.length > 0) {
			coercions.push(`unwrapped nested object into ${inner.length} items`);
			return inner;
		}
	}
	return undefined;
}

function hasContent(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
	return true;
}

interface ResolvedField {
	/** Original (unnormalized) key the value came from. */
	key: string;
	value: unknown;
	matched: "alias" | "stem";
}

/** Resolve every canonical field to a key in the item, in `FIELD_ORDER`, each key claiming at most
 * one field. Exact aliases win; the stem pass then picks up vocabulary nobody enumerated. */
function resolveFields(record: Map<string, [string, unknown]>, coercions: string[], index: number): Map<CanonicalField, ResolvedField> {
	const claimed = new Set<string>();
	const resolved = new Map<CanonicalField, ResolvedField>();
	const keys = [...record.keys()];
	for (const field of FIELD_ORDER) {
		let hit: { key: string; value: unknown; matched: "alias" | "stem" } | undefined;
		for (const alias of FIELD_EXACT_ALIASES[field]) {
			if (claimed.has(alias)) continue;
			const entry = record.get(alias);
			if (!entry || !hasContent(entry[1])) continue;
			hit = { key: entry[0], value: entry[1], matched: "alias" };
			break;
		}
		if (!hit) {
			const { stems, exclude } = FIELD_STEMS[field];
			let best: { key: string; value: unknown; score: number } | undefined;
			for (const key of keys) {
				if (claimed.has(key)) continue;
				if (exclude.some((blocked) => key.includes(blocked))) continue;
				const score = stems.reduce((best2, stem) => (key.includes(stem) ? Math.max(best2, stem.length) : best2), 0);
				if (score === 0) continue;
				const value = record.get(key)![1];
				if (!hasContent(value)) continue;
				// A stem-matched evidence field must actually look like ids: prose that merely
				// mentions evidence would add noise, not grounding.
				if (field === "evidenceIds" && !looksLikeIdList(value)) continue;
				if (!best || score > best.score) best = { key, value, score };
			}
			if (best) hit = { key: record.get(best.key)![0], value: best.value, matched: "stem" };
		}
		if (!hit) continue;
		claimed.add(normalizeKey(hit.key));
		resolved.set(field, hit);
		if (normalizeKey(hit.key) !== FIELD_EXACT_ALIASES[field][0]) coercions.push(`item[${index}]: read ${FIELD_LABELS[field]} from field "${hit.key}"${hit.matched === "stem" ? " (fuzzy match)" : ""}`);
	}
	return resolved;
}

/** Evidence-id-bearing values only: `[evidence:…]` markers, whitespace/comma separated ids, or
 * nested objects that carry an id. */
function evidenceCandidates(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (typeof value === "string") {
		const inline = [...value.matchAll(/\[evidence:\s*([^\]]+)\]/g)].map((match) => match[1]!.trim());
		if (inline.length > 0) return inline;
		return value.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
	}
	if (Array.isArray(value)) return value.flatMap((entry) => evidenceCandidates(entry));
	if (typeof value === "object") {
		const nested = value as Record<string, unknown>;
		for (const key of ["id", "evidenceId", "evidence_id", "sha256", "ref", "value", "name"]) {
			const hit = nested[key];
			if (typeof hit === "string" && hit.trim()) return [hit.trim()];
		}
	}
	return [];
}

function looksLikeIdList(value: unknown): boolean {
	return evidenceCandidates(value).some((candidate) => EVIDENCE_LIKE.test(candidate.replace(/^[\s([{"'`]+/, "").replace(/[\s)\]}"'`,;.]+$/, "")));
}

function asStringList(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (typeof value === "string") return value.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);
	if (Array.isArray(value)) return value.flatMap((entry) => asStringList(entry));
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of ["id", "value", "text", "name"]) {
			const hit = record[key];
			if (typeof hit === "string" && hit.trim()) return [hit.trim()];
		}
	}
	return [];
}

/** Canonicalize one evidence-id candidate against this run's evidence index. Returns the index key
 * verbatim when it matches, or the `sha256:`-normalized form when the model dropped the prefix. */
function canonicalEvidenceId(candidate: string, known: Map<string, EvidenceRef>): string | undefined {
	let value = candidate.trim().replace(/^[\s([{"'`]+/, "").replace(/[\s)\]}"'`,;.]+$/, "");
	if (!value) return undefined;
	value = value.replace(/^\[?\s*evidence\s*[:=]\s*/i, "").replace(/\]$/, "").trim();
	if (known.has(value)) return value;
	const bare = value.replace(/^sha256:/i, "").toLowerCase();
	if (/^[0-9a-f]{64}$/.test(bare)) {
		const prefixed = `sha256:${bare}`;
		if (known.has(prefixed)) return prefixed;
	}
	return undefined;
}

// ---------------------------------------------------------------------------------------------
// Defense draft normalization
// ---------------------------------------------------------------------------------------------

export function normalizeDefenseDraft(raw: unknown, evidence: readonly EvidenceRef[], knownClaimIds?: readonly string[]): DefenseNormalization {
	const coercions: string[] = [];
	const issues: string[] = [];
	const notes: string[] = [];
	const known = new Map(evidence.map((item) => [item.id, item]));
	const knownClaims = new Set(knownClaimIds ?? []);

	const list = unwrapContainer(raw, coercions);
	if (!list) {
		return { items: [], coercions, issues: ["defense draft is not a list of Q&A items in any recognized shape (JSON array, {items:[…]}, fenced JSON, or a markdown table)"], notes };
	}

	const items: DefenseItem[] = [];
	const usedIds = new Set<string>();
	for (const [index, entry] of list.entries()) {
		const normalized = normalizeDefenseItem(entry, index, known, knownClaims, coercions);
		if (!normalized) continue;
		// Guarantee unique ids without touching the model's content.
		let id = normalized.id;
		if (usedIds.has(id)) {
			let suffix = 2;
			while (usedIds.has(`${id}-${suffix}`)) suffix += 1;
			coercions.push(`item[${index}]: duplicate id "${id}" renumbered to "${id}-${suffix}"`);
			id = `${id}-${suffix}`;
		}
		usedIds.add(id);
		items.push({ ...normalized, id });
	}

	if (items.length === 0) {
		issues.push(`defense draft has no grounded items at all (all ${list.length} raw entries were unusable)`);
	}
	if (items.length > 0 && items.length < DEFENSE_REQUIRED_ITEMS) {
		notes.push(`defense draft has only ${items.length} grounded items (the packaged set needs ${DEFENSE_REQUIRED_ITEMS})`);
	}
	const covered = new Set(items.map((item) => item.category));
	const missing = DEFENSE_REQUIRED_CATEGORIES.filter((category) => !covered.has(category));
	if (missing.length > 0) {
		notes.push(`defense draft does not cover categor${missing.length === 1 ? "y" : "ies"} ${missing.map((category) => `"${category}"`).join(", ")} (required: ${DEFENSE_REQUIRED_CATEGORIES.join(", ")})`);
	}
	return { items, coercions, issues, notes };
}

function normalizeDefenseItem(entry: unknown, index: number, known: Map<string, EvidenceRef>, knownClaims: Set<string>, coercions: string[]): DefenseItem | undefined {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		coercions.push(`dropped item[${index}]: not a Q&A object`);
		return undefined;
	}
	const raw = entry as Record<string, unknown>;
	const record = new Map<string, [string, unknown]>();
	for (const [key, value] of Object.entries(raw)) {
		record.set(normalizeKey(key), [key, value]);
		// `"answer": { "text": "…", "evidenceIds": ["sha256:…"] }` — lift both halves so a single
		// resolution pass sees them; an object-valued answer must not hide its own grounding.
		if (value && typeof value === "object" && !Array.isArray(value) && /answer|response|reply|explanation/.test(normalizeKey(key))) {
			coercions.push(`item[${index}]: unpacked object-valued field "${key}"`);
			for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
				const normalized = normalizeKey(innerKey);
				if (!record.has(normalized)) record.set(normalized, [innerKey, innerValue]);
			}
		}
	}
	const fields = resolveFields(record, coercions, index);
	const readText = (field: CanonicalField): string => {
		const hit = fields.get(field);
		if (!hit) return "";
		const value = hit.value;
		if (typeof value === "string") return value.trim();
		if (Array.isArray(value)) return value.map((entry) => (typeof entry === "string" ? entry : "")).join(" ").trim();
		if (value && typeof value === "object") {
			// An object-valued field still has to yield its prose half.
			const nested = value as Record<string, unknown>;
			for (const key of ["text", "expertanswer", "answer", "value", "body", "content"]) {
				const inner = nested[key] ?? nested[Object.keys(nested).find((candidate) => normalizeKey(candidate) === key) ?? ""];
				if (typeof inner === "string" && inner.trim()) return inner.trim();
			}
		}
		return "";
	};

	const question = readText("question");
	const expertAnswer = readText("expertAnswer");
	if (!question && !expertAnswer) {
		coercions.push(`dropped item[${index}]: no question and no answer text`);
		return undefined;
	}
	if (!question) {
		coercions.push(`dropped item[${index}]: no question text in any recognized field`);
		return undefined;
	}
	if (!expertAnswer) {
		coercions.push(`dropped item[${index}]: no answer text in any recognized field`);
		return undefined;
	}

	// --- evidence ids (resolved before the category, which may need to be inferred from them) --
	const candidates: string[] = [];
	const evidenceField = fields.get("evidenceIds");
	if (evidenceField) candidates.push(...evidenceCandidates(evidenceField.value));
	for (const text of [question, expertAnswer, readText("nonExpertAnswer")]) candidates.push(...inlineEvidenceIds(text));
	// Extra id-bearing fields nobody enumerated (e.g. `supporting_refs`): accepted only when the
	// value actually looks like ids, so prose that mentions evidence cannot add noise.
	const claimedKeys = new Set([...fields.values()].map((hit) => normalizeKey(hit.key)));
	for (const [key, [originalKey, value]] of record.entries()) {
		if (claimedKeys.has(key)) continue;
		const { stems, exclude } = FIELD_STEMS.evidenceIds;
		if (exclude.some((blocked) => key.includes(blocked))) continue;
		if (!stems.some((stem) => key.includes(stem))) continue;
		if (!looksLikeIdList(value)) continue;
		coercions.push(`item[${index}]: collected evidence ids from extra field "${originalKey}"`);
		candidates.push(...evidenceCandidates(value));
	}
	const resolved: string[] = [];
	const dropped: string[] = [];
	for (const candidate of candidates) {
		const id = canonicalEvidenceId(candidate, known);
		if (!id) { dropped.push(candidate); continue; }
		if (!resolved.includes(id)) resolved.push(id);
	}
	if (dropped.length > 0) coercions.push(`item[${index}]: dropped ${dropped.length} evidence id${dropped.length === 1 ? "" : "s"} not present in this run (${dropped.slice(0, 2).map((value) => value.slice(0, 20)).join(", ")}${dropped.length > 2 ? ", …" : ""})`);
	if (resolved.length === 0) {
		coercions.push(`dropped item[${index}]: cites no evidence that exists in this run`);
		return undefined;
	}
	const kinds = resolved.map((id) => known.get(id)!.kind);

	// --- category: declared, or inferred from the evidence it actually cites -------------------
	const rawCategory = fields.get("category")?.value;
	let category: DefenseItem["category"] | undefined;
	let declared = false;
	if (typeof rawCategory === "string") {
		const mapped = CATEGORY_ALIASES[normalizeKey(rawCategory)];
		if (mapped) {
			category = mapped;
			declared = true;
			if (mapped !== rawCategory) coercions.push(`item[${index}]: normalized category "${rawCategory}" -> "${mapped}"`);
		}
	}
	if (!category) {
		const inferred = inferCategoryFromKinds(kinds);
		if (inferred) {
			category = inferred;
			coercions.push(`item[${index}]: inferred category "${inferred}" from its evidence kinds (declared "${typeof rawCategory === "string" ? rawCategory : "(missing)"}" was unrecognized)`);
		} else {
			coercions.push(`dropped item[${index}]: unrecognized category "${typeof rawCategory === "string" ? rawCategory : "(missing)"}" and it cannot be inferred unambiguously from its evidence kinds (required coverage: ${DEFENSE_REQUIRED_CATEGORIES.join(", ")})`);
			return undefined;
		}
	}

	// --- category / evidence-kind compatibility ----------------------------------------------
	// Only a DECLARED category is checked: re-labelling the model's own assertion to make the
	// check pass would misrepresent what it claimed. An inferred category is compatible by
	// construction.
	if (declared) {
		const allowed = DEFENSE_CATEGORY_KINDS[category];
		if (allowed && !kinds.some((kind) => allowed.has(kind))) {
			coercions.push(`dropped item[${index}]: "${category}" item cites only ${[...new Set(kinds)].join("/")} evidence (allowed: ${[...allowed].join(", ")})`);
			return undefined;
		}
	}

	// --- citation marker ----------------------------------------------------------------------
	let answer = expertAnswer;
	if (!answer.includes("[evidence:")) {
		answer = `${answer} ${resolved.map((id) => `[evidence:${id}]`).join(" ")}`.trim();
		coercions.push(`item[${index}]: appended [evidence:…] marker from the item's own evidenceIds`);
	}

	// --- non-expert answer --------------------------------------------------------------------
	let nonExpertAnswer = readText("nonExpertAnswer");
	if (!nonExpertAnswer) {
		nonExpertAnswer = `${answer.split(/[.;]/)[0]}.`;
		coercions.push(`item[${index}]: derived nonExpertAnswer from expertAnswer`);
	} else if (!nonExpertAnswer.includes("[evidence:")) {
		nonExpertAnswer = `${nonExpertAnswer.replace(/[.\s]+$/, "")}. ${resolved.map((id) => `[evidence:${id}]`).join(" ")}`.trim();
	}

	// --- claim ids ----------------------------------------------------------------------------
	let claimIds = asStringList(fields.get("claimIds")?.value);
	if (knownClaims.size > 0) claimIds = claimIds.filter((id) => knownClaims.has(id));

	// --- id -----------------------------------------------------------------------------------
	const rawId = fields.get("id")?.value;
	const id = typeof rawId === "string" && rawId.trim() ? rawId.trim() : `defense-${String(index + 1).padStart(2, "0")}`;
	if (typeof rawId !== "string" || !rawId.trim()) coercions.push(`item[${index}]: assigned id "${id}"`);

	return { id, category, question, expertAnswer: answer, nonExpertAnswer, claimIds, evidenceIds: resolved };
}

/** The single category whose allowed evidence kinds cover ALL of this item's kinds, or undefined
 * when the evidence is ambiguous. Used only when the model declared no usable category — it is a
 * labelling fallback, never a way to rescue an item whose declared category contradicts its
 * evidence. */
function inferCategoryFromKinds(kinds: readonly EvidenceRef["kind"][]): DefenseItem["category"] | undefined {
	const unique = [...new Set(kinds)];
	const candidates = (Object.keys(DEFENSE_CATEGORY_KINDS) as DefenseItem["category"][]).filter((category) => {
		const allowed = DEFENSE_CATEGORY_KINDS[category];
		return allowed && unique.every((kind) => allowed.has(kind));
	});
	return candidates.length === 1 ? candidates[0] : undefined;
}

/** Only markers that are explicitly evidence, never arbitrary prose tokens. */
function inlineEvidenceIds(text: string): string[] {
	const found: string[] = [];
	for (const match of text.matchAll(/\[evidence:\s*([^\]]+)\]/g)) if (match[1]) found.push(match[1].trim());
	for (const match of text.matchAll(/\b(?:sha256:)?[0-9a-fA-F]{64}\b/g)) found.push(match[0]);
	return found;
}

// ---------------------------------------------------------------------------------------------
// Report / presentation normalization
// ---------------------------------------------------------------------------------------------

const REPORT_SECTIONS = ["Scientific Question and Value", "Hypotheses and Falsification", "Data Provenance and Quality", "Methods and Tool Chain", "Uncertainty and Sensitivity", "Reproducibility", "Evidence Index"];

const STOPWORDS = new Set(["and", "of", "the", "to", "in", "for", "on", "a", "an", "with", "by"]);

function titleTokens(value: string): Set<string> {
	return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word && !STOPWORDS.has(word) && !/^\d+$/.test(word)));
}

function titleSimilarity(a: string, b: string): number {
	const left = titleTokens(a);
	const right = titleTokens(b);
	if (left.size === 0 || right.size === 0) return 0;
	let hits = 0;
	for (const token of left) if (right.has(token)) hits += 1;
	return hits / Math.min(left.size, right.size);
}

/** Repair a report whose mandated section headings are spelled differently but recognizably
 * (e.g. "## 2. Scientific Question & Value"). Matching headings are rewritten in place; nothing is
 * inserted, so no section is ever fabricated. */
export function normalizeReportDraft(content: string): TextNormalization {
	const coercions: string[] = [];
	const issues: string[] = [];
	const lines = content.split(/\r?\n/);
	const headingIndexes: number[] = [];
	for (const [index, line] of lines.entries()) if (/^#{1,6}\s+\S/.test(line)) headingIndexes.push(index);
	const claimed = new Set<number>();
	const missing: string[] = [];

	for (const section of REPORT_SECTIONS) {
		if (content.includes(section)) continue;
		let best: { index: number; score: number } | undefined;
		for (const index of headingIndexes) {
			if (claimed.has(index)) continue;
			const text = lines[index]!.replace(/^#{1,6}\s+/, "");
			const score = titleSimilarity(text, section);
			if (score >= 0.6 && (!best || score > best.score)) best = { index, score };
		}
		if (!best) { missing.push(section); continue; }
		claimed.add(best.index);
		const original = lines[best.index]!;
		const hashes = /^(#{1,6})/.exec(original)?.[1] ?? "##";
		const numbering = /^\s*(?:\d+\.|[IVX]+\))\s*/i.exec(original.replace(/^#{1,6}\s+/, ""))?.[0]?.trim();
		lines[best.index] = `${hashes} ${numbering ? `${numbering} ` : ""}${section}`;
		coercions.push(`report: canonicalized heading "${original.replace(/^#{1,6}\s+/, "").trim()}" -> "${section}"`);
	}
	const markdown = lines.join(content.includes("\r\n") ? "\r\n" : "\n");
	for (const section of missing) issues.push(`missing section: ${section}`);
	if ((markdown.match(/\[evidence:/g) ?? []).length < 3) issues.push("fewer than 3 evidence citations");
	return { markdown, coercions, issues };
}

// Slide markers are matched with or without leading hashes. A line with neither a heading marker
// nor a `:`/`-`/`—` separator after the number is left alone, so prose such as "slide 2 shows the
// fit improves" is never mistaken for a marker.
const SLIDE_HEADING = /^\s*(#{1,6})?\s*slide\s*(\d+)\s*([—–:-])?\s*(.*)$/i;
const SLIDE_BOLD = /^\s*\*\*\s*slide\s*(\d+)\s*(?:[—–:-]\s*)?(.*?)\s*\*\*\s*(.*)$/i;

/** Repair a presentation deck: canonicalize slide markers (`## Slide 3: Title` -> `# Slide 3 — Title`),
 * rebuild decks written as `---`-separated sections, renumber, and drop empty slides. Bodies are
 * never rewritten or invented. */
export function normalizePresentationDraft(content: string): TextNormalization {
	const coercions: string[] = [];
	const issues: string[] = [];
	let lines = content.split(/\r?\n/);
	let found = 0;
	let rewritten = 0;
	for (const [index, line] of lines.entries()) {
		const hashed = SLIDE_HEADING.exec(line);
		// Require a heading marker or an explicit separator; otherwise this is body prose.
		if (hashed && (hashed[1] || hashed[3]) && line.trim().length <= 160) {
			found += 1;
			const canonical = `# Slide ${hashed[2]}${hashed[4]?.trim() ? ` — ${hashed[4].trim()}` : ""}`;
			if (line.trim() !== canonical) { lines[index] = canonical; rewritten += 1; }
			continue;
		}
		const bold = SLIDE_BOLD.exec(line);
		if (bold) {
			found += 1;
			const tail = bold[3]?.trim();
			const canonical = `# Slide ${bold[1]}${bold[2]?.trim() ? ` — ${bold[2].trim()}` : tail ? ` — ${tail}` : ""}`;
			lines[index] = canonical;
			rewritten += 1;
		}
	}
	if (found === 0) {
		// Deck written as separator-delimited sections: adopt `---` boundaries when they already
		// form eight sections, so the model is not forced to re-emit the same text in another shape.
		const chunks = content.split(/^\s*-{3,}\s*$/m).map((chunk) => chunk.trim()).filter(Boolean);
		if (chunks.length === 8) {
			const repaired: string[] = [];
			for (const [index, chunk] of chunks.entries()) {
				const heading = chunk.split(/\r?\n/)[0]!.replace(/^#{1,6}\s*/, "").trim();
				const body = chunk.split(/\r?\n/).slice(1).join("\n").trim();
				repaired.push(`# Slide ${index + 1}${heading ? ` — ${heading}` : ""}\n\n${body}`);
			}
			coercions.push("presentation: rebuilt 8 slides from '---'-separated sections");
			lines = repaired.join("\n\n---\n\n").split("\n");
		}
	} else if (rewritten > 0) {
		coercions.push(`presentation: canonicalized ${rewritten} slide marker${rewritten === 1 ? "" : "s"} to "# Slide N — Title"`);
	}

	// Parse canonical slides, drop empty bodies, renumber 1..N.
	const text = lines.join(content.includes("\r\n") ? "\r\n" : "\n");
	const slides: { title: string; body: string }[] = [];
	for (const line of text.split(/\r?\n/)) {
		const hit = /^#\s*Slide\s*\d+\s*(?:[—–:-]\s*)?(.*)$/.exec(line);
		if (hit) { slides.push({ title: (hit[1] ?? "").trim(), body: "" }); continue; }
		if (slides.length > 0) slides[slides.length - 1]!.body += `${line}\n`;
	}
	const nonEmpty = slides.filter((slide) => slide.body.replace(/[-*\s]/g, "").length > 0);
	const dropped = slides.length - nonEmpty.length;
	if (dropped > 0) coercions.push(`presentation: dropped ${dropped} slide${dropped === 1 ? "" : "s"} with an empty body`);
	let markdown = text;
	if (nonEmpty.length > 0) {
		const rebuilt = nonEmpty.map((slide, index) => `# Slide ${index + 1}${slide.title ? ` — ${slide.title}` : ""}\n\n${slide.body.trim()}`).join("\n\n---\n\n");
		if (rebuilt !== text) markdown = `${rebuilt}\n`;
	}
	const count = (markdown.match(/^# Slide /gm) ?? []).length;
	if (count !== 8) issues.push(`must contain exactly 8 slides, found ${count}`);
	return { markdown, coercions, issues };
}
