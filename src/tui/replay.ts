/**
 * Replay mode: render a finished (or in-flight) run's journal through the
 * same dashboard, zero LLM cost. Parses board.jsonl + state.json and
 * synthesizes the same event stream the live loop emits, paced by a small
 * delay so the log reads naturally.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TuiAltScreen, ProcessTerminal, VStack, ScrollView, Container, Input, matchesKey } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { HeaderPanel, HintBar, LogLine, darkTheme, eventToLogLines } from "./components.js";
import { applyEvent, initialSnapshot, type RsiEvent, type RunSnapshot } from "./events.js";

interface JournalRow {
	kind: string;
	ts: string;
	generation: number;
	[key: string]: unknown;
}

/** Convert journal rows to the live event stream (pure — unit-tested). */
export function journalToEvents(rows: JournalRow[]): RsiEvent[] {
	const out: RsiEvent[] = [];
	let gens = 0;
	for (const r of rows) gens = Math.max(gens, r.generation ?? 0);
	let runStarted = false;
	let lastRoleDetail: { role: string; generation: number; mean: number | null }[] = [];
	for (const r of rows) {
		if (!runStarted) {
			out.push({ type: "run_start", runName: "replay", generations: gens, problems: [], inner: "?", outer: "?" });
			runStarted = true;
		}
		switch (r.kind) {
			case "episode": {
				const role = String(r.role ?? "");
				const detail = (r.detail as { problem: string; fitness: number | null }[]) ?? [];
				if (role === "champion-baseline") {
					out.push({ type: "phase", phase: "baseline suite" });
					for (const d of detail) {
						out.push({ type: "episode_start", tag: `g0-${d.problem}`, problem: d.problem, role: "g0", generation: 0 });
						out.push({ type: "episode_end", tag: `g0-${d.problem}`, problem: d.problem, fitness: d.fitness, publicScore: null, secs: 0, error: null });
					}
					out.push({ type: "suite_done", mean: (r.fitness as number | null) ?? null, perProblem: detail.map((d) => ({ problem: d.problem, fitness: d.fitness })) });
				} else {
					const mech = typeof r.mechanism === "string" ? r.mechanism : "";
					if (role === "challenger") {
						out.push({ type: "phase", phase: `gen ${r.generation}: eval`, detail: mech.slice(0, 90) });
					} else if (role === "verification") {
						out.push({ type: "phase", phase: `gen ${r.generation}: adversarial verify` });
					}
					for (const d of detail) {
						const tag = `${role}-${d.problem}`;
						out.push({ type: "episode_start", tag, problem: d.problem, role, generation: r.generation ?? 0 });
						out.push({ type: "episode_end", tag, problem: d.problem, fitness: d.fitness, publicScore: null, secs: 0, error: null });
					}
					out.push({ type: "suite_done", mean: (r.fitness as number | null) ?? null, perProblem: detail.map((d) => ({ problem: d.problem, fitness: d.fitness })) });
					lastRoleDetail.push({ role, generation: r.generation ?? 0, mean: (r.fitness as number | null) ?? null });
				}
				break;
			}
			case "proposal":
				out.push({
					type: "proposal",
					generation: r.generation ?? 0,
					angle: String(r.angle ?? "?"),
					mechanism: String(r.mechanism ?? ""),
					expected: String(r.expected_delta ?? "?"),
					quality: (r.quality as number | null) ?? null,
					survived: r.survived === true,
				});
				break;
			case "goal":
				out.push({
					type: "goal_verdict",
					generation: r.generation ?? 0,
					onTrack: r.onTrack === true,
					source: String(r.source ?? "?"),
					steer: String(r.steer ?? ""),
				});
				break;
			case "accept":
				out.push({
					type: "champion_change",
					generation: r.generation ?? 0,
					from: null,
					to: (r.fitness as number) ?? 0,
					mechanism: String(r.mechanism ?? ""),
				});
				break;
			case "note":
				if (typeof r.text === "string" && r.text.startsWith("held-out exam:")) {
					out.push({ type: "heldout_start", problems: [] });
					const m = /heldout=([\d.]+|—)/.exec(r.text);
					const mean = m && m[1] !== "—" ? Number(m[1]) : null;
					out.push({ type: "heldout_done", mean, results: [] });
				}
				break;
		}
	}
	out.push({ type: "run_end", best: null, tokens: 0, reason: "replay complete" });
	return out;
}

export async function runReplay(runDir: string, speedMs = 350): Promise<void> {
	if (!process.stdout.isTTY) {
		throw new Error(`replay needs an interactive terminal (got runDir: ${runDir})`);
	}
	const boardPath = join(runDir, "board.jsonl");
	if (!existsSync(boardPath)) throw new Error(`no board.jsonl under ${runDir}`);
	const rows: JournalRow[] = [];
	for (const line of readFileSync(boardPath, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			rows.push(JSON.parse(line) as JournalRow);
		} catch {
			/* torn tail tolerated */
		}
	}
	const statePath = join(runDir, "state.json");
	const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as { name?: string }) : {};

	const events = journalToEvents(rows);

	const terminal = new ProcessTerminal();
	const tui = new TuiAltScreen(terminal);
	const snapshot: RunSnapshot = initialSnapshot();
	snapshot.runName = `${state.name ?? "replay"} (replay)`;
	const header = new HeaderPanel(snapshot, darkTheme, { inner: "—", outer: "—" });
	const logBox = new Container();
	const input = new Input();
	input.onSubmit = () => {};
	const root = new VStack(
		[
			{ component: header, basis: "auto" },
			{ component: new ScrollView(logBox, { follow: "end", primary: true }), grow: 1 },
			{ component: new VStack([input, new HintBar(darkTheme)], { gap: 0 }), basis: "auto" },
		],
		{ gap: 0 },
	);
	tui.setLayoutRoot(root);
	tui.setFocus(input);
	tui.start();
	let cur = snapshot;
	let ctrlCArmedAt = 0;
	const removeInput = tui.addInputListener((data) => {
		// plain 'q' must stay typeable in the input box; only ctrl+c quits
		if (matchesKey(data, "ctrl+c")) {
			if (Date.now() - ctrlCArmedAt < 2000) {
				tui.stop();
				process.exit(0);
			}
			ctrlCArmedAt = Date.now();
			logBox.addChild(new LogLine(chalk.yellow("Ctrl+C again within 2s to exit replay")));
			tui.requestRender();
			return { consume: true };
		}
		return undefined;
	});

	const spinner = setInterval(() => {
		header.tick();
		tui.requestRender();
	}, 150);

	logBox.addChild(new LogLine(chalk.dim(`replaying ${rows.length} journal rows from ${runDir} …`)));
	for (const ev of events) {
		cur = applyEvent(cur, { ...ev, type: ev.type } as RsiEvent);
		header.update(cur);
		for (const line of eventToLogLines(ev, darkTheme)) {
			logBox.addChild(new LogLine(line));
		}
		tui.requestRender();
		await new Promise((r) => setTimeout(r, speedMs));
	}
	clearInterval(spinner);
	removeInput();
	logBox.addChild(new LogLine(chalk.bold("REPLAY COMPLETE — Ctrl+C twice to exit")));
	tui.requestRender();
}
