/**
 * Minimal pi extension type definitions.
 *
 * These mirror the pi SDK's extension interfaces. When published, the peer
 * dependency on @oh-my-pi/pi provides the canonical types.
 */

export interface PiContext {
	cwd: string;
	config: Record<string, unknown>;
	sessionId?: string;
}

export interface PiExtension {
	/** Unique extension name. */
	name: string;
	/** Lifecycle hooks. */
	hooks?: {
		session_start?: (ctx: PiContext) => Promise<void>;
		session_shutdown?: (ctx: PiContext) => Promise<void>;
	};
	/** Registered tools. */
	tools?: PiToolDefinition[];
}

export interface PiToolDefinition {
	name: string;
	description: string;
	schema: Record<string, unknown>;
	call: (ctx: PiContext, params: Record<string, unknown>) => Promise<PiToolResult>;
	renderCall?: (ctx: PiContext, params: Record<string, unknown>) => string[];
	renderResult?: (ctx: PiContext, result: PiToolResult) => string[];
}

export interface PiToolResult {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
}
