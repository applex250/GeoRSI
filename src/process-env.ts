/**
 * Process-environment policy shared by evaluators and execution adapters.
 *
 * This module has no Sandboxie dependency. It is deliberately a small
 * infrastructure policy seam: callers start from a caller-supplied environment
 * (or the host environment), remove credentials/proxies/path injection, then
 * add back only the narrowly required capability for a trusted evaluator.
 */
export function sanitizeExecutionEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const safe = { ...(env ?? process.env) } as NodeJS.ProcessEnv;
	for (const key of Object.keys(safe)) {
		if (
			/^RSILAB_/i.test(key) ||
			// Proxy URLs routinely embed user:pass@host; the GEORSI_-prefixed variants
			// (documented in .env.example, passed into the API container) slipped past
			// the unprefixed pattern and reached model-authored scripts.
			/^(?:GEORSI_)?(https?|all|no)_proxy$/i.test(key) ||
			/^(?:PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|NODE_PATH|NODE_OPTIONS)$/i.test(key) ||
			/^(?:SSH_AUTH_SOCK|GIT_ASKPASS|SSH_ASKPASS|DOCKER_AUTH_CONFIG|KUBECONFIG|AWS_SHARED_CREDENTIALS_FILE|AZURE_CONFIG_DIR)$/i.test(key) ||
			/(?:API[_-]?KEY|TOKEN|ACCESS[_-]?(?:KEY|TOKEN)|AUTH[_-]?TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CREDENTIAL)/i.test(key)
		) {
			delete safe[key];
		}
	}
	// Malformed environment entries break Sandboxie Start.exe: an empty or
	// "="-prefixed variable name is forwarded as an illegal /env:=VALUE argument
	// and the boxed process is never started (real-machine finding 2026-09-09).
	for (const key of Object.keys(safe)) {
		if (key.length === 0 || key.startsWith("=") || /[\r\n\0]/.test(key)) {
			console.error(`[env] dropped malformed environment entry: ${JSON.stringify(key.slice(0, 40))}=${JSON.stringify(String(safe[key]).slice(0, 40))}`);
			delete safe[key];
		}
	}
	safe.PYTHONUNBUFFERED = "1";
	safe.PYTHONIOENCODING = "utf-8";
	return safe;
}
