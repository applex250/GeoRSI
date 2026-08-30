/**
 * Run-wide budget accounting. This state is intentionally separate from the
 * provider adapter: model transport reports usage, while application code
 * decides when a run is exhausted.
 */
export interface TokenSnapshot {
	total: number;
	calls: number;
	failed: number;
}

export class TokenLedger {
	private snapshot: TokenSnapshot = { total: 0, calls: 0, failed: 0 };

	get total(): number { return this.snapshot.total; }
	set total(value: number) { this.snapshot.total = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }
	get calls(): number { return this.snapshot.calls; }
	set calls(value: number) { this.snapshot.calls = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }
	get failed(): number { return this.snapshot.failed; }
	set failed(value: number) { this.snapshot.failed = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }

	reset(): void {
		this.snapshot = { total: 0, calls: 0, failed: 0 };
	}

	record(tokens: number, failed = false): void {
		this.total += Math.max(0, tokens);
		this.calls += 1;
		if (failed) this.failed += 1;
	}

	snapshotValue(): TokenSnapshot {
		return { ...this.snapshot };
	}
}

export const TOKENS = new TokenLedger();
