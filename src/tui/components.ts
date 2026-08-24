/**
 * GeoRSI TUI components. Each implements the pi-tui Component contract
 * (`render(width): string[]`); render() is a pure function of snapshot state,
 * which lets the headless render test (tuitest) drive them without a TTY.
 * Every line is passed through truncateToWidth — pi-tui throws on overlong
 * lines.
 */
import chalk from "chalk";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { fmtDur, fmtTokens, type RsiEvent, type RunSnapshot } from "./events.js";

export interface GeoTheme {
	title: (s: string) => string;
	key: (s: string) => string;
	value: (s: string) => string;
	dim: (s: string) => string;
	good: (s: string) => string;
	bad: (s: string) => string;
	warn: (s: string) => string;
	accent: (s: string) => string;
	sep: string;
}

export const darkTheme: GeoTheme = {
	title: chalk.bold.cyan,
	key: chalk.bold,
	value: chalk.white,
	dim: chalk.gray,
	good: chalk.bold.green,
	bad: chalk.red,
	warn: chalk.yellow,
	accent: chalk.magenta,
	sep: chalk.gray(" │ "),
};

/** Turn an RSI event into 1-2 colored log lines (pure). */
export function eventToLogLines(ev: RsiEvent, t: GeoTheme): string[] {
	switch (ev.type) {
		case "run_start":
			return [
				t.title(`▶ run ${ev.runName}`) + t.dim(` | inner=${ev.inner} outer=${ev.outer} | ${ev.problems.length} problems, ${ev.generations} generations`),
			];
		case "generation_start":
			return [t.accent(`━━ generation ${ev.generation}/${ev.total}`) + t.dim(` best=${ev.best?.toFixed(4) ?? "—"} tokens=${fmtTokens(ev.tokens)}`)];
		case "goal_verdict":
			return [
				`  ${ev.onTrack ? t.good("goal on-track") : t.warn("goal stalling")} ${t.dim(`(${ev.source})`)}${ev.steer ? t.dim(` steer: ${ev.steer.slice(0, 100)}`) : ""}`,
			];
		case "phase":
			return [`${t.dim("·")} ${ev.phase}${ev.detail ? t.dim(` — ${ev.detail}`) : ""}`];
		case "proposal":
			return [
				`  ${ev.survived ? t.good("✓") : t.dim("✗")} [${ev.angle}] ${ev.mechanism.slice(0, 100)}` +
					t.dim(` (q=${ev.quality?.toFixed(1) ?? "?"}, expect ${ev.expected})`),
			];
		case "critique_done":
			return [`  ${t.key("critique")} qualities=[${ev.qualities.map((q) => q.toFixed(1)).join(",")}] -> ${ev.survivors}/${ev.total} survive`];
		case "episode_start":
			return [`  ${t.accent("▶")} ${t.key(ev.tag)}`];
		case "episode_turn":
			return [t.dim(`    turn ${ev.turn}/${ev.maxTurns} ${ev.note.slice(0, 60)}`)];
		case "episode_submitted":
			return [
				ev.publicScore == null
					? `    ${t.bad("INVALID submission")}`
					: `    submit #${ev.submits}/${ev.cap} → public ${t.value(ev.publicScore.toFixed(4))} (best ${ev.best?.toFixed(4) ?? "—"})`,
			];
		case "episode_end":
			return [
				ev.fitness != null
					? `  ${t.key(ev.tag)} done ${t.value(`fitness ${ev.fitness.toFixed(4)}`)} ${t.dim(`${ev.secs}s${ev.error ? ` (${ev.error.slice(0, 60)})` : ""}`)}`
					: `  ${t.key(ev.tag)} ${t.bad("FAILED")} ${t.dim(ev.error?.slice(0, 80) ?? "")}`,
			];
		case "suite_done":
			return [`  suite mean ${ev.mean != null ? t.value(ev.mean.toFixed(4)) : t.bad("ERR")} ${t.dim(ev.perProblem.map((p) => `${p.problem}:${p.fitness?.toFixed(2) ?? "×"}`).join(" "))}`];
		case "verify":
			return [`  ${t.warn("verify")} first=${ev.first?.toFixed(4) ?? "ERR"} second=${ev.second?.toFixed(4) ?? "ERR"} avg=${ev.avg?.toFixed(4) ?? "—"} (champion ${ev.champion?.toFixed(4) ?? "—"})`];
		case "champion_change":
			return [t.good(`  ★ NEW CHAMPION ${ev.from?.toFixed(4) ?? "—"} → ${ev.to.toFixed(4)}`) + t.dim(` — ${ev.mechanism.slice(0, 90)}`)];
		case "champion_keep":
			return [`  champion keeps ${ev.best?.toFixed(4) ?? "—"} ${t.warn(`stagnation ${ev.stagnation}/${ev.limit}`)}`];
		case "heldout_start":
			return [t.title("◈ held-out exam") + t.dim(` (${ev.problems.join(", ")})`)];
		case "heldout_done":
			return [
				t.title("◈ held-out result") +
					` mean=${ev.mean != null ? t.value(ev.mean.toFixed(4)) : t.bad("ERR")} ` +
					t.dim(ev.results.map((r) => `${r.problem}:${r.fitness?.toFixed(3) ?? "×"}`).join(" ")),
			];
		case "budget_stop":
			return [t.bad(`token budget exhausted (${fmtTokens(ev.tokens)})`)];
		case "run_end":
			return [t.title(`■ run ended (${ev.reason})`) + ` best=${ev.best?.toFixed(4) ?? "—"} tokens=${fmtTokens(ev.tokens)}`];
		case "feedback_added":
			return [`  ${t.warn("feedback")} ${ev.text.slice(0, 110)}`];
		case "paused":
			return [t.warn("⏸ paused — /resume or Ctrl+P to continue")];
		case "resumed":
			return [`▶ ${t.good("resumed")}`];
		case "stop_requested":
			return [t.warn(`⏹ stop requested (${ev.reason}) — finishing current episode`)];
		case "error":
			return [t.bad(`error in ${ev.where}: ${ev.message.slice(0, 120)}`)];
	}
}

