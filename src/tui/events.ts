/**
 * GeoRSI event bus: typed events flowing from the RSI loop to any viewer
 * (TUI today, future RPC/watch). The loop keeps its headless `log` behavior
 * unchanged; emitting is additive.
 *
 * Also hosts the pure logic the TUI needs: the RunSnapshot reducer (aggregates
 * header state from events) and input-line command parsing — both unit-tested
 * in selftest without a terminal.
 */
import { EventEmitter } from "node:events";

export type RsiEvent =
	| { type: "run_start"; runName: string; generations: number; problems: string[]; inner: string; outer: string }
	| { type: "generation_start"; generation: number; total: number; best: number | null; tokens: number }
	| { type: "goal_verdict"; generation: number; onTrack: boolean; source: string; steer: string }
	| { type: "phase"; phase: string; detail?: string }
	| {
			type: "proposal";
			generation: number;
			angle: string;
			mechanism: string;
			expected: string;
			quality: number | null;
			survived: boolean;
	  }
	| { type: "critique_done"; generation: number; survivors: number; total: number; qualities: number[] }
	| { type: "episode_start"; tag: string; problem: string; role: string; generation: number }
	| { type: "episode_turn"; tag: string; turn: number; maxTurns: number; note: string }
	| { type: "episode_submitted"; tag: string; publicScore: number | null; best: number | null; submits: number; cap: number }
	| { type: "episode_end"; tag: string; problem: string; fitness: number | null; publicScore: number | null; secs: number; error: string | null }
	| { type: "suite_done"; mean: number | null; perProblem: { problem: string; fitness: number | null }[] }
	| { type: "verify"; first: number | null; second: number | null; avg: number | null; champion: number | null }
	| { type: "champion_change"; generation: number; from: number | null; to: number; mechanism: string }
	| { type: "champion_keep"; generation: number; best: number | null; stagnation: number; limit: number }
	| { type: "heldout_start"; problems: string[] }
	| { type: "heldout_done"; mean: number | null; results: { problem: string; fitness: number | null }[] }
	| { type: "budget_stop"; tokens: number }
	| { type: "run_end"; best: number | null; tokens: number; reason: string }
	| { type: "feedback_added"; text: string }
	| { type: "paused" }
	| { type: "resumed" }
	| { type: "stop_requested"; reason: string }
	| { type: "error"; where: string; message: string };

export class RsiEventBus extends EventEmitter {
	emitEvent(ev: RsiEvent): void {
		this.emit("event", ev);
	}
}

// ---------------------------------------------------------------------------
// RunSnapshot: reducer aggregating header state from the event stream
// ---------------------------------------------------------------------------

export interface ProblemScore {
	problem: string;
	fitness: number | null;
	updatedGen: number;
}

export interface RunSnapshot {
	runName: string;
	generation: number;
	totalGenerations: number;
	best: number | null;
	stagnation: number;
	stagnationLimit: number;
	tokens: number;
	phase: string;
	phaseDetail: string;
	paused: boolean;
	stopRequested: boolean;
	problems: ProblemScore[];
	heldoutMean: number | null;
	runEnded: boolean;
	endReason: string;
	startedAt: number;
	/** active episode tags -> latest state */
	episodes: Map<string, { problem: string; turn: number; submits: number; publicBest: number | null; done: boolean }>;
}

export function initialSnapshot(): RunSnapshot {
	return {
		runName: "",
		generation: 0,
		totalGenerations: 0,
		best: null,
		stagnation: 0,
		stagnationLimit: 3,
		tokens: 0,
		phase: "starting",
		phaseDetail: "",
		paused: false,
		stopRequested: false,
		problems: [],
		heldoutMean: null,
		runEnded: false,
		endReason: "",
		startedAt: Date.now(),
		episodes: new Map(),
	};
}

