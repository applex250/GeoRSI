/**
 * Anti-cheat sweep: the honest backstop of the no-sandbox protocol.
 *
 * run_python gives the agent full filesystem access, so "hidden" gold files
 * inside the repo tree (quiz answers.private.jsonl, gbx/gab reference/,
 * judge_cache.jsonl) are reachable by a reward-hacking agent that guesses
 * the layout. We cannot prevent reads without a real sandbox — so we detect
 * them instead: after every episode, scan what the agent wrote/executed for
 * references to protected paths. A hit marks the episode compromised
 * (fitness -> null), which also keeps poisoned results out of knowledge
 * stats and champion selection.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PROTECTED_PATTERNS = [
	"answers.private",
	"reference.json",
	"reference/solution.py",
	"reference/workflow",
	"judge_cache",
	"rsi-lab-private",
	"RSILAB_JUDGE_KEY",
	// NOTE: grader-tamper detection intentionally NOT a string pattern here -
	// agents name their own helper scripts "*eval.py" (false positives), and
	// the protectedManifest sha256 check catches actual tampering exactly.
] as const;

const SCAN_EXTS = new Set([".py", ".txt", ".json", ".md", ".log", ".sh", ".cmd"]);
const MAX_FILE_BYTES = 2_000_000;

export interface GuardBreach {
	file: string;
	pattern: string;
}

export function scanWorkspaceForBreaches(workspace: string): GuardBreach[] {
	const breaches: GuardBreach[] = [];
	const walk = (dir: string, rel: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const e of entries) {
			if (e === "data" || e === "node_modules") continue; // copied inputs, not agent-written
			const abs = join(dir, e);
			const relPath = rel ? `${rel}/${e}` : e;
			let st;
			try {
				st = statSync(abs);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				walk(abs, relPath);
				continue;
			}
			if (!SCAN_EXTS.has(e.slice(e.lastIndexOf(".")).toLowerCase())) continue;
			if (st.size > MAX_FILE_BYTES) continue;
			let text: string;
			try {
				text = readFileSync(abs, "utf8");
			} catch {
				continue;
			}
			for (const pat of PROTECTED_PATTERNS) {
				if (text.includes(pat)) {
					breaches.push({ file: relPath, pattern: pat });
					break;
				}
			}
		}
	};
	walk(workspace, "");
	return breaches;
}

/** Scan free text (e.g. the tool-call arg log) with the same patterns. */
export function scanTextForBreaches(text: string, label = "tool-call"): GuardBreach[] {
	const out: GuardBreach[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		for (const pat of PROTECTED_PATTERNS) {
			if (line.includes(pat)) {
				out.push({ file: label, pattern: pat });
				break;
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// integrity manifest: everything private grading depends on must survive the
// episode untouched. The built-in write tool accepts absolute paths, so
// eval.py / hidden references are writable by the agent — hash them at
// episode start and verify before trusting any fitness.
// ---------------------------------------------------------------------------

function walkFiles(dir: string): string[] {
	const out: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const e of entries) {
		const abs = join(dir, e);
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		if (st.isDirectory()) out.push(...walkFiles(abs));
		else out.push(abs);
	}
	return out;
}

/** sha256 of every grading-critical file under the problem dir. */
export function protectedManifest(problemDir: string): Record<string, string> {
	const manifest: Record<string, string> = {};
	const wanted = ["eval.py", "answers.private.jsonl"].map((f) => join(problemDir, f));
	for (const f of [...wanted, ...walkFiles(join(problemDir, "reference"))]) {
		try {
			manifest[f] = createHash("sha256").update(readFileSync(f)).digest("hex");
		} catch {
			/* optional file (quiz problems have no reference/) */
		}
	}
	return manifest;
}

/** Files whose hash changed or that went missing since the manifest. */
export function verifyManifest(problemDir: string, manifest: Record<string, string>): string[] {
	const bad: string[] = [];
	for (const [f, hash] of Object.entries(manifest)) {
		let now: string | null = null;
		try {
			now = createHash("sha256").update(readFileSync(f)).digest("hex");
		} catch {
			now = null;
		}
		if (now !== hash) bad.push(f.slice(problemDir.length + 1));
	}
	return bad;
}
