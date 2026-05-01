/**
 * PythonKernel — IPython kernel connection via WebSocket + Jupyter protocol.
 *
 * Manages the lifecycle of a single IPython kernel: connect via WebSocket,
 * execute code cells, handle display outputs, interrupts, and shutdown.
 */

import { Snowflake } from "./snowflake.js";
import { getPrelude } from "./prelude.js";
import { combineAbortSignal, throwIfAborted } from "./cancellation.js";

// =========================================================================
// Types
// =========================================================================

export interface JupyterHeader {
	msg_id: string;
	session: string;
	username: string;
	date: string;
	msg_type: string;
	version: string;
}

export interface JupyterMessage {
	channel: string;
	header: JupyterHeader;
	parent_header: Record<string, unknown>;
	metadata: Record<string, unknown>;
	content: Record<string, unknown>;
	buffers?: Uint8Array[];
}

export interface KernelExecuteOptions {
	signal?: AbortSignal;
	onChunk?: (text: string) => Promise<void> | void;
	onDisplay?: (output: KernelDisplayOutput) => Promise<void> | void;
	timeoutMs?: number;
	silent?: boolean;
	storeHistory?: boolean;
}

export interface KernelExecuteResult {
	status: "ok" | "error";
	executionCount?: number;
	error?: { name: string; value: string; traceback: string[] };
	cancelled: boolean;
	timedOut: boolean;
}

export interface KernelStartOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	signal?: AbortSignal;
	deadlineMs?: number;
}

export type KernelDisplayOutput =
	| { type: "json"; data: unknown }
	| { type: "image"; data: string; mimeType: string }
	| { type: "markdown" }
	| { type: "status"; event: { op: string; [key: string]: unknown } };

// =========================================================================
// Python Kernel class
// =========================================================================

export class PythonKernel {
	#ws: WebSocket | null = null;
	#alive = true;
	#disposed = false;
	#messageHandlers = new Map<string, (msg: JupyterMessage) => void>();
	#pendingExecutions = new Map<string, (reason: string) => void>();

	private constructor(
		readonly id: string,
		readonly kernelId: string,
		readonly gatewayUrl: string,
		readonly sessionId: string,
		readonly username: string,
		readonly authToken?: string,
	) {}