export function applyEvent(s: RunSnapshot, ev: RsiEvent): RunSnapshot {
	const n: RunSnapshot = {
		...s,
		problems: s.problems.map((p) => ({ ...p })),
		episodes: new Map(s.episodes),
	};
	switch (ev.type) {
		case "run_start":
			n.runName = ev.runName;
			n.totalGenerations = ev.generations;
			n.problems = ev.problems.map((p) => ({ problem: p, fitness: null, updatedGen: 0 }));
			n.phase = "baseline";
			break;
		case "generation_start":
			n.generation = ev.generation;
			n.best = ev.best ?? n.best;
			n.tokens = ev.tokens;
			n.phase = `generation ${ev.generation}`;
			break;
		case "phase":
			n.phase = ev.phase;
			n.phaseDetail = ev.detail ?? "";
			break;
		case "goal_verdict":
			n.phaseDetail = `goal ${ev.onTrack ? "on-track" : "stalling"} (${ev.source})`;
			break;
		case "episode_start": {
			n.episodes.set(ev.tag, { problem: ev.problem, turn: 0, submits: 0, publicBest: null, done: false });
			n.phaseDetail = `${ev.role}: ${ev.problem}`;
			break;
		}
		case "episode_turn": {
			const e = n.episodes.get(ev.tag);
			if (e) e.turn = ev.turn;
			break;
		}
		case "episode_submitted": {
			const e = n.episodes.get(ev.tag);
			if (e) {
				e.submits = ev.submits;
				e.publicBest = ev.best;
			}
			break;
		}
		case "episode_end": {
			const e = n.episodes.get(ev.tag);
			if (e) e.done = true;
			const p = n.problems.find((x) => x.problem === ev.problem);
			if (p && ev.fitness != null) {
				p.fitness = ev.fitness;
				p.updatedGen = n.generation;
			}
			break;
		}
		case "suite_done":
			for (const r of ev.perProblem) {
				const p = n.problems.find((x) => x.problem === r.problem);
				if (p && r.fitness != null) {
					p.fitness = r.fitness;
					p.updatedGen = n.generation;
				}
			}
			break;
		case "champion_change":
			n.best = ev.to;
			n.stagnation = 0;
			n.phase = `gen ${ev.generation}: new champion`;
			n.phaseDetail = ev.mechanism.slice(0, 80);
			break;
		case "champion_keep":
			n.stagnation = ev.stagnation;
			n.stagnationLimit = ev.limit;
			break;
		case "heldout_start":
			n.phase = "held-out exam";
			break;
		case "heldout_done":
			n.heldoutMean = ev.mean;
			break;
		case "paused":
			n.paused = true;
			break;
		case "resumed":
			n.paused = false;
			break;
		case "stop_requested":
			n.stopRequested = true;
			break;
		case "run_end":
			n.runEnded = true;
			n.endReason = ev.reason;
			n.best = ev.best ?? n.best;
			n.tokens = ev.tokens;
			n.phase = "done";
			break;
		case "budget_stop":
			n.tokens = ev.tokens;
			break;
	}
	return n;
}

// ---------------------------------------------------------------------------
// Input command parsing (pure, unit-tested)
// ---------------------------------------------------------------------------

export type ParsedCommand =
	| { kind: "feedback"; text: string }
	| { kind: "help" }
	| { kind: "pause" }
	| { kind: "resume" }
	| { kind: "stop" }
	| { kind: "status" }
	| { kind: "unknown"; text: string; error: string };

export function parseCommand(line: string): ParsedCommand {
	const t = line.trim();
	if (!t) return { kind: "unknown", text: t, error: "empty" };
	if (!t.startsWith("/")) return { kind: "feedback", text: t };
	const sp = t.indexOf(" ");
	const cmd = (sp === -1 ? t : t.slice(0, sp)).toLowerCase();
	switch (cmd) {
		case "/help":
		case "/?":
			return { kind: "help" };
		case "/pause":
			return { kind: "pause" };
		case "/resume":
			return { kind: "resume" };
		case "/stop":
			return { kind: "stop" };
		case "/status":
			return { kind: "status" };
		case "/feedback": {
			const rest = sp === -1 ? "" : t.slice(sp + 1).trim();
			if (!rest) return { kind: "unknown", text: t, error: "/feedback needs text (or send plain text without the command)" };
			return { kind: "feedback", text: rest };
		}
		default:
			return { kind: "unknown", text: t, error: `unknown command ${cmd} — /help for list` };
	}
}

/** Short human rendering of token counts for the header. */
export function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
	return String(n);
}

export function fmtDur(ms: number): string {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m${String(ss).padStart(2, "0")}s`;
}
