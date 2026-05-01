/**
 * Kernel executor — session pool management and code execution orchestration.
 *
 * Manages kernel sessions with LRU pooling, idle timeout eviction,
 * and per-cell execution coordination.
 */

import { PythonKernel, type KernelDisplayOutput, type KernelExecuteOptions } from "./kernel.js";
import { filterEnv, resolvePythonRuntime } from "./runtime.js";
import { gatewayStart, gatewayStatus } from "./bindings/gateway.js";

// =========================================================================
// Constants
// =========================================================================

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_KERNEL_SESSIONS = 4;
const CLEANUP_INTERVAL_MS = 30 * 1000; // 30 seconds
const GATEWAY_STARTUP_TIMEOUT_MS = 30_000;

// =========================================================================
// Types
// =========================================================================

export interface ExecuteOptions {
	cwd?: string;
	deadlineMs?: number;
	signal?: AbortSignal;
	sessionId?: string;
	kernelMode?: "session" | "per-call";
	reset?: boolean;
	onChunk?: (chunk: string) => void;
}

export interface ExecuteResult {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	displayOutputs: KernelDisplayOutput[];
}

interface KernelSession {
	id: string;
	kernel: PythonKernel;
	lastUsedAt: number;
	ownerIds: Set<string>;
}

// =========================================================================
// State
// =========================================================================

const kernelSessions = new Map<string, KernelSession>();
let gatewayUrl: string | null = null;
let gatewayPid: number | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// =========================================================================
// Public API
// =========================================================================

/**
 * Warm the Python environment: start gateway and pre-create a kernel.
 */
export async function warmPythonEnvironment(
	cwd: string,
	sessionId: string,
	signal?: AbortSignal,
): Promise<{ ok: boolean; reason?: string }> {
	try {
		await ensureGateway(cwd);
		const kernel = await createKernel(cwd, sessionId, signal);
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			reason: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Execute Python code in a kernel session.
 */
export async function executePython(
	code: string,
	options: ExecuteOptions,
): Promise<ExecuteResult> {
	const cwd = options.cwd ?? process.cwd();
	const sessionId = options.sessionId ?? "default";
	const kernelMode = options.kernelMode ?? "session";

	await ensureGateway(cwd);

	// For per-call mode, create a fresh kernel each time
	if (kernelMode === "per-call" || options.reset) {
		const kernel = await createKernel(cwd, `${sessionId}-${Date.now()}`, options.signal);
		try {
			return await executeOnKernel(kernel, code, options);
		} finally {
			await kernel.shutdown();
		}
	}

	// Session mode: reuse existing kernel
	let session = kernelSessions.get(sessionId);

	if (!session || !session.kernel.isAlive()) {
		// Clean up dead session
		if (session) {
			kernelSessions.delete(sessionId);
		}

		// Evict oldest if at capacity
		if (kernelSessions.size >= MAX_KERNEL_SESSIONS) {
			const oldest = findOldestSession();
			if (oldest) {
				await evictSession(oldest);
			}
		}

		const kernel = await createKernel(cwd, sessionId, options.signal);
		session = { id: sessionId, kernel, lastUsedAt: Date.now(), ownerIds: new Set() };
		kernelSessions.set(sessionId, session);

		startCleanupTimer();
	}

	session.lastUsedAt = Date.now();
	return await executeOnKernel(session.kernel, code, options);
}

/**
 * Shutdown all kernel sessions and gateway.
 */
export async function shutdownAll(): Promise<void> {
	// Stop cleanup timer
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}

	// Shutdown all kernels
	for (const [sessionId, session] of kernelSessions) {
		try {
			await session.kernel.shutdown();
		} catch {
			// Best effort
		}
	}
	kernelSessions.clear();

	// Note: gateway is left running for the next session
	// In production, the gateway lifecycle is managed by the Rust binary
}

// =========================================================================
// Internal
// =========================================================================

async function ensureGateway(cwd: string): Promise<string> {
	if (gatewayUrl) {
		// Check if healthy
		const status = await gatewayStatus(gatewayUrl);
		if (status.healthy) return gatewayUrl;

		// Gateway is dead, restart
		gatewayUrl = null;
		gatewayPid = null;
	}

	const baseEnv = filterEnv(process.env as Record<string, string | undefined>);
	const runtime = resolvePythonRuntime(cwd, baseEnv);

	const result = await gatewayStart(runtime.pythonPath, cwd);
	gatewayUrl = result.url;
	gatewayPid = result.pid;

	// Set env var so kernels can find the gateway
	process.env["PI_PYTHON_GATEWAY_URL"] = gatewayUrl;

	return gatewayUrl;
}

async function createKernel(
	cwd: string,
	sessionId: string,
	signal?: AbortSignal,
): Promise<PythonKernel> {
	const baseEnv = filterEnv(process.env as Record<string, string | undefined>);
	const runtime = resolvePythonRuntime(cwd, baseEnv);

	return await PythonKernel.start({
		cwd,
		env: runtime.env,
		signal,
	});
}

async function executeOnKernel(
	kernel: PythonKernel,
	code: string,
	options: ExecuteOptions,
): Promise<ExecuteResult> {
	const chunks: string[] = [];
	const displayOutputs: KernelDisplayOutput[] = [];
	let outputBytes = 0;
	const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB
	let truncated = false;

	const executeOptions: KernelExecuteOptions = {
		signal: options.signal,
		timeoutMs: options.deadlineMs
			? Math.max(0, options.deadlineMs - Date.now())
			: undefined,
		onChunk: async (text: string) => {
			if (outputBytes >= MAX_OUTPUT_BYTES) {
				if (!truncated) {
					truncated = true;
					chunks.push("\n[output truncated at 50KB]\n");
				}
				return;
			}
			chunks.push(text);
			outputBytes += Buffer.byteLength(text, "utf-8");
			if (options.onChunk) {
				options.onChunk(text);
			}
		},
		onDisplay: async (output: KernelDisplayOutput) => {
			displayOutputs.push(output);
		},
	};

	const result = await kernel.execute(code, executeOptions);

	const output = chunks.join("");
	const outputLines = output.split("\n").length;

	return {
		output,
		exitCode: result.status === "ok" ? 0 : 1,
		cancelled: result.cancelled,
		truncated,
		totalLines: outputLines,
		totalBytes: outputBytes,
		displayOutputs,
	};
}

function findOldestSession(): string | undefined {
	let oldestId: string | undefined;
	let oldestTime = Infinity;
	for (const [id, session] of kernelSessions) {
		if (session.lastUsedAt < oldestTime) {
			oldestTime = session.lastUsedAt;
			oldestId = id;
		}
	}
	return oldestId;
}

async function evictSession(sessionId: string): Promise<void> {
	const session = kernelSessions.get(sessionId);
	if (!session) return;

	try {
		await session.kernel.shutdown();
	} catch {
		// Best effort
	}
	kernelSessions.delete(sessionId);
}

function startCleanupTimer(): void {
	if (cleanupTimer) return;
	cleanupTimer = setInterval(() => {
		void cleanupIdleSessions();
	}, CLEANUP_INTERVAL_MS);
	cleanupTimer.unref();
}

async function cleanupIdleSessions(): Promise<void> {
	const now = Date.now();
	for (const [sessionId, session] of kernelSessions) {
		if (now - session.lastUsedAt > IDLE_TIMEOUT_MS) {
			await evictSession(sessionId);
		}
	}

}
