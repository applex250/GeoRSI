/**
 * Deterministic retrieval over the RAG corpus (docs/RAG.md).
 * Region-routed keyword scoring; no embeddings by design in v0.1.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";

export interface DocBlock {
	id: string;
	region: string;
	source: string;
	license?: string;
	derived?: boolean;
	text: string;
}

let _docs: DocBlock[] | null = null;

function corpusRoot(): string {
	return process.env.RSILAB_RAG_CORPUS || join(ROOT, "rag", "corpus");
}

/** Load all corpus docs + their manifest metadata. Missing corpus = empty. */
export function loadCorpus(): DocBlock[] {
	if (_docs) return _docs;
	const root = corpusRoot();
	const out: DocBlock[] = [];
	const manPath = join(root, "manifest.json");
	const manifest: Record<string, { region?: string; source?: string; license?: string; derived?: boolean }> =
		existsSync(manPath) ? JSON.parse(readFileSync(manPath, "utf8")) : {};
	if (existsSync(root)) {
		for (const dir of readdirSync(root)) {
			const dpath = join(root, dir);
			let files: string[] = [];
			try {
				files = readdirSync(dpath);
			} catch {
				continue; // not a directory
			}
			for (const f of files) {
				if (!f.endsWith(".md")) continue;
				const id = `${dir}/${f.replace(/\.md$/, "")}`;
				const meta = manifest[id] ?? {};
				out.push({
					id,
					region: meta.region ?? dir,
					source: meta.source ?? "unknown",
					license: meta.license,
					derived: meta.derived,
					text: readFileSync(join(dpath, f), "utf8"),
				});
			}
		}
	}
	_docs = out;
	return out;
}

/**
 * Score = region match x keyword hits. Region must intersect doc.region-tag
 * (doc dirs act as single-region tags). Returns up to budgetChars worth.
 */
export function retrieve(
	regions: string[],
	queryTerms: string[],
	budgetChars = 2400,
): DocBlock[] {
	const terms = queryTerms.map((t) => t.toLowerCase()).filter((t) => t.length > 2);
	const scored = loadCorpus()
		.map((d) => {
			const low = d.text.toLowerCase();
			let s = regions.includes(d.region) ? 1 : 0;
			for (const t of terms) if (low.includes(t)) s += 1;
			return { d, s };
		})
		.filter((x) => x.s > 0 && regions.includes(x.d.region))
		.sort((a, b) => b.s - a.s || a.d.id.localeCompare(b.d.id));
	const picked: DocBlock[] = [];
	let used = 0;
	for (const { d } of scored) {
		if (used + d.text.length > budgetChars) {
			if (picked.length === 0) continue;
			break;
		}
		picked.push(d);
		used += d.text.length;
	}
	return picked;
}

export function corpusVersion(): string {
	const canon = loadCorpus()
		.map((doc) => JSON.stringify([doc.id, doc.region, doc.source, doc.license ?? null, doc.derived ?? false, doc.text]))
		.sort()
		.join("\n");
	return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

export function renderRetrieved(docs: DocBlock[]): string {
	if (docs.length === 0) return "";
	const lines = docs.map((d) => `- [${d.id}] ${d.text}`);
	return "\n\nReference material retrieved for this task:\n" + lines.join("\n");
}


/** Map task metadata to authored corpus regions. No benchmark text/gold is used. */
export function regionsForTask(genre: string | undefined, problemId: string): string[] {
	const g = (genre ?? "").toLowerCase();
	const regions = new Set<string>();
	if (g.includes("stepgame") || g.includes("spatial")) regions.add("spatial_reasoning");
	if (g.includes("mapqa") || g.includes("projection") || g.includes("mgq")) regions.add("map_projection");
	if (g.includes("gab") || g.includes("geoanalyst") || g.includes("gabench") || g.includes("geobench") || g.includes("geona")) {
		regions.add("gis_tooling");
	}
	if (g.includes("quiz") || problemId.startsWith("earthse_") || problemId.startsWith("k2_")) {
		regions.add("geoscience_formulas");
	}
	return [...regions];
}

/** Extract stable, low-noise terms for deterministic keyword retrieval. */
export function queryTermsFromStatement(statement: string): string[] {
	const seen = new Set<string>();
	for (const word of statement.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
		if (!seen.has(word)) seen.add(word);
		if (seen.size >= 40) break;
	}
	return [...seen];
}
