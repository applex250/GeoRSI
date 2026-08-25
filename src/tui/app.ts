/**
 * GeoRSI TUI application: fullscreen dashboard (TuiAltScreen) running the RSI
 * loop in-process.
 *
 * Layout (setLayoutRoot, pattern from pi-tui's render-churn benchmark):
 *   VStack
 *     ├─ HeaderPanel          (fixed ~4 lines)
 *     ├─ ScrollView(logBox)   (grow, follow end — scrollable history)
 *     └─ VStack [Input, HintBar]  (fixed)
 *
 * The RSI loop emits events -> RunSnapshot reducer -> HeaderPanel update +
 * colored LogLine appended to the log box. Loop errors are caught and shown
 * as log lines; the TUI itself stays alive (artifacts persist on disk).
 */
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import {
	TuiAltScreen,
	ProcessTerminal,
	VStack,
	ScrollView,
	Container,
	Input,
	matchesKey,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import { ROOT, type Config } from "../config.js";
import {
	RsiEventBus,
	applyEvent,
	initialSnapshot,
	parseCommand,
	type RsiEvent,
	type RunSnapshot,
} from "./events.js";
import { HeaderPanel, HintBar, LogLine, PlainBlock, darkTheme, eventToLogLines, helpText } from "./components.js";
import { RunController } from "../loopctl.js";
import { setBootNotifier } from "../provider.js";

export interface TuiRunOptions {
	cfg: Config;
	runName: string;
	resume: boolean;
	gensOverride?: number;
}

export class GeoTui {
	private readonly bus = new RsiEventBus();
	readonly controller = new RunController();
	private snapshot: RunSnapshot = initialSnapshot();
	private tui!: TuiAltScreen;
	private header!: HeaderPanel;
	private logBox = new Container();
	private input!: Input;
	private helpVisible = false;
	private quitArmedAt = 0;
	private readonly unsubscribeBus: () => void;	private runDir = "";

	constructor(private readonly opts: TuiRunOptions) {
		this.runDir = join(ROOT, "runs", opts.runName);
		const handler = (ev: RsiEvent) => this.onEvent(ev);
		this.bus.on("event", handler);
		this.unsubscribeBus = () => this.bus.off("event", handler);
	}

	get emit(): (ev: RsiEvent) => void {
		return (ev) => this.bus.emitEvent(ev);
	}

	private onEvent(ev: RsiEvent): void {
		this.snapshot = applyEvent(this.snapshot, ev);
		this.header?.update(this.snapshot);
		for (const line of eventToLogLines(ev, darkTheme)) this.addLog(line);
		this.tui?.requestRender();
	}

	private addLog(line: string): void {
		// cap the log so long runs don't grow the component tree unbounded
		if (this.logBox.children.length > 2000) this.logBox.removeChild(this.logBox.children[0]!);
		this.logBox.addChild(new LogLine(line));
	}

	async start(): Promise<void> {
		if (!process.stdout.isTTY) {
			throw new Error(
				"GeoRSI TUI needs an interactive terminal. For headless runs use `npm run rsi` " +
					"(then `npm run tui -- --replay runs/<name>` to view a finished run).",
			);
		}
		const terminal = new ProcessTerminal();
		this.tui = new TuiAltScreen(terminal);

		this.header = new HeaderPanel(this.snapshot, darkTheme, {
			inner: this.opts.cfg.inner_model,
			outer: this.opts.cfg.outer_model,
		});
		this.input = new Input();
		this.input.onSubmit = (v) => this.handleInput(v);

		const logScroll = new ScrollView(this.logBox, { follow: "end", primary: true, scrollbar: "auto" });
		const root = new VStack(
			[
				{ component: this.header, basis: "auto" },
				{ component: logScroll, grow: 1 },
				{
					component: new VStack([this.input, new HintBar(darkTheme)], { gap: 0 }),
					basis: "auto",
				},
			],
			{ gap: 0 },
		);
		this.tui.setLayoutRoot(root);
		this.tui.setFocus(this.input);
		this.tui.start();

		// spinner cadence
		const spinner = setInterval(() => {
			this.header.tick();
			this.tui.requestRender();
		}, 150);

		// global keys (input gets focus; register as a pre-input listener)
		const removeListener = this.tui.addInputListener((data) => {
			if (matchesKey(data, "ctrl+p")) {
				this.controller.togglePause();
				this.emit(this.controller.isPaused ? { type: "paused" } : { type: "resumed" });
				return { consume: true };
			}
			if (matchesKey(data, "ctrl+g")) {
				this.toggleHelp();
				return { consume: true };
			}
			if (matchesKey(data, "ctrl+c")) {
				const now = Date.now();
				if (now - this.quitArmedAt < 2000) {
					this.shutdown("quit");
				} else {
					this.quitArmedAt = now;
					this.addLog(chalk.yellow("Ctrl+C again within 2s to quit (state is saved; /stop stops the loop only)"));
					this.tui.requestRender();
				}
				return { consume: true };
			}
			return undefined;
		});

		this.addLog(chalk.dim(`run dir: ${this.runDir}`));
		this.addLog(chalk.dim("type feedback and press Enter; /help for commands"));

		try {
			const { runRsi } = await import("../rsi.js");
			setBootNotifier((m) => this.addLog(chalk.dim(m)));
			await runRsi({
				cfg: this.opts.cfg,
				runName: this.opts.runName,
				resume: this.opts.resume,
				gensOverride: this.opts.gensOverride,
				// loop's console output goes to the log pane, not raw stdout
				log: (m) => this.addLog(chalk.dim(m.replace(/\n/g, " ").slice(0, 200))),
				emit: this.emit,
				controller: this.controller,
			});
		} catch (e) {
			this.emit({ type: "error", where: "run", message: e instanceof Error ? e.message : String(e) });
			this.addLog(chalk.red(`run crashed: ${e instanceof Error ? e.message : String(e)}`));
			this.addLog(chalk.dim("artifacts persist under the run dir; inspect and restart with --resume"));
		} finally {
			clearInterval(spinner);
			removeListener();
			// keep the TUI alive after run end; user quits explicitly
			this.addLog(chalk.dim("run finished — Ctrl+C twice to exit"));
			this.tui.requestRender();
		}
	}

	private handleInput(line: string): void {
		this.input.setValue("");
		const cmd = parseCommand(line);
		switch (cmd.kind) {
			case "feedback":
				this.appendFeedback(cmd.text);
				break;
			case "help":
				this.toggleHelp();
				break;
			case "pause":
				this.controller.pause();
				this.emit({ type: "paused" });
				break;
			case "resume":
				this.controller.resume();
				this.emit({ type: "resumed" });
				break;
			case "stop":
				this.controller.requestStop("user /stop");
				this.emit({ type: "stop_requested", reason: "user /stop" });
				break;
			case "status": {
				const s = this.snapshot;
				this.addLog(
					chalk.cyan(
						`status: gen ${s.generation}/${s.totalGenerations} best=${s.best?.toFixed(4) ?? "—"} ` +
							`stag=${s.stagnation}/${s.stagnationLimit} tokens=${s.tokens} paused=${s.paused} ` +
							`problems=[${s.problems.map((p) => `${p.problem}:${p.fitness?.toFixed(3) ?? "·"}`).join(" ")}]`,
					),
				);
				this.tui.requestRender();
				break;
			}
			case "unknown":
				if (cmd.error !== "empty") {
					this.addLog(chalk.red(cmd.error));
					this.tui.requestRender();
				}
				break;
		}
	}

	private appendFeedback(text: string): void {
		mkdirSync(this.runDir, { recursive: true });
		const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
		appendFileSync(join(this.runDir, "FEEDBACK.md"), `\n[TUI ${stamp}] ${text}\n`);
		this.emit({ type: "feedback_added", text });
	}

	private toggleHelp(): void {
		if (this.helpVisible) {
			this.tui.hideOverlay();
			this.helpVisible = false;
		} else {
			const lines = helpText(darkTheme);
			this.tui.showOverlay(new PlainBlock(lines), { anchor: "center", width: "70%" });
			this.helpVisible = true;
		}
		this.tui.requestRender();
	}

	shutdown(reason: string): void {
		this.controller.requestStop(reason);
		this.unsubscribeBus();
		this.tui.stop();
		process.exit(0);
	}
}
