/** Strict-isolation preflight and in-box probe source. */
import { existsSync, statSync } from "node:fs";
import { request as httpsRequest } from "node:https";

/** Prove the host network is reachable before treating an in-box failure as a
 * network deny. An unavailable host network is never classified as isolation. */
export async function hostNetworkReachable(timeoutMs = 5_000, attempts = 3): Promise<boolean> {
	for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
		const reachable = await new Promise<boolean>((resolveReachable) => {
			let settled = false;
			const finish = (value: boolean): void => {
				if (settled) return;
				settled = true;
				resolveReachable(value);
			};
			const request = httpsRequest("https://example.com", { method: "GET", agent: false, headers: { connection: "close" } }, (response) => {
				response.resume();
				finish((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 400);
			});
			request.setTimeout(timeoutMs, () => {
				request.destroy();
				finish(false);
			});
			request.on("error", () => finish(false));
			request.end();
		});
		if (reachable) return true;
		if (attempt + 1 < Math.max(1, attempts)) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
	}
	return false;
}

export function sandboxProbeSource(
	repoFile: string,
	privateRoot: string,
	resultPath: string,
	networkExpected = true,
	additionalProtectedPaths: readonly string[] = [],
): string {
	const encode = (value: string): string => Buffer.from(value, "utf8").toString("base64");
	const repoExists = existsSync(repoFile);
	const privateExists = existsSync(privateRoot);
	const additional = additionalProtectedPaths.map((path) => ({ encoded: encode(path), directory: existsSync(path) && statSync(path).isDirectory() }));
	const additionalLiteral = `[${additional.map((item) => `[${JSON.stringify(item.encoded)}, ${item.directory ? "True" : "False"}]`).join(", ")}]`;
	return [
		"import base64, json, os, urllib.error, urllib.request",
		`REPO_FILE = base64.b64decode(${JSON.stringify(encode(repoFile))}).decode('utf-8')`,
		`PRIVATE_ROOT = base64.b64decode(${JSON.stringify(encode(privateRoot))}).decode('utf-8')`,
		`RESULT = base64.b64decode(${JSON.stringify(encode(resultPath))}).decode('utf-8')`,
		`REPO_EXPECTED = ${repoExists ? "True" : "False"}`,
		`PRIVATE_EXPECTED = ${privateExists ? "True" : "False"}`,
		`NETWORK_EXPECTED = ${networkExpected ? "True" : "False"}`,
		`ADDITIONAL = ${additionalLiteral}`,
		"def detail(error):",
		"    code = getattr(error, 'winerror', None)",
		"    return f'{type(error).__name__}' + (f' winerror={code}' if code is not None else '')",
		"def probe(fn, expected_exists=False, network=False):",
		"    try:",
		"        fn()",
		"        return ('ACCESS', 'operation succeeded')",
		"    except PermissionError as error:",
		"        return ('BLOCKED', detail(error))",
		"    except FileNotFoundError as error:",
		"        return ('BLOCKED', detail(error)) if expected_exists else ('ERROR', detail(error))",
		"    except urllib.error.URLError as error:",
		"        reason = getattr(error, 'reason', error)",
		"        text = detail(error).lower()",
		"        code = getattr(reason, 'winerror', None)",
		"        if network and NETWORK_EXPECTED and code in (5, 10013, 10061):",
		"            return ('BLOCKED', detail(error))",
		"        if network and NETWORK_EXPECTED and ('forbidden' in text or 'access is denied' in text or 'permission denied' in text or 'connection refused' in text):",
		"            return ('BLOCKED', detail(error))",
		"        return ('ERROR', detail(error))",
		"    except OSError as error:",
		"        code = getattr(error, 'winerror', None)",
		"        text = detail(error).lower()",
		"        if code in (5, 10013) or getattr(error, 'errno', None) in (1, 13):",
		"            return ('BLOCKED', detail(error))",
		"        if network and NETWORK_EXPECTED and code in (10061,):",
		"            return ('BLOCKED', detail(error))",
		"        if network and NETWORK_EXPECTED and ('forbidden' in text or 'access is denied' in text or 'permission denied' in text or 'connection refused' in text):",
		"            return ('BLOCKED', detail(error))",
		"        return ('ERROR', detail(error))",
		"    except Exception as error:",
		"        return ('ERROR', detail(error))",
		"out = {}",
		"repo_status, repo_detail = probe(lambda: open(REPO_FILE, 'rb').read(32), REPO_EXPECTED)",
		"private_status, private_detail = probe(lambda: os.listdir(PRIVATE_ROOT), PRIVATE_EXPECTED)",
		"def network_probe():",
		"    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))",
		"    with opener.open('https://example.com', timeout=5) as response:",
		"        response.read(1)",
		"network_status, network_detail = probe(network_probe, network=True)",
		"out['repo_file'] = repo_status",
		"out['repo_file_detail'] = repo_detail",
		"out['private_dir'] = private_status",
		"out['private_dir_detail'] = private_detail",
		"out['network'] = network_status",
		"out['network_detail'] = network_detail",
		"out['additional_protected'] = []",
		"for encoded_path, is_directory in ADDITIONAL:",
		"    protected_path = base64.b64decode(encoded_path).decode('utf-8')",
		"    action = (lambda p=protected_path: os.listdir(p)) if is_directory else (lambda p=protected_path: open(p, 'rb').read(1))",
		"    status, protected_detail = probe(action, True)",
		"    out['additional_protected'].append({'status': status, 'detail': protected_detail})",
		"out['errors'] = [f'{key}: {value}' for key, value in (('repo_file', repo_detail), ('private_dir', private_detail), ('network', network_detail)) if {'repo_file': repo_status, 'private_dir': private_status, 'network': network_status}[key] == 'ERROR']",
		"out['errors'].extend([f'additional_{index}: {item[\"detail\"]}' for index, item in enumerate(out['additional_protected']) if item['status'] == 'ERROR'])",
		"with open(RESULT, 'w', encoding='utf-8') as handle:",
		"    json.dump(out, handle, sort_keys=True)",
		"print(json.dumps(out, sort_keys=True))",
	].join("\n");
}
