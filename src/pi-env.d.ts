/**
 * Ambient type declarations for pi's runtime globals and TUI components.
 * These are injected by the pi agent host process.
 */
declare module "@mariozechner/pi-tui" {
	export class Container {
		constructor(layout: "vertical" | "horizontal", padding: number);
		addChild(child: unknown): void;
	}
	export class Image {
		constructor(
			base64: string,
			mime: string,
			opts?: Record<string, unknown>,
			layout?: Record<string, unknown>,
		);
	}
	export class Text {
		constructor(text: string, x: number, y: number);
	}
	export function getCapabilities(): { images?: boolean };
}

/** Minimal pi extension runtime interfaces (provided by host). */
declare namespace PiExtension {
	interface EventContext {
		cwd: string;
		config: Record<string, unknown>;
		sessionId?: string;
		hasUI?: boolean;
		ui: {
			confirm(title: string, message: string): Promise<boolean>;
		};
	}

	interface ToolContext {
		cwd: string;
		config: Record<string, unknown>;
		sessionId?: string;
	}

	interface ToolEvent {
		toolName: string;
		input?: unknown;
	}

	interface ToolResultDetails {
		cells?: Array<{
			index: number;
			title?: string;
			code: string;
			output: string;
			displayOutputs?: Array<{ type: string; data?: string; mimeType?: string }>;
			status: string;
			durationMs?: number;
		}>;
		images?: Array<{
			base64: string;
			mime: string;
			cellIndex: number;
			cellTitle?: string;
		}>;
	}

	interface PiAPI {
		on(event: "session_start", handler: (event: unknown, ctx: EventContext) => void): void;
		on(event: "session_shutdown", handler: () => void): void;
		on(event: "tool_call", handler: (event: ToolEvent, ctx: EventContext) => Promise<{ block: boolean; reason: string } | undefined>): void;
		registerTool(tool: {
			name: string;
			label: string;
			description: string;
			promptSnippet: string;
			parameters: Record<string, unknown>;
			execute(toolCallId: unknown, params: Record<string, unknown>, signal: AbortSignal, onUpdate: ((update: { content: Array<{ type: string; text: string }> }) => void) | undefined, ctx: ToolContext): Promise<{
				content: Array<{ type: string; text: string }>;
				details: ToolResultDetails;
			}>;
			renderCall(args: Record<string, unknown>, theme: { fg(color: string, text: string): string }, context: Record<string, unknown>): unknown;
			renderResult(result: { details: ToolResultDetails }, options: Record<string, unknown>, theme: { fg(color: string, text: string): string }, context: { showImages: boolean }): unknown;
		}): void;
	}
}

declare function getPi(): PiExtension.PiAPI;
