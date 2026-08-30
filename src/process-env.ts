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
			/^(https?|all|no)_proxy$/i.test(key) ||
			/^(?:PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|NODE_PATH|NODE_OPTIONS)$/i.test(key) ||
			/^(?:SSH_AUTH_SOCK|GIT_ASKPASS|SSH_ASKPASS|DOCKER_AUTH_CONFIG|KUBECONFIG|AWS_SHARED_CREDENTIALS_FILE|AZURE_CONFIG_DIR)$/i.test(key) ||
			/(?:API[_-]?KEY|TOKEN|ACCESS[_-]?(?:KEY|TOKEN)|AUTH[_-]?TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CREDENTIAL)/i.test(key)
		) {
			delete safe[key];
		}
	}
	safe.PYTHONUNBUFFERED = "1";
	safe.PYTHONIOENCODING = "utf-8";
	return safe;
}
