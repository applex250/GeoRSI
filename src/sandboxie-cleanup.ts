/** Pure fail-closed state machine for Sandboxie cleanup evidence. */
export interface SandboxieCleanupResult {
	terminated: boolean;
	deletedData: boolean;
	removedConfig: boolean;
	reloaded: boolean;
	boxStillEnabled: boolean;
	globalWfpRestored: boolean;
	leaseReleased: boolean;
	errors: string[];
}

export type SandboxieCleanupStage =
	| "terminate"
	| "delete-data"
	| "remove-config"
	| "restore-global-wfp"
	| "reload"
	| "read-back"
	| "release-lease"
	| "complete"
	| "blocked";

export interface SandboxieCleanupState extends SandboxieCleanupResult {
	stage: SandboxieCleanupStage;
	/** A failed enabled-box query must not be confused with an empty box list. */
	boxReadbackVerified: boolean;
}

export type SandboxieCleanupEvent =
	| { type: "termination"; ok: boolean; error?: string }
	| { type: "data-deletion"; ok: boolean; error?: string }
	| { type: "config-removal"; ok: boolean; error?: string }
	| { type: "global-wfp-write"; ok: boolean; error?: string }
	| { type: "reload"; ok: boolean; error?: string }
	| {
		type: "read-back";
		globalWfpRestored: boolean;
		boxReadbackVerified: boolean;
		boxStillEnabled: boolean;
		errors?: readonly string[];
	}
	| { type: "lease-release"; ok: boolean; error?: string };

export function initialSandboxieCleanupState(): SandboxieCleanupState {
	return {
		stage: "terminate",
		terminated: false,
		deletedData: false,
		removedConfig: false,
		reloaded: false,
		boxStillEnabled: true,
		boxReadbackVerified: false,
		globalWfpRestored: false,
		leaseReleased: false,
		errors: [],
	};
}

function withErrors(state: SandboxieCleanupState, errors: readonly (string | undefined)[]): SandboxieCleanupState {
	return { ...state, errors: [...state.errors, ...errors.filter((value): value is string => Boolean(value))] };
}

function expectStage(state: SandboxieCleanupState, expected: SandboxieCleanupStage, event: SandboxieCleanupEvent): void {
	if (state.stage !== expected) {
		throw new Error(`invalid Sandboxie cleanup transition: ${state.stage} -> ${event.type}; expected ${expected}`);
	}
}

export interface SandboxiePartialCleanupEvidence {
	globalWfpSnapshotCaptured: boolean;
	removedConfig: boolean;
	globalWfpWriteSucceeded: boolean;
	reloaded: boolean;
	globalWfpRestored: boolean;
	boxReadbackVerified: boolean;
	boxStillEnabled: boolean;
}

/** A setup failure happens before any boxed process exists, so it has no PID or
 * data-deletion gate. It still must prove exact global restoration and section
 * absence before releasing the process-global lease. */
export function sandboxiePartialCleanupReadyForLease(evidence: SandboxiePartialCleanupEvidence): boolean {
	return evidence.globalWfpSnapshotCaptured && evidence.removedConfig && evidence.globalWfpWriteSucceeded &&
		evidence.reloaded && evidence.globalWfpRestored && evidence.boxReadbackVerified && !evidence.boxStillEnabled;
}

export function sandboxieCleanupReadyForLease(state: SandboxieCleanupState): boolean {
	return state.terminated && state.deletedData && state.removedConfig && state.reloaded &&
		state.boxReadbackVerified && !state.boxStillEnabled && state.globalWfpRestored;
}

export function advanceSandboxieCleanup(
	state: SandboxieCleanupState,
	event: SandboxieCleanupEvent,
): SandboxieCleanupState {
	switch (event.type) {
		case "termination": {
			expectStage(state, "terminate", event);
			const next = withErrors({ ...state, terminated: event.ok, stage: event.ok ? "delete-data" : "blocked" }, [event.error]);
			return next;
		}
		case "data-deletion":
			expectStage(state, "delete-data", event);
			return withErrors({ ...state, deletedData: event.ok, stage: "remove-config" }, [event.error]);
		case "config-removal":
			expectStage(state, "remove-config", event);
			return withErrors({ ...state, removedConfig: event.ok, stage: "restore-global-wfp" }, [event.error]);
		case "global-wfp-write":
			expectStage(state, "restore-global-wfp", event);
			return withErrors({ ...state, globalWfpRestored: event.ok, stage: "reload" }, [event.error]);
		case "reload":
			expectStage(state, "reload", event);
			return withErrors({ ...state, reloaded: event.ok, stage: "read-back" }, [event.error]);
		case "read-back": {
			expectStage(state, "read-back", event);
			const observed: SandboxieCleanupState = withErrors({
				...state,
				globalWfpRestored: state.globalWfpRestored && event.globalWfpRestored,
				boxReadbackVerified: event.boxReadbackVerified,
				// Unverified absence is represented as enabled/unsafe, never as clean.
				boxStillEnabled: !event.boxReadbackVerified || event.boxStillEnabled,
				stage: "blocked",
			}, event.errors ?? []);
			return { ...observed, stage: sandboxieCleanupReadyForLease(observed) ? "release-lease" : "blocked" };
		}
		case "lease-release":
			expectStage(state, "release-lease", event);
			return withErrors({ ...state, leaseReleased: event.ok, stage: event.ok ? "complete" : "blocked" }, [event.error]);
	}
}

/** Root-directory cleanup is diagnostic and happens after lease disposition. */
export function addSandboxieCleanupError(state: SandboxieCleanupState, error: string): SandboxieCleanupState {
	return withErrors(state, [error]);
}

export function sandboxieCleanupResult(state: SandboxieCleanupState): SandboxieCleanupResult {
	return {
		terminated: state.terminated,
		deletedData: state.deletedData,
		removedConfig: state.removedConfig,
		reloaded: state.reloaded,
		boxStillEnabled: state.boxStillEnabled,
		globalWfpRestored: state.globalWfpRestored,
		leaseReleased: state.leaseReleased,
		errors: [...state.errors],
	};
}