export class LogLine implements Component {
	constructor(private text: string) {}
	render(width: number): string[] {
		return [truncateToWidth(this.text, width)];
	}
	invalidate(): void {
		/* static text */
	}
}

/** Fixed dashboard header: title / stats / per-problem scores / phase. */
export class HeaderPanel implements Component {
	private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private spinIdx = 0;
	private lastRender = 0;

	constructor(
		private snapshot: RunSnapshot,
		private theme: GeoTheme,
		private models: { inner: string; outer: string } = { inner: "?", outer: "?" },
	) {}

	update(s: RunSnapshot): void {
		this.snapshot = s;
	}

	tick(): void {
		this.spinIdx = (this.spinIdx + 1) % this.spinnerFrames.length;
	}

	render(width: number): string[] {
		const t = this.theme;
		const s = this.snapshot;
		const now = Date.now();
		if (now - this.lastRender > 120) this.tick(); // gentle spinner cadence
		this.lastRender = now;

		const l1 =
			t.title("GeoRSI") +
			t.dim(` ${s.runName || "(starting)"} · ${fmtDur(now - s.startedAt)}`) +
			t.sep +
			t.dim(`inner ${this.models.inner} / outer ${this.models.outer}`);

		const state =
			s.runEnded
				? t.dim(`ended (${s.endReason})`)
				: s.paused
					? t.warn("⏸ PAUSED")
					: s.stopRequested
						? t.warn("⏹ stopping…")
						: t.good("running");
		const l2 =
			`${t.key("gen")} ${t.value(`${s.generation}/${s.totalGenerations || "?"}`)}${t.sep}` +
			`${t.key("champion")} ${s.best != null ? t.good(s.best.toFixed(4)) : t.dim("—")}${t.sep}` +
			`${t.key("stag")} ${t.value(`${s.stagnation}/${s.stagnationLimit}`)}${t.sep}` +
			`${t.key("tokens")} ${t.value(fmtTokens(s.tokens))}${t.sep}` +
			`${t.key("heldout")} ${s.heldoutMean != null ? t.value(s.heldoutMean.toFixed(4)) : t.dim("—")}${t.sep}` +
			state;

		const scores = s.problems.map((p) => `${p.problem} ${p.fitness != null ? t.value(p.fitness.toFixed(3)) : t.dim("·")}`);
		const l3 = scores.length ? `${t.key("suite")} ${scores.join(t.sep)}` : t.dim("suite: (starting)");

		const spin = s.runEnded || s.paused ? " " : t.accent(this.spinnerFrames[this.spinIdx]!);
		const l4 = `${spin} ${t.key(s.phase)}${s.phaseDetail ? t.dim(` — ${s.phaseDetail}`) : ""}`;

		return [l1, l2, l3, l4].map((l) => truncateToWidth(l, width));
	}

	invalidate(): void {
		/* stateless render */
	}
}

/** Bottom hint bar with key bindings. */
export class HintBar implements Component {
	constructor(private theme: GeoTheme) {}
	render(width: number): string[] {
		const t = this.theme;
		return [
			truncateToWidth(
				`${t.key("Ctrl+P")} pause ${t.dim("·")} ${t.key("Ctrl+G")} help ${t.dim("·")} ${t.key("Ctrl+C ×2")} quit ${t.dim("·")} ` +
					`input: ${t.key("text")}=feedback ${t.dim("|")} /help /pause /resume /stop /status`,
				width,
			),
		];
	}
	invalidate(): void {
		/* static */
	}
}

/** Help overlay content (Box-style, plain lines). */
export function helpText(t: GeoTheme): string[] {
	return [
		t.title("GeoRSI TUI — keys & commands"),
		"",
		`${t.key("Ctrl+P")}        pause / resume the evolution loop`,
		`${t.key("Ctrl+G")}        toggle this help`,
		`${t.key("Ctrl+C ×2")}     quit (twice within 2s)`,
		"",
		`${t.key("<text> + Enter")}  append feedback to runs/<name>/FEEDBACK.md`,
		`              (read by the next generation's proposals)`,
		`${t.key("/pause")}         pause at the next safe point`,
		`${t.key("/resume")}        continue a paused run`,
		`${t.key("/stop")}          graceful stop after current episode (resumable)`,
		`${t.key("/status")}        print current snapshot to the log`,
		`${t.key("/help")}          this help`,
		"",
		t.dim("All artifacts persist under runs/<name>/ — quitting never loses state."),
		t.dim("Restart a stopped run with: npm run tui -- --resume --run-name <name>"),
	];
}

/** Simple bordered block for overlays (help, confirmations). */
export class PlainBlock implements Component {
	constructor(private lines: string[]) {}
	render(width: number): string[] {
		const inner = Math.max(4, width - 4);
		const border = "─".repeat(Math.max(0, width - 2));
		const out = [`┌${border}┐`];
		for (const l of this.lines) {
			const p = plainLen(l) > inner ? truncateToWidth(l, inner) : l;
			out.push(`│ ${p}${" ".repeat(Math.max(0, inner - plainLen(p)))} │`);
		}
		out.push(`└${border}┘`);
		return out.map((l) => chalk.gray(l));
	}
	invalidate(): void {
		/* static */
	}
}

function plainLen(s: string): number {
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
