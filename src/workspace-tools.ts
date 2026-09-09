/**
 * Pi built-in file tools with a hard exchange-workspace boundary.
 *
 * The normal pi factories accept pluggable filesystem operations. We use that
 * hook instead of trusting the model to keep absolute paths inside cwd. The
 * wrappers reject lexical traversal and symlink/junction resolution outside
 * the exchange root before delegating to the official tool implementation.
 */
import { access, lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { constants, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import {
	createEditToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type EditOperations,
	type GrepOperations,
	type LsOperations,
	type ReadOperations,
	type ToolDefinition,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";

function lexicalInside(root: string, candidate: string): boolean {
	const r0 = resolve(root);
	const c0 = resolve(candidate);
	const r = process.platform === "win32" ? r0.toLowerCase() : r0;
	const c = process.platform === "win32" ? c0.toLowerCase() : c0;
	return c === r || c.startsWith(r + sep);
}

async function realExistingPath(path: string): Promise<string> {
	return realpath(path);
}

async function assertNoReparseComponents(root: string, absolutePath: string, allowMissingTail: boolean): Promise<void> {
	const rootPath = resolve(root);
	const candidate = resolve(absolutePath);
	if (!lexicalInside(rootPath, candidate)) throw new Error(`path escapes exchange workspace: ${absolutePath}`);
	const rel = relative(rootPath, candidate);
	const components = rel && rel !== "." ? rel.split(/[\\/]+/).filter(Boolean) : [];
	let current = rootPath;
	for (const component of components) {
		current = resolve(current, component);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink()) throw new Error(`reparse/symlink components are forbidden in exchange paths: ${absolutePath}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissingTail) return;
			throw error;
		}
	}
}

async function assertExistingInside(root: string, absolutePath: string): Promise<void> {
	await assertNoReparseComponents(root, absolutePath, false);
	let actual: string;
	try {
		actual = await realExistingPath(absolutePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`path does not resolve inside exchange workspace: ${absolutePath}`);
		}
		throw error;
	}
	if (!lexicalInside(root, actual)) throw new Error(`resolved path escapes exchange workspace: ${absolutePath}`);
}

async function assertNewInside(root: string, absolutePath: string): Promise<void> {
	await assertNoReparseComponents(root, absolutePath, true);
	if (!lexicalInside(root, absolutePath)) throw new Error(`path escapes exchange workspace: ${absolutePath}`);
	let current = resolve(absolutePath);
	for (;;) {
		let exists = false;
		try {
			await lstat(current);
			exists = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (exists) {
			let actual: string;
			try {
				actual = await realExistingPath(current);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					throw new Error(`dangling symlink or junction in exchange path: ${absolutePath}`);
				}
				throw error;
			}
			if (!lexicalInside(root, actual)) throw new Error(`resolved path escapes exchange workspace: ${absolutePath}`);
			return;
		}
		const parent = dirname(current);
		if (parent === current) throw new Error(`cannot find an existing parent inside exchange workspace: ${absolutePath}`);
		current = parent;
	}
}

function guard(root: string, absolutePath: string): Promise<void> {
	return assertExistingInside(root, absolutePath);
}

/**
 * Host-side no-follow read of a sandbox-produced file.
 *
 * Refuses lexical traversal, symlink/reparse components, non-regular files,
 * oversized files, and any realpath that resolves outside the workspace root.
 * This is the only sanctioned way to read result/stdout/stderr files that a
 * boxed agent process could have influenced.
 */
export function readWorkspaceFileStrict(root: string, absolutePath: string, maxBytes = 64 * 1024 * 1024): Buffer {
	const rootPath = resolve(root);
	const candidate = resolve(absolutePath);
	if (!lexicalInside(rootPath, candidate)) throw new Error(`workspace read rejected: path escapes workspace: ${absolutePath}`);
	const rel = relative(rootPath, candidate);
	const components = rel && rel !== "." ? rel.split(/[\\/]+/).filter(Boolean) : [];
	let current = rootPath;
	for (const component of components) {
		current = resolve(current, component);
		const info = lstatSync(current, { throwIfNoEntry: false });
		if (!info) throw new Error(`workspace read rejected: missing path component: ${absolutePath}`);
		if (info.isSymbolicLink()) throw new Error(`workspace read rejected: symlink/reparse component: ${absolutePath}`);
	}
	const info = lstatSync(candidate, { throwIfNoEntry: false });
	if (!info) throw new Error(`workspace read rejected: missing file: ${absolutePath}`);
	if (info.isSymbolicLink() || !info.isFile()) throw new Error(`workspace read rejected: not a regular file: ${absolutePath}`);
	if (info.size > maxBytes) throw new Error(`workspace read rejected: file exceeds ${maxBytes} bytes: ${absolutePath}`);
	let actual: string;
	try {
		actual = realpathSync.native(candidate);
	} catch (error) {
		throw new Error(`workspace read rejected: cannot canonicalize: ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!lexicalInside(rootPath, actual)) throw new Error(`workspace read rejected: resolved path escapes workspace: ${absolutePath}`);
	const content = readFileSync(candidate);
	if (content.byteLength !== info.size) throw new Error(`workspace read rejected: size changed during read: ${absolutePath}`);
	return content;
}

/** Return official pi tool definitions whose operations are exchange-guarded. */
export function createExchangeToolDefinitions(
	cwd: string,
	beforeOperation?: () => void | Promise<void>,
): ToolDefinition<any, any>[] {
	const root = resolve(cwd);
	const before = async (): Promise<void> => {
		await beforeOperation?.();
	};
	const readOps: ReadOperations = {
		readFile: async (path) => {
			await before();
			await guard(root, path);
			return readFile(path);
		},
		access: async (path) => {
			await before();
			await guard(root, path);
			await access(path, constants.R_OK);
		},
	};
	const writeOps: WriteOperations = {
		writeFile: async (path, content) => {
			await before();
			await assertNewInside(root, path);
			await writeFile(path, content, "utf8");
		},
		mkdir: async (path) => {
			await before();
			await assertNewInside(root, path);
			await mkdir(path, { recursive: true });
		},
	};
	const editOps: EditOperations = {
		readFile: async (path) => {
			await before();
			await guard(root, path);
			return readFile(path);
		},
		writeFile: async (path, content) => {
			await before();
			await assertNewInside(root, path);
			await writeFile(path, content, "utf8");
		},
		access: async (path) => {
			await before();
			await guard(root, path);
			await access(path, constants.R_OK | constants.W_OK);
		},
	};
	const lsOps: LsOperations = {
		exists: async (path) => {
			await before();
			if (!lexicalInside(root, path)) return false;
			try {
				await guard(root, path);
				return true;
			} catch {
				return false;
			}
		},
		stat: async (path) => {
			await before();
			await guard(root, path);
			return stat(path);
		},
		readdir: async (path) => {
			await before();
			await guard(root, path);
			return readdir(path).then((entries) => entries.map(String));
		},
	};
	const grepOps: GrepOperations = {
		isDirectory: async (path) => {
			await before();
			await guard(root, path);
			return (await stat(path)).isDirectory();
		},
		readFile: async (path) => {
			await before();
			await guard(root, path);
			return readFile(path, "utf8");
		},
	};
	return [
		createReadToolDefinition(root, { operations: readOps }),
		createWriteToolDefinition(root, { operations: writeOps }),
		createEditToolDefinition(root, { operations: editOps }),
		createLsToolDefinition(root, { operations: lsOps }),
		createGrepToolDefinition(root, { operations: grepOps }),
	];
}

/** Useful for tests and for checking path guards without constructing a pi session. */
export function isExchangePath(cwd: string, candidate: string): boolean {
	return lexicalInside(resolve(cwd), resolve(candidate));
}

/** Ensure a caller did not accidentally pass a repository path as exchange. */
export function assertExchangeWorkspace(
	cwd: string,
	repoRoot: string,
	privateRoot: string,
	additionalProtectedRoots: readonly string[] = [],
): void {
	const workspace = resolve(cwd);
	let actual = workspace;
	try {
		actual = realpathSync.native(workspace);
	} catch {
		/* the caller may invoke this before mkdir; lexical checks still apply */
	}
	const protectedRoots = [
		["repository", repoRoot],
		["private", privateRoot],
		...additionalProtectedRoots.map((path, index) => [`additional-${index}`, path] as const),
	] as const;
	for (const [label, configuredRoot] of protectedRoots) {
		const lexicalProtected = resolve(configuredRoot);
		let canonicalProtected = lexicalProtected;
		try {
			canonicalProtected = realpathSync.native(lexicalProtected);
		} catch (error) {
			if (existsSyncCompat(lexicalProtected)) {
				throw new Error(`cannot canonicalize existing ${label} protected root: ${lexicalProtected} (${String(error)})`);
			}
		}
		for (const protectedPath of [lexicalProtected, canonicalProtected]) {
			if (
				lexicalInside(workspace, protectedPath) ||
				lexicalInside(protectedPath, workspace) ||
				lexicalInside(actual, protectedPath) ||
				lexicalInside(protectedPath, actual)
			) {
				throw new Error(`exchange workspace overlaps ${label} root: ${workspace}`);
			}
		}
	}
}

function existsSyncCompat(path: string): boolean {
	try {
		realpathSync.native(path);
		return true;
	} catch {
		return false;
	}
}
