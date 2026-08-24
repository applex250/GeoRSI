/**
 * Full-pipeline render verification WITHOUT a TTY: run the exact layout used
 * by app.ts (TuiAltScreen + setLayoutRoot + HeaderPanel/ScrollView/Input) on
 * a capture Terminal, feed the sample event stream, force a few frames, and
 * assert the decoded screen contains the expected dashboard content.
 */
import { TuiAltScreen, VStack, ScrollView, Container, Input, stripTerminalSequences } from "@earendil-works/pi-tui";
import { HeaderPanel, HintBar, LogLine, PlainBlock, darkTheme, eventToLogLines, helpText } from "./components.js";
import { applyEvent, initialSnapshot, type RsiEvent } from "./events.js";
import { join } from "node:path";
import { readFileSync } from "node:fs";

class CaptureTerminal {
	written = "";
	cols = 100;
	rowsCount = 30;
	kittyProtocolActive = false;
	start(_onInput: (d: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.written += data;
	}
	get columns(): number {
		return this.cols;
	}
	get rows(): number {
		return this.rowsCount;
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
}

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.error(`  FAIL ${name}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
	}
}

const term = new CaptureTerminal();
const tui = new TuiAltScreen(term as never);

// same layout as app.ts
const snapshot = initialSnapshot();
const header = new HeaderPanel(snapshot, darkTheme, { inner: "ox-alpha-free", outer: "hy3" });
const logBox = new Container();
const input = new Input();
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

// events: synthetic + real journal replay synthesis
const events: RsiEvent[] = [
	{ type: "run_start", runName: "pipetest", generations: 2, problems: ["quake_b", "flood_rp", "climate_trend"], inner: "ox-alpha-free", outer: "hy3" },
	{ type: "generation_start", generation: 1, total: 2, best: 0.7848, tokens: 2_309_277 },
	{ type: "proposal", generation: 1, angle: "domain knowledge", mechanism: "inject canonical estimators", expected: "+0.03", quality: 8, survived: true },
	{ type: "episode_start", tag: "g1-quake_b", problem: "quake_b", role: "g1", generation: 1 },
	{ type: "episode_submitted", tag: "g1-quake_b", publicScore: 0.9, best: 0.9, submits: 1, cap: 6 },
	{ type: "episode_end", tag: "g1-quake_b", problem: "quake_b", fitness: 0.96, publicScore: 0.9, secs: 90, error: null },
	{ type: "champion_change", generation: 1, from: 0.7848, to: 0.8678, mechanism: "Aki MLE + L-moments tips" },
];

let cur = snapshot;
for (const ev of events) {
	cur = applyEvent(cur, ev);
	header.update(cur);
	for (const line of eventToLogLines(ev, darkTheme)) logBox.addChild(new LogLine(line));
}
tui.requestRender(true);
tui.renderNow(true);

const screen = stripTerminalSequences(term.written);
check("alt-screen writes something", term.written.length > 100, `${term.written.length} bytes`);
check("header champion rendered", screen.includes("0.8678"));
check("header gen counter rendered", screen.includes("1/2"));
check("header tokens rendered", screen.includes("2.3M"));
check("header problems rendered", screen.includes("quake_b"));
check("log shows proposal", screen.includes("inject canonical estimators"));
check("log shows champion line", screen.includes("NEW CHAMPION"));
check("hint bar rendered", screen.includes("Ctrl+P"));
check("no raw crash marker", !screen.includes("width"));

// narrow terminal re-render must not throw (pi-tui throws on overlong lines)
term.cols = 60;
tui.requestRender(true);
let threw = false;
try {
	tui.renderNow(true);
} catch (e) {
	threw = true;
	console.error("  narrow render threw:", (e as Error).message.slice(0, 160));
}
check("narrow re-render safe", !threw);
check("narrow output has header", stripTerminalSequences(term.written).includes("GeoRSI"));

// overlay smoke: help overlay through the real overlay machinery
tui.showOverlay(new PlainBlock(helpText(darkTheme)), { anchor: "center", width: "70%" });
tui.renderNow(true);
check("overlay renders", stripTerminalSequences(term.written).includes("Ctrl+C"));

tui.stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
void readFileSync;
void join;
