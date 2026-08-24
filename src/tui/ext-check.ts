/**
 * Headless verification of the /research extension flow:
 *  1. scaffold a temp research dir (exactly what /research start does)
 *  2. validate catches the unfilled template, then passes once filled
 *  3. fill a minimal REAL numeric problem (small dataset, truth=42)
 *  4. run the actual engine subprocess (exam --problem-dir) with a REAL LLM
 *     episode and report fitness
 * No TTY needed — this exercises everything except pi's own chat UI.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldResearch, validateResearch } from "../../extensions/georsi.js";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

const work = mkdtempSync(join(tmpdir(), "georsi-ext-"));
const dir = join(work, "research");

console.log("== scaffold ==");
const created = scaffoldResearch(dir);
check("scaffold creates the 5 template files", created.length === 5, JSON.stringify(created));
check("eval template has ##SCORE##", readFileSync(join(dir, "eval.py"), "utf8").includes("##SCORE##"));
check("scaffold is idempotent", scaffoldResearch(dir).length === 0);

console.log("== validator ==");
const v0 = validateResearch(dir);
check("unfilled template rejected", !v0.ok && v0.errors.some((e: string) => e.includes("template")));
check("placeholder truth warned", v0.warnings.some((w: string) => w.includes("private_truth")));
check("empty data warned", v0.warnings.some((w: string) => w.includes("data/")));

// fill a minimal real problem: mean of a tiny dataset, truth known
writeFileSync(
	join(dir, "statement.md"),
	[
		"# Mean magnitude estimate",
		"",
		"## Data",
		"- `data/mags.csv` — 200 seismic magnitudes (column: magnitude)",
		"",
		"## Task",
		"1. Load data/mags.csv",
		"2. Compute the arithmetic mean of the magnitude column",
		`3. Submit JSON {"answer": <mean>} via the submit tool`,
		"",
		"## Grading",
		"score = max(0, 1 - |answer - truth| / (0.25*truth))",
		"",
	].join("\n"),
);
mkdirSync(join(dir, "data"), { recursive: true });
const vals: number[] = [];
let seed = 7;
for (let i = 0; i < 200; i++) {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	vals.push(1 + (seed % 100) / 50);
}
writeFileSync(join(dir, "data", "mags.csv"), "magnitude\n" + vals.map((v) => v.toFixed(3)).join("\n") + "\n");
const trueMean = vals.reduce((a, b) => a + b, 0) / vals.length;
writeFileSync(join(dir, "private_truth.txt"), `${trueMean.toFixed(6)}\n`);
writeFileSync(join(dir, "reference_truth.txt"), `${trueMean.toFixed(6)}\n`);

const v1 = validateResearch(dir);
check("filled problem validates", v1.ok, v1.errors.join("; "));

console.log("== engine subprocess (REAL episode) ==");
const { runEngine } = await import("../../extensions/georsi.js");
const t0 = Date.now();
const res = await runEngine(["exam", "--problem-dir", dir, "--run-name", "ext-check"], (l: string) => {
	if (/RESEARCH RESULT|research\]|turn |submit|^TEXT\||^TOOL/.test(l)) console.log("  |", l.slice(0, 110));
});
const final = res.tail.find((l) => l.includes("RESEARCH RESULT")) ?? "";
console.log("  exit:", res.code, `(${Math.round((Date.now() - t0) / 1000)}s)`);
check("engine exits 0", res.code === 0);
check("RESEARCH RESULT line present", final.includes("RESEARCH RESULT"), final.slice(0, 120));
const textLines = res.tail.filter((l) => l.startsWith("TEXT|")).length;
const toolLines = res.tail.filter((l) => l.startsWith("TOOLC|")).length;
check("live protocol streamed (TEXT| or TOOLC|)", textLines + toolLines > 0, `${textLines} text, ${toolLines} tool lines`);
const m = /fitness=([\d.]+)/.exec(final);
check("fitness is high (mean task is easy)", m != null && Number(m[1]) > 0.85, final);

rmSync(work, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
