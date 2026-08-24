/**
 * RunController: cooperative pause/stop gate shared by the RSI loop, the TUI,
 * and the pi extension. The loop polls at safe points (between generations,
 * between survivor evaluations, between episode turns); controllers flip flags
 * from input. Headless runs simply construct nothing (undefined controller)
 * and behave exactly as before.
 */
import { existsSync, readFileSync, watchFile, unwatchFile, writeFileSync } from "node:fs";

export interface ControlFileCommand {
	action: "pause" | "resume" | "stop";
	ts?: string;
}

export class RunController {
	private paused = false;
	private pausedWaiters: (() => void)[] = [];
	private stopFlag = false;
	readonly log: (m: string) => void;
	private unwatch: (() => void) | null = null;

	constructor(log: (m: string) => void = () => {}) {
		this.log = log;
	}

	get isPaused(): boolean {
		return this.paused;
	}

	get stopRequested(): boolean {
		return this.stopFlag;
	}

	/**
	 * Watch a control file so OTHER processes (the pi extension chat) can
	 * pause/resume/stop this run: they append a JSON command, we apply it and
	 * clear the file. Missing file is fine — watch is created when it appears.
	 */
	attachControlFile(path: string): void {
		if (this.unwatch) return;
		// fs.watchFile cannot reliably watch a file that never exists — create it
		try {
			if (!existsSync(path)) writeFileSync(path, "");
		} catch {
			/* directory may be unwritable; commands simply won't flow */
		}
		const apply = (): void => {
			let cmd: ControlFileCommand | null = null;
			try {
				const raw = readFileSync(path, "utf8").trim();
				if (!raw) return;
				cmd = JSON.parse(raw) as ControlFileCommand;
			} catch {
				return; // torn/partial write: next event retries
			}
			if (!cmd || !cmd.action) return;
			if (cmd.action === "pause") this.pause();
			else if (cmd.action === "resume") this.resume();
			else if (cmd.action === "stop") this.requestStop("control file");
			try {
				writeFileSync(path, ""); // consume
			} catch {
				/* best effort */
			}
		};
		watchFile(path, { interval: 1000 }, () => apply());
		// catch a command written between attach and the first watch poll
		if (existsSync(path)) apply();
		this.unwatch = () => unwatchFile(path);
	}

	detachControlFile(): void {
		if (this.unwatch) {
			this.unwatch();
			this.unwatch = null;
		}
	}

	pause(): void {
		if (!this.paused) {
			this.paused = true;
			this.log("⏸ paused — the loop halts at the next safe point");
		}
	}

	resume(): void {
		if (this.paused) {
			this.paused = false;
			const ws = this.pausedWaiters;
			this.pausedWaiters = [];
			for (const w of ws) w();
			this.log("▶ resumed");
		}
	}

	togglePause(): void {
		this.paused ? this.resume() : this.pause();
	}

	requestStop(reason: string): void {
		if (!this.stopFlag) {
			this.stopFlag = true;
			this.resume(); // a stopped run must not hang on pause
			this.log(`⏹ stop requested (${reason}) — finishing the current episode, then saving state`);
		}
	}

	/** Await while paused. Called at safe points only, never blocks un-stopably. */
	async waitIfPaused(): Promise<void> {
		while (this.paused && !this.stopFlag) {
			await new Promise<void>((resolve) => this.pausedWaiters.push(resolve));
		}
	}
}
