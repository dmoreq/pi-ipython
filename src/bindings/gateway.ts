/**
 * Gateway lifecycle bindings — wraps pi-ipython-cli gateway-* subcommands.
 */

import { resolveBinary } from "./binary.js";
import { spawn } from "./spawn.js";

export interface GatewayStartResult {
	url: string;
	port: number;
	pid: number;
}

export interface GatewayStatusResult {
	healthy: boolean;
	url: string;
}

/**
 * Start a Jupyter kernel gateway on an auto-allocated port.
 */
export async function gatewayStart(
	pythonPath: string,
	cwd: string,
	port?: number,
): Promise<GatewayStartResult> {
	const binary = resolveBinary();
	const args = ["gateway-start", `--python-path`, pythonPath, `--cwd`, cwd];
	if (port !== undefined) {
		args.push(`--port`, String(port));
	}

	const { stdout, stderr, exitCode } = await spawn(binary, args);

	if (exitCode !== 0) {
		throw new Error(`Gateway start failed: ${stderr.trim()}`);
	}
	return JSON.parse(stdout) as GatewayStartResult;
}

/**
 * Check if a gateway is healthy by querying its /api/kernelspecs endpoint.
 */
export async function gatewayStatus(url: string): Promise<GatewayStatusResult> {
	const binary = resolveBinary();
	const { stdout, exitCode } = await spawn(binary, ["gateway-status", `--url`, url]);

	if (exitCode !== 0) {
		return { healthy: false, url };
	}
	return JSON.parse(stdout) as GatewayStatusResult;
}
