/**
 * Anti-cheat sweep: defense in depth behind the strict Sandboxie boundary.
 *
 * Strict Windows runs prevent repository/private access at the OS application
 * boundary. Explicit host-audit does not, so post-hoc scans remain useful for
 * score integrity there; in strict mode they detect prompt/tool/artifact
 * references and protect against configuration regressions.
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

/**
 * Best-effort source policy for the optional restricted execution mode.
 * This is intentionally narrower than banning `os` or normal file/data APIs:
 * geoscience scripts commonly need those. It catches the common escape hatches
 * (network and arbitrary child-process creation) before launch, but it is not
 * a substitute for an OS sandbox and can be bypassed by obfuscation.
 */
export interface ExecutionPolicyBreach {
	file: string;
	rule: string;
	line: number;
}

const EXECUTION_RULES: { rule: string; pattern: RegExp }[] = [
	{
		rule: "child-process import",
		pattern: /^\s*(?:from\s+subprocess\b|import\s+subprocess\b)|\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\(/,
	},
	{
		rule: "process execution",
		pattern: /\bos\.(?:system|popen|exec[a-z]*|spawn[a-z]*)\s*\(/,
	},
	{
		rule: "network import",
		pattern: /^\s*(?:from\s+(?:socket|urllib|requests|httpx|ftplib|paramiko)\b|import\s+(?:socket|urllib|requests|httpx|ftplib|paramiko)\b)|\b(?:socket|urllib\.request|requests|httpx)\.[a-zA-Z_]+\s*\(/,
	},
	{
		rule: "native extension import",
		pattern: /^\s*(?:from\s+ctypes\b|import\s+ctypes\b)/,
	},
];

export function scanPythonExecutionPolicy(text: string, file = "python"): ExecutionPolicyBreach[] {
	const out: ExecutionPolicyBreach[] = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		for (const { rule, pattern } of EXECUTION_RULES) {
			if (pattern.test(line)) {
				out.push({ file, rule, line: index + 1 });
				break;
			}
		}
	}
	return out;
}


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
// integrity manifest: every private grading dependency must survive the
// episode untouched. Strict file tools are exchange-guarded and Sandboxie
// closes protected roots; the manifest remains defense in depth and is the
// primary fail-closed check in explicit host-audit mode.
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

function directoryFingerprint(dir: string): string {
	if (!existsDirectory(dir)) return "<missing>";
	const files = walkFiles(dir)
		.map((file) => file.slice(dir.length + 1).replace(/\\/g, "/"))
		.sort();
	return createHash("sha256").update(files.join("\n")).digest("hex");
}

/** sha256 of every grading-critical file under the problem dir. The reference
 * directory listing is also committed to the manifest so host-audit cannot
 * add a new hidden reference file without invalidating the episode. */
export function protectedManifest(problemDir: string, extraFiles: readonly string[] = []): Record<string, string> {
	const manifest: Record<string, string> = {};
	const referenceDir = join(problemDir, "reference");
	const wanted = ["eval.py", "answers.private.jsonl"].map((file) => join(problemDir, file));
	for (const file of [...wanted, ...walkFiles(referenceDir), ...extraFiles]) {
		try {
			manifest[file] = createHash("sha256").update(readFileSync(file)).digest("hex");
		} catch {
			/* optional file (quiz problems have no reference/) */
		}
	}
	manifest[`__directory__:${referenceDir}`] = directoryFingerprint(referenceDir);
	return manifest;
}

function existsDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Files whose hash or protected-directory listing changed since the manifest. */
export function verifyManifest(problemDir: string, manifest: Record<string, string>): string[] {
	const bad: string[] = [];
	for (const [f, hash] of Object.entries(manifest)) {
		if (f.startsWith("__directory__:")) {
			const dir = f.slice("__directory__:".length);
			if (!existsDirectory(dir) || directoryFingerprint(dir) !== hash) bad.push(`${dir.slice(problemDir.length + 1)}/<directory-listing>`);
			continue;
		}
		let now: string | null = null;
		try {
			now = createHash("sha256").update(readFileSync(f)).digest("hex");
		} catch {
			now = null;
		}
		if (now !== hash) {
			bad.push(f.startsWith(problemDir) ? f.slice(problemDir.length + 1) : f);
		}
	}
	return bad;
}
