/**
 * pi-ipython — IPython kernel integration for pi.
 *
 * Registers the `eval` tool that executes Python code cells via a Jupyter
 * kernel gateway. Starts gateway on first eval, manages kernel session pool,
 * and cleans up on session shutdown.
 *
 * The tool is automatically selected by the agent when it needs to:
 * - Debug Python code
 * - Explore or visualize data (DataFrames, matplotlib, plotly)
 * - Run quick Python computations
 *
 * Execution requires user confirmation via the `tool_call` interceptor.
 * Matplotlib/seaborn/plotly figures are displayed inline via pi-tui's Image component.
 */
// @ts-nocheck - runs inside pi's module context which provides typebox, ExtensionAPI, etc.
import { executePython, shutdownAll } from "./executor.js";
import { parseEvalInput } from "./parse.js";
import { checkPythonAvailability } from "./runtime.js";
import { Container, getCapabilities, Image, Text } from "@mariozechner/pi-tui";

const MAX_WIDTH_CELLS = 80;

export default async function (pi) {
	// Check Python availability on startup
	pi.on("session_start", async (_event, ctx) => {
		const available = await checkPythonAvailability(ctx.cwd);
		if (!available.ok) {
			console.warn(`[pi-ipython] ${available.reason}`);
		}
	});

	// Clean up kernels on shutdown
	pi.on("session_shutdown", async () => {
		await shutdownAll();
	});

	// Intercept eval tool calls — require user confirmation before execution.
	// The agent is instructed (via the eval skill) to ask first, but this
	// interceptor provides a safety net in case the skill instruction is missed.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "eval") return;

		const input = String(event.input?.input ?? "");
		// Extract a brief preview for the confirmation prompt
		const preview = input.trim().slice(0, 120).replace(/\n/g, " ");

		if (!ctx.hasUI) {
			// Non-interactive mode (print, RPC) — skip confirmation
			// In RPC mode the client handles its own confirm flow
			return;
		}

		const confirmed = await ctx.ui.confirm(
			"Execute Python code?",
			`The agent wants to run Python code in an IPython kernel.\n\nPreview: ${preview}${input.length > 120 ? "..." : ""}\n\nAllow execution?`,
		);

		if (!confirmed) {
			return { block: true, reason: "User declined Python execution" };
		}
	});

	// Register the eval tool
	pi.registerTool({
		name: "eval",
		label: "Eval (Python)",
		description:
			"Execute Python code cells using an IPython kernel. " +
			"Use this for debugging Python code, exploring datasets, " +
			"visualizing data (matplotlib, plotly, seaborn), running " +
			"pandas/numpy operations, or any quick Python computation. " +
			"Supports fenced code blocks (```py ... ```) with optional " +
			"attributes: title=, t= (timeout ms), rst (reset kernel). " +
			"Provides prelude helpers: read(), write(), find(), grep(), " +
			"run(), env(), tree(), stat(), diff(), display(). " +
			"IMPORTANT: Always confirm with the user before executing Python code.",

		promptSnippet: "Execute Python code cells for debugging, data exploration, or visualization (IPython kernel)",

		parameters: {
			type: "object",
			properties: {
				input: {
					type: "string",
					description:
						"Atom-style eval input with Python fenced code blocks. " +
						"Each ```py block is a cell executed sequentially in a shared kernel session.",
				},
			},
			required: ["input"],
		},

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const input = String(params.input ?? "");
			const parsed = parseEvalInput(input);
			const results = [];

			for (const cell of parsed.cells) {
				const startTime = Date.now();

				if (onUpdate) {
					const label = cell.title
						? `[Cell ${cell.index + 1}: ${cell.title}]`
						: `[Cell ${cell.index + 1}]`;
					onUpdate({
						content: [{ type: "text", text: `${label} running...\n` }],
					});
				}

				try {
					const result = await executePython(cell.code, {
						cwd: ctx.cwd,
						sessionId: ctx.sessionId ?? "default",
						reset: cell.reset,
						deadlineMs: Date.now() + cell.timeoutMs,
						signal,
						onChunk: (chunk) => {
							if (onUpdate) {
								onUpdate({
									content: [{ type: "text", text: chunk }],
								});
							}
						},
					});

					results.push({
						index: cell.index,
						title: cell.title,
						code: cell.code,
						output: result.output,
						displayOutputs: result.displayOutputs,
						status: result.cancelled || result.exitCode !== 0 ? "error" : "ok",
						durationMs: Date.now() - startTime,
					});
				} catch (err) {
					results.push({
						index: cell.index,
						title: cell.title,
						code: cell.code,
						output: err instanceof Error ? err.message : String(err),
						displayOutputs: [],
						status: "error",
						durationMs: Date.now() - startTime,
					});
				}
			}

			// Build output text
			const outputParts = [];
			for (const r of results) {
				const header = r.title
					? `[Cell ${r.index + 1}: ${r.title}]`
					: `[Cell ${r.index + 1}]`;
				outputParts.push(header);
				if (r.durationMs) {
					outputParts.push(`  Duration: ${r.durationMs}ms`);
				}
				outputParts.push(`  Status: ${r.status}`);
				if (r.output) {
					outputParts.push(`  Output:\n${r.output}`);
				}
				outputParts.push("");
			}

			// Aggregate all images from all cells for TUI rendering
			const images = [];
			for (const r of results) {
				if (r.displayOutputs) {
					for (const d of r.displayOutputs) {
						if (d.type === "image") {
							images.push({
								base64: d.data,
								mime: d.mimeType,
								cellIndex: r.index,
								cellTitle: r.title,
							});
						}
					}
				}
			}

			return {
				content: [
					{
						type: "text",
						text: outputParts.join("\n"),
					},
				],
				details: {
					cells: results,
					images,
				},
			};
		},

		renderCall(args, theme, context) {
			const input = String(args.input ?? "");
			const firstLine = input.split("\n")[0] || "(empty)";
			return new Text(`eval: ${firstLine}`, 0, 0);
		},

		renderResult(result, options, theme, context) {
			const container = new Container("vertical", 0);
			const cells = result.details?.cells;
			const images = result.details?.images;

			// Status lines for each cell
			if (cells) {
				for (const cell of cells) {
					const icon = cell.status === "ok" ? "OK" : "ER";
					const duration = cell.durationMs ? ` (${cell.durationMs}ms)` : "";
					const label = cell.title
						? `  [${icon}] Cell ${cell.index + 1}: ${cell.title}${duration}`
						: `  [${icon}] Cell ${cell.index + 1}${duration}`;
					container.addChild(
						new Text(
							theme.fg(cell.status === "ok" ? "info" : "error", label),
							0,
							0,
						),
					);
				}
			}

			// Inline image display (matplotlib, plotly, seaborn figures)
			if (
				getCapabilities().images &&
				context.showImages &&
				images &&
				images.length > 0
			) {
				for (const img of images) {
					const imgLabel = img.cellTitle
						? `  Figure from Cell ${img.cellIndex + 1}: ${img.cellTitle}`
						: `  Figure from Cell ${img.cellIndex + 1}`;
					container.addChild(
						new Text(theme.fg("muted", imgLabel), 0, 0),
					);
					container.addChild(
						new Image(img.base64, img.mime, {}, { maxWidthCells: MAX_WIDTH_CELLS }),
					);
				}
			}

			return container;
		},
	});
}