	static async start(options: KernelStartOptions): Promise<PythonKernel> {
		const startupSignal = combineAbortSignal(
			options.signal,
			undefined,
			"Python kernel startup aborted",
		);
		throwIfAborted(startupSignal, "Python kernel startup aborted");

		// Create kernel via gateway HTTP API
		const gatewayBase = options.env?.["PI_PYTHON_GATEWAY_URL"] ?? "http://127.0.0.1:8888";
		const token = options.env?.["PI_PYTHON_GATEWAY_TOKEN"];

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers["Authorization"] = `token ${token}`;

		const createResponse = await fetch(`${gatewayBase}/api/kernels`, {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "python3" }),
			signal: startupSignal,
		});

		if (!createResponse.ok) {
			const text = await createResponse.text();
			throw new Error(`Failed to create kernel: ${text}`);
		}

		const kernelInfo = (await createResponse.json()) as { id: string };
		const kernel = new PythonKernel(
			Snowflake.next(),
			kernelInfo.id,
			gatewayBase,
			Snowflake.next(),
			"pi-ipython",
			token,
		);

		try {
			await kernel.#connectWebSocket({ signal: options.signal });
			await kernel.#initializeEnvironment(options.cwd, options.env);

			// Inject prelude
			const preludeCode = getPrelude();
			const preludeResult = await kernel.execute(preludeCode, {
				silent: true,
				storeHistory: false,
				timeoutMs: 10_000,
			});

			if (preludeResult.status === "error") {
				throw new Error(
					`Failed to initialize Python kernel prelude: ${preludeResult.error?.value ?? "unknown error"}`,
				);
			}

			return kernel;
		} catch (err) {
			await kernel.shutdown();
			throw err;
		}
	}

	async #connectWebSocket(options: { signal?: AbortSignal } = {}): Promise<void> {
		const wsBase = this.gatewayUrl.replace(/^http/, "ws");
		let wsUrl = `${wsBase}/api/kernels/${this.kernelId}/channels`;
		if (this.authToken) {
			wsUrl += `?token=${encodeURIComponent(this.authToken)}`;
		}

		const connectSignal = combineAbortSignal(
			options.signal,
			10_000,
			"WebSocket connection timeout",
		);
		throwIfAborted(connectSignal, "WebSocket connection timeout");

		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";

		let settled = false;

		const onAbort = () => {
			ws.close();
			if (settled) return;
			settled = true;
			reject(new Error("WebSocket connection timeout"));
		};

		if (connectSignal) {
			connectSignal.addEventListener("abort", onAbort, { once: true });
		}

		ws.onopen = () => {
			if (settled) return;
			settled = true;
			this.#ws = ws;
			resolve();
		};

		ws.onerror = () => {
			const error = new Error("WebSocket error");
			if (!settled) {
				settled = true;
				reject(error);
				return;
			}
			this.#alive = false;
			this.#ws = null;
		};

		ws.onclose = () => {
			this.#alive = false;
			this.#ws = null;
			if (!settled) {
				settled = true;
				reject(new Error("WebSocket closed before connection"));
				return;
			}
			// Abort any pending executions
			for (const cancel of this.#pendingExecutions.values()) {
				cancel("WebSocket closed");
			}
			this.#pendingExecutions.clear();
			this.#messageHandlers.clear();
		};

		ws.onmessage = (event) => {
			const msg = this.#decodeMessage(event.data);
			if (!msg) return;

			// Route to parent-specific handler
			const parentHeader = msg.parent_header as { msg_id?: string };
			const parentId = parentHeader?.msg_id;
			if (parentId) {
				const handler = this.#messageHandlers.get(parentId);
				if (handler) handler(msg);
			}
		};

		return promise;
	}

	async #initializeEnvironment(
		cwd: string,
		env?: Record<string, string | undefined>,
	): Promise<void> {
		const envEntries = Object.entries(env ?? {}).filter(
			([, v]) => v !== undefined,
		);
		const envPayload = Object.fromEntries(envEntries);
		const initScript = [
			"import os, sys",
			`__pi_ipython_cwd = ${JSON.stringify(cwd)}`,
			"os.chdir(__pi_ipython_cwd)",
			`__pi_ipython_env = ${JSON.stringify(envPayload)}`,
			"for __pi_ipython_key, __pi_ipython_val in __pi_ipython_env.items():",
			"    os.environ[__pi_ipython_key] = __pi_ipython_val",
			"if __pi_ipython_cwd not in sys.path:",
			"    sys.path.insert(0, __pi_ipython_cwd)",
		].join("\n");

		const result = await this.execute(initScript, {
			silent: true,
			storeHistory: false,
			timeoutMs: 10_000,
		});

		if (result.status === "error") {
			throw new Error(
				`Failed to initialize kernel environment: ${result.error?.value ?? "unknown"}`,
			);
		}
	}

	isAlive(): boolean {
		return this.#alive && !this.#disposed && this.#ws?.readyState === WebSocket.OPEN;
	}

	async execute(
		code: string,
		options?: KernelExecuteOptions,
	): Promise<KernelExecuteResult> {
		if (!this.isAlive()) {
			throw new Error("Python kernel is not running");
		}

		const msgId = Snowflake.next();
		const msg: JupyterMessage = {
			channel: "shell",
			header: {
				msg_id: msgId,
				session: this.sessionId,
				username: this.username,
				date: new Date().toISOString(),
				msg_type: "execute_request",
				version: "5.5",
			},
			parent_header: {},
			metadata: {},
			content: {
				code,
				silent: options?.silent ?? false,
				store_history: options?.storeHistory ?? !(options?.silent ?? false),
				user_expressions: {},
				allow_stdin: false,
				stop_on_error: true,
			},
		};

		let status: "ok" | "error" = "ok";
		let executionCount: number | undefined;
		let errorResult: { name: string; value: string; traceback: string[] } | undefined;
		let replyReceived = false;
		let idleReceived = false;
		let cancelled = false;
		let timedOut = false;

		const { promise, resolve } = Promise.withResolvers<KernelExecuteResult>();

		let resolved = false;
		const finalize = () => {
			if (resolved) return;
			resolved = true;
			if (timeoutId) clearTimeout(timeoutId);
			this.#messageHandlers.delete(msgId);
			this.#pendingExecutions.delete(msgId);
			resolve({ status, executionCount, error: errorResult, cancelled, timedOut });
		};

		const checkDone = () => {
			if (replyReceived && idleReceived) finalize();
		};

		// The Jupyter protocol: after execute_request on shell channel, messages arrive on iopub channel
		// We handle both by checking parent_header.msg_id matches our request.

		this.#messageHandlers.set(msgId, async (response: JupyterMessage) => {
			switch (response.header.msg_type) {
				case "execute_reply": {
					replyReceived = true;
					const replyStatus = response.content.status as string;
					status = replyStatus === "error" ? "error" : "ok";
					if (typeof response.content.execution_count === "number") {
						executionCount = response.content.execution_count;
					}
					checkDone();
					break;
				}
				case "stream": {
					const text = String(response.content.text ?? "");
					if (text && options?.onChunk) {
						await options.onChunk(text);
					}
					break;
				}
				case "execute_result":
				case "display_data": {
					const { text, outputs } = renderKernelDisplay(response.content);
					if (text && options?.onChunk) {
						await options.onChunk(text);
					}
					if (outputs.length > 0 && options?.onDisplay) {
						for (const output of outputs) {
							await options.onDisplay(output);
						}
					}
					break;
				}
				case "error": {
					const traceback = Array.isArray(response.content.traceback)
						? (response.content.traceback as string[]).map(String)
						: [];
					errorResult = {
						name: String(response.content.ename ?? "Error"),
						value: String(response.content.evalue ?? ""),
						traceback,
					};
					const text = traceback.length > 0
						? `${traceback.join("\n")}\n`
						: `${errorResult.name}: ${errorResult.value}\n`;
					if (options?.onChunk) {
						await options.onChunk(text);
					}
					break;
				}
				case "status": {
					const state = response.content.execution_state as string;
					if (state === "idle") {
						idleReceived = true;
						checkDone();
					}
					break;
				}
				case "execute_input": {
					// Log which code is being executed (for progress tracking)
					if (options?.onChunk) {
						const execCode = String(response.content.code ?? "").trim();
						const shortCode = execCode.slice(0, 60).replace(/\n/g, " ");
						await options.onChunk(`  [executing: ${shortCode}${execCode.length > 60 ? "..." : ""}]\n`);
					}
					break;
				}
				case "input_request": {
					if (options?.onChunk) {
						await options.onChunk(
							"[stdin] Kernel requested input. Interactive stdin is not supported.\n",
						);
					}
					break;
				}
			}
		});

		// Handle timeout
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		if (options?.timeoutMs && options.timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				cancelled = true;
				this.#interruptKernel().catch(() => {});
				resolved = true;
				this.#messageHandlers.delete(msgId);
				this.#pendingExecutions.delete(msgId);
				resolve({ status, executionCount, error: errorResult, cancelled, timedOut });
			}, options.timeoutMs);
		}

		// Handle abort signal
		if (options?.signal) {
			const onAbort = () => {
				cancelled = true;
				this.#interruptKernel().catch(() => {});
				finalize();
			};
			options.signal.addEventListener("abort", onAbort, { once: true });
		}

		// Send the message
		try {
			this.#sendMessage(msg);
		} catch {
			cancelled = true;
			finalize();
		}

		return promise;
	}

	async #interruptKernel(): Promise<void> {
		try {
			await fetch(`${this.gatewayUrl}/api/kernels/${this.kernelId}/interrupt`, {
				method: "POST",
				headers: this.#authHeaders(),
				signal: AbortSignal.timeout(2000),
			});
		} catch {
			// Best effort
		}
	}

	async shutdown(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#alive = false;

		if (this.#ws) {
			this.#ws.close();
			this.#ws = null;
		}

		try {
			await fetch(`${this.gatewayUrl}/api/kernels/${this.kernelId}`, {
				method: "DELETE",
				headers: this.#authHeaders(),
				signal: AbortSignal.timeout(3000),
			});
		} catch {
			// Best effort cleanup
		}

		this.#messageHandlers.clear();
		this.#pendingExecutions.clear();
	}

	#sendMessage(msg: JupyterMessage): void {
		if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
			throw new Error("WebSocket not connected");
		}
		const data = this.#encodeMessage(msg);
		this.#ws.send(data);
	}

	#authHeaders(): Record<string, string> {
		if (!this.authToken) return {};
		return { Authorization: `token ${this.authToken}` };
	}

	#decodeMessage(data: unknown): JupyterMessage | null {
		if (data instanceof ArrayBuffer) {
			return this.#deserializeBinaryFrame(data);
		}
		if (typeof data === "string") {
			try {
				return JSON.parse(data) as JupyterMessage;
			} catch {
				return null;
			}
		}
		return null;
	}

	#encodeMessage(msg: JupyterMessage): ArrayBuffer | string {
		// For simple messages without buffers, send as JSON text
		if (!msg.buffers || msg.buffers.length === 0) {
			return JSON.stringify({
				channel: msg.channel,
				header: msg.header,
				parent_header: msg.parent_header,
				metadata: msg.metadata,
				content: msg.content,
			});
		}

		// For messages with buffers, use binary framing
		return this.#serializeBinaryFrame(msg);
	}

	#deserializeBinaryFrame(data: ArrayBuffer): JupyterMessage | null {
		try {
			const view = new DataView(data);
			const offsetCount = view.getUint32(0, true);
			if (offsetCount < 1) return null;

			const offsets: number[] = [];
			for (let i = 0; i < offsetCount; i++) {
				offsets.push(view.getUint32(4 + i * 4, true));
			}

			const msgStart = offsets[0];
			const msgEnd = offsets.length > 1 ? offsets[1] : data.byteLength;
			const msgBytes = new Uint8Array(data, msgStart, msgEnd - msgStart);
			const decoder = new TextDecoder();
			const msgText = decoder.decode(msgBytes);

			const msg = JSON.parse(msgText) as {
				channel: string;
				header: JupyterHeader;
				parent_header: Record<string, unknown>;
				metadata: Record<string, unknown>;
				content: Record<string, unknown>;
			};

			// Extract buffers
			const buffers: Uint8Array[] = [];
			for (let i = 1; i < offsets.length; i++) {
				const start = offsets[i];
				const end = i + 1 < offsets.length ? offsets[i + 1] : data.byteLength;
				buffers.push(new Uint8Array(data, start, end - start));
			}

			return {
				...msg,
				buffers: buffers.length > 0 ? buffers : undefined,
			};
		} catch {
			return null;
		}
	}

	#serializeBinaryFrame(msg: JupyterMessage): ArrayBuffer {
		const msgText = JSON.stringify({
			channel: msg.channel,
			header: msg.header,
			parent_header: msg.parent_header,
			metadata: msg.metadata,
			content: msg.content,
		});

		const buffers = msg.buffers ?? [];
		const offsetCount = 1 + buffers.length;
		const headerSize = 4 + offsetCount * 4;
		const encoder = new TextEncoder();
		const msgBytes = encoder.encode(msgText);
		let totalSize = headerSize + msgBytes.length;
		for (const buf of buffers) {
			totalSize += buf.length;
		}

		const result = new ArrayBuffer(totalSize);
		const view = new DataView(result);
		const bytes = new Uint8Array(result);

		view.setUint32(0, offsetCount, true);

		let offset = headerSize;
		view.setUint32(4, offset, true);
		bytes.set(msgBytes, offset);
		offset += msgBytes.length;

		for (let i = 0; i < buffers.length; i++) {
			view.setUint32(4 + (i + 1) * 4, offset, true);
			bytes.set(buffers[i], offset);
			offset += buffers[i].length;
		}

		return result;
	}
}

