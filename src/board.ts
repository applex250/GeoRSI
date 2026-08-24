/**
 * Board: append-only generation records + derived human-readable reports.
 * The jsonl is the source of truth; the markdown files are always
 * regenerable from it.
 */
import { join } from "node:path";
import { writeTextAtomic } from "./journal.js";
import type { Proposal } from "./outer/improve.js";

export interface EpisodeRecord {
	problem: string;
	fitness: number | null;
	bestPublic: number | null;
	submits: number;
	secs: number;
	error: string | null;
}

export function renderLeaderboard(
	records: { generation: number; role: string; fitness: number | null; mean: number | null; detail: EpisodeRecord[] }[],
): string {
	const lines = ["# Leaderboard", "", "| gen | role | mean fitness | per-problem |", "|---|---|---|---|"];
	for (const r of records) {
		const per = r.detail
			.map((d) => `${d.problem}:${d.fitness != null ? d.fitness.toFixed(3) : "ERR"}`)
			.join(" ");
		lines.push(`| ${r.generation} | ${r.role} | ${r.mean != null ? r.mean.toFixed(4) : "—"} | ${per} |`);
	}
	return lines.join("\n") + "\n";
}

export interface FindingRow {
	generation: number;
	mechanism: string;
	expected: string;
	fitness: number | null;
	accepted: boolean;
}

export function renderFindings(rows: FindingRow[]): string {
	const lines = [
		"# FINDINGS",
		"",
		"Every proposal with its stated mechanism, expectation, and outcome.",
		"",
		"| gen | mechanism | expected | got | verdict |",
		"|---|---|---|---|---|",
	];
	for (const r of rows) {
		lines.push(
			`| ${r.generation} | ${escapeCell(r.mechanism)} | ${escapeCell(r.expected)} | ${
				r.fitness != null ? r.fitness.toFixed(3) : "ERR"
			} | ${r.accepted ? "ACCEPTED" : "rejected"} |`,
		);
	}
	return lines.join("\n") + "\n";
}

function escapeCell(s: string): string {
	return s.replace(/\|/g, "/").replace(/\r?\n/g, " ").slice(0, 160);
}

export function writeReports(
	runDir: string,
	board: Parameters<typeof renderLeaderboard>[0],
	findings: FindingRow[],
): void {
	writeTextAtomic(join(runDir, "leaderboard.md"), renderLeaderboard(board));
	writeTextAtomic(join(runDir, "FINDINGS.md"), renderFindings(findings));
}

export function summarizeProposals(proposals: Proposal[]): string {
	return proposals
		.map((p, i) => `${i + 1}. [${p.angle}] ${p.mechanism} (expect ${p.expectedDelta})`)
		.join("\n");
}
