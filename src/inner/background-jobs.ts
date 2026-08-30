/** Background-job lifecycle state machine with injected I/O/process ports. */
export type BackgroundJobState = "running" | "done" | "failed" | "timeout" | "killed";

export interface BackgroundJob {
	name: string;
	file: string;
	pid: number | undefined;
	startedAt: number;
	state: BackgroundJobState;
	exitCode: number | null;
	killVerified?: boolean;
	sandboxTargetPids?: number[];
	wrapperPath?: string;
}

export interface BackgroundJobPort {
	now(): number;
	writeStatus(job: BackgroundJob): void;
	readLogTail(name: string): string;
	isAlive(pid: number): boolean;
	terminate(pid: number): void;
}

export function backgroundJobPids(job: BackgroundJob): number[] {
	return [...new Set([job.pid, ...(job.sandboxTargetPids ?? [])].filter((pid): pid is number => pid != null && pid > 0))];
}

export class BackgroundJobRegistry {
	private readonly jobs = new Map<string, BackgroundJob>();

	constructor(private readonly port: BackgroundJobPort, private readonly timeoutMs: number) {}

	has(name: string): boolean { return this.jobs.has(name); }
	get(name: string): BackgroundJob | undefined { return this.jobs.get(name); }
	values(): BackgroundJob[] { return [...this.jobs.values()]; }

	set(name: string, job: BackgroundJob): this {
		if (name !== job.name) throw new Error(`background job key/name mismatch: ${name} != ${job.name}`);
		this.register(job);
		return this;
	}

	register(job: BackgroundJob): void {
		if (this.jobs.has(job.name)) throw new Error(`background job already exists: ${job.name}`);
		this.jobs.set(job.name, job);
		this.port.writeStatus(job);
	}

	refresh(job: BackgroundJob): BackgroundJob {
		if (job.state !== "running") return job;
		// Workspace status files are evidence only: an agent-controlled Python
		// process can write them, so process events/liveness remain authoritative.
		if (job.pid != null && !this.port.isAlive(job.pid)) {
			job.state = "done";
			job.exitCode = null;
			this.port.writeStatus(job);
			return job;
		}
		if (this.port.now() - job.startedAt > this.timeoutMs) this.kill(job, "timeout");
		return job;
	}

	running(): BackgroundJob[] {
		return this.values().filter((job) => this.refresh(job).state === "running");
	}

	kill(job: BackgroundJob, requestedState: "killed" | "timeout" = "killed"): number[] {
		// Never signal a terminal job: its numeric PID may already have been
		// reused by the OS after the recorded process exited.
		if (job.state !== "running") return [];
		const pids = backgroundJobPids(job);
		for (const pid of pids) this.port.terminate(pid);
		const stillAlive = pids.filter((pid) => this.port.isAlive(pid));
		job.killVerified = stillAlive.length === 0;
		job.state = job.killVerified ? requestedState : "failed";
		this.port.writeStatus(job);
		return stillAlive;
	}

	recordProcessError(job: BackgroundJob): void {
		job.exitCode = null;
		if (job.state === "running") job.state = "failed";
		this.port.writeStatus(job);
	}

	recordProcessExit(job: BackgroundJob, code: number | null): void {
		job.exitCode = code;
		if (job.state === "running") job.state = code === 0 ? "done" : "failed";
		this.port.writeStatus(job);
	}

	statusText(): string {
		const list = this.values().map((job) => this.refresh(job));
		if (list.length === 0) return "no jobs started";
		return list.map((job) => {
			const mins = Math.round((this.port.now() - job.startedAt) / 60_000);
			const tail = this.port.readLogTail(job.name);
			return `[${job.name}] ${job.state}${job.exitCode != null ? ` (exit ${job.exitCode})` : ""}${job.killVerified === false ? " (kill unverified)" : ""} — ${mins}m — ${job.file}\n  log: jobs/${job.name}.log\n  tail: ${tail || "(empty)"}`;
		}).join("\n");
	}
}