// =========================================================================
// Display rendering
// =========================================================================

/** Render a Jupyter display_data / execute_result message content. */
export function renderKernelDisplay(
	content: Record<string, unknown>,
): { text: string; outputs: KernelDisplayOutput[] } {
	const data = content.data as Record<string, unknown> | undefined;
	if (!data) return { text: "", outputs: [] };

	const outputs: KernelDisplayOutput[] = [];

	// Handle status events (custom MIME type from prelude helpers)
	const statusData = data["application/x-pi-ipython-status"];
	if (statusData && typeof statusData === "object" && "op" in statusData) {
		outputs.push({
			type: "status",
			event: statusData as { op: string; [key: string]: unknown },
		});
		return { text: "", outputs };
	}

	if (typeof data["image/png"] === "string") {
		outputs.push({
			type: "image",
			data: data["image/png"] as string,
			mimeType: "image/png",
		});
	}
	if (data["application/json"] !== undefined) {
		outputs.push({ type: "json", data: data["application/json"] });
	}

	// Check markdown before text/plain
	if (typeof data["text/markdown"] === "string") {
		outputs.push({ type: "markdown" });
		const text = String(data["text/markdown"]);
		return { text: text.endsWith("\n") ? text : `${text}\n`, outputs };
	}
	if (typeof data["text/plain"] === "string") {
		const text = String(data["text/plain"]);
		return { text: text.endsWith("\n") ? text : `${text}\n`, outputs };
	}

	return { text: "", outputs };
}
