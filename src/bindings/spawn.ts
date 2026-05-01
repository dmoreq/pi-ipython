/**
 * Node.js child_process wrappers that replace Bun.spawn / Bun.spawnSync.
 *
 * Extensions run in pi's host process which may be Node.js (not Bun), so we
 * cannot rely on Bun globals. These helpers provide the same semantics using
 * only Node.js built-in modules.
 */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";

export interface SpawnOptions {
	cwd?: string;
	env?: Record<string, string>;
}

export interface SpawnResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

/**
 * Spawn a child process and collect its stdout, stderr, and exit code.
 * Equivalent to Bun.spawn with stdout/stderr pipes followed by
 * `new Response(proc.stdout).text()` + `await proc.exited`.
 */
export function spawn(
	command: string,
	args: string[],
	opts?: SpawnOptions,
): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = nodeSpawn(command, args, {
			cwd: opts?.cwd,
			env: opts?.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", reject);
		child.on("close", (code) => {
			resolve({ stdout, stderr, exitCode: code });
		});
	});
}

/**
 * Synchronous spawn with collected output. Equivalent to Bun.spawnSync.
 */
export function spawnSync(
	command: string,
	args: string[],
	opts?: SpawnOptions,
): SpawnResult {
	const result = nodeSpawnSync(command, args, {
		cwd: opts?.cwd,
		env: opts?.env,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	return {
		stdout: result.stdout as string,
		stderr: result.stderr as string,
		exitCode: result.status,
	};
}
