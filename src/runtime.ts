/**
 * Python runtime resolution utilities.
 *
 * Detects Python executables, virtual environments, and filters environment
 * variables for child processes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "./bindings/spawn.js";

export interface RuntimeInfo {
	pythonPath: string;
	env: Record<string, string>;
	venvPath?: string;
}

/** Environment variables allowed through to the Python kernel subprocess. */
const ENV_ALLOWLIST = new Set([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"LC_MESSAGES",
	"TERM",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"TMPDIR",
	"TEMP",
	"TMP",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_RUNTIME_DIR",
	"SSH_AUTH_SOCK",
	"VIRTUAL_ENV",
	"CONDA_PREFIX",
	"CONDA_DEFAULT_ENV",
	"PYTHONPATH",
	"PI_PYTHON_GATEWAY_URL",
	"PI_PYTHON_GATEWAY_TOKEN",
]);

/**
 * Filter environment variables to only allow known-safe variables.
 */
export function filterEnv(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const key of ENV_ALLOWLIST) {
		const value = env[key];
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Resolve the Python runtime for the given working directory.
 *
 * Detection order:
 * 1. VIRTUAL_ENV environment variable
 * 2. CONDA_PREFIX environment variable
 * 3. .venv directory in cwd or ancestors
 * 4. System python3
 * 5. System python
 */
export function resolvePythonRuntime(
	cwd: string,
	baseEnv: Record<string, string>,
): RuntimeInfo {
	const env = { ...baseEnv };

	// Check VIRTUAL_ENV
	const venvPath = env["VIRTUAL_ENV"];
	if (venvPath) {
		const pythonPath = path.join(venvPath, "bin", "python3");
		if (fs.existsSync(pythonPath)) {
			return { pythonPath, env, venvPath };
		}
		const pythonAlt = path.join(venvPath, "bin", "python");
		if (fs.existsSync(pythonAlt)) {
			return { pythonPath: pythonAlt, env, venvPath };
		}
	}

	// Check CONDA_PREFIX
	const condaPrefix = env["CONDA_PREFIX"];
	if (condaPrefix) {
		const pythonPath = path.join(condaPrefix, "bin", "python3");
		if (fs.existsSync(pythonPath)) {
			return { pythonPath, env, venvPath: condaPrefix };
		}
	}

	// Walk up from cwd looking for .venv
	let dir = cwd;
	while (dir !== path.dirname(dir)) {
		const venvDir = path.join(dir, ".venv");
		if (fs.existsSync(venvDir)) {
			const pythonPath = path.join(venvDir, "bin", "python3");
			if (fs.existsSync(pythonPath)) {
				return { pythonPath, env, venvPath: venvDir };
			}
			const pythonAlt = path.join(venvDir, "bin", "python");
			if (fs.existsSync(pythonAlt)) {
				return { pythonPath: pythonAlt, env, venvPath: venvDir };
			}
		}
		dir = path.dirname(dir);
	}

	// Fallback to system python3
	try {
		const result = spawnSync("which", ["python3"], { env });
		if (result.exitCode === 0) {
			const pythonPath = result.stdout.trim();
			return { pythonPath, env };
		}
	} catch {
		// Fall through to next option
	}

	// Fallback to python
	return { pythonPath: "python3", env };
}

/**
 * Check if Python and required packages (jupyter_kernel_gateway, ipykernel) are available.
 */
export async function checkPythonAvailability(
	cwd: string,
): Promise<{ ok: boolean; pythonPath?: string; reason?: string }> {
	const baseEnv = filterEnv(process.env as Record<string, string | undefined>);
	const runtime = resolvePythonRuntime(cwd, baseEnv);

	const checkScript =
		"import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('kernel_gateway') and importlib.util.find_spec('ipykernel') else 1)";

	const result = spawnSync(runtime.pythonPath, ["-c", checkScript], {
		env: runtime.env,
		cwd,
	});

	if (result.exitCode === 0) {
		return { ok: true, pythonPath: runtime.pythonPath };
	}

	return {
		ok: false,
		pythonPath: runtime.pythonPath,
		reason:
			"jupyter_kernel_gateway or ipykernel not installed. Run: python -m pip install jupyter_kernel_gateway ipykernel",
	};
}
