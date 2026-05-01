/**
 * Atom-style eval input parser.
 *
 * Parses fenced code blocks into executable cells with optional metadata
 * (title, timeout, reset). Supports multi-cell input with the RESET directive.
 *
 * Example input:
 *
 * ```py title=init t=60000
 * import pandas as pd
 * ```
 *
 * ```py
 * df = pd.read_csv("data.csv")
 * df.head()
 * ```
 *
 * RESET
 * ```py
 * x = 1
 * ```
 */

export interface ParsedEvalCell {
	index: number;
	title?: string;
	code: string;
	language: string;
	timeoutMs: number;
	reset: boolean;
}

export interface ParsedEvalInput {
	cells: ParsedEvalCell[];
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Language aliases mapped to "python" (since pi-ipython only targets Python). */
const LANGUAGE_ALIASES = new Set([
	"py",
	"python",
	"ipy",
	"ipython",
]);

/** Attribute keys for cell metadata in fence info strings. */
const ID_KEYS = new Set(["id", "title", "name", "cell", "file", "label"]);
const T_KEYS = new Set(["t", "timeout", "duration", "time"]);
const RST_KEYS = new Set(["rst", "reset"]);

function classifyAttrKey(key: string): "id" | "t" | "rst" | null {
	if (ID_KEYS.has(key)) return "id";
	if (T_KEYS.has(key)) return "t";
	if (RST_KEYS.has(key)) return "rst";
	return null;
}

/** Check if a language token maps to our Python backend. */
function isPythonAlias(token: string): boolean {
	return LANGUAGE_ALIASES.has(token.toLowerCase());
}

/** Parse a single fenced code block into a cell. */
function parseFenceBlock(
	block: string,
	index: number,
	reset: boolean,
): ParsedEvalCell {
	const cell: ParsedEvalCell = {
		index,
		code: "",
		language: "python",
		timeoutMs: DEFAULT_TIMEOUT_MS,
		reset,
	};

	const lines = block.split("\n");

	// Require at least opening fence + code + closing fence
	if (lines.length < 3 || !lines[0].trimStart().startsWith("\x60\x60\x60")) {
		cell.code = block;
		return cell;
	}

	// Last line must be a closing fence
	if (!lines[lines.length - 1].trimStart().startsWith("\x60\x60\x60")) {
		cell.code = block;
		return cell;
	}

	// Parse opening fence: ```language [attr1=val1 ...]
	const infoText = lines[0].trimStart().slice(3).trim();
	const tokens = infoText.match(/[^\s=]+(?:="[^"]*"|='[^']*'|=\S+)?/g) ?? [];

	let langToken: string | undefined;
	for (const token of tokens) {
		if (!token.includes("=")) {
			// Language token
			if (!langToken) {
				langToken = token;
				if (!isPythonAlias(token)) {
					cell.title = token;
				}
			}
		} else {
			// key=value attribute
			const eqIdx = token.indexOf("=");
			const key = token.substring(0, eqIdx);
			let value = token.substring(eqIdx + 1);
			// Strip quotes
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}

			switch (classifyAttrKey(key)) {
				case "id":
					cell.title = value;
					break;
				case "t": {
					const parsed = parseInt(value, 10);
					if (!Number.isNaN(parsed) && parsed > 0) {
						cell.timeoutMs = parsed;
					}
					break;
				}
				case "rst":
					cell.reset = value === "true" || value === "1";
					break;
			}
		}
	}

	// Code = everything between opening and closing fences
	cell.code = lines.slice(1, -1).join("\n");

	return cell;
}

/**
 * Parse atom-style eval input into executable cells.
 *
 * The input can contain:
 * - Fenced code blocks (```py ... ```)
 * - RESET directive (standalone line) to restart kernel before next cell
 * - Multiple cells concatenated
 */
export function parseEvalInput(input: string): ParsedEvalInput {
	// Normalize line endings
	const normalized = input.replace(/\r\n/g, "\n");

	// Split into blocks: fenced code blocks and RESET directives
	const fenceRegex = /```[^`]*```/g;
	const resetRegex = /^RESET\s*$/gm;

	const cells: ParsedEvalCell[] = [];
	let reset = false;
	let cellIndex = 0;

	// Track lines for RESET and fence blocks
	const lines = normalized.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Check for RESET directive
		if (/^RESET\s*$/.test(line.trim())) {
			reset = true;
			i++;
			continue;
		}

		// Check for fenced code block
		if (line.trimStart().startsWith("```")) {
			// Gather the entire fence block (may span multiple lines)
			const blockLines: string[] = [];
			blockLines.push(line);
			i++;
			let foundClosing = line.trimStart().startsWith("```") && !line.trimStart().startsWith("````");
			while (i < lines.length) {
				blockLines.push(lines[i]);
				if (lines[i].trimStart().startsWith("```") && !lines[i].trimStart().startsWith("````")) {
					foundClosing = true;
					i++;
					break;
				}
				i++;
			}
			if (foundClosing) {
				const block = blockLines.join("\n");
				const cell = parseFenceBlock(block, cellIndex++, reset);
				cells.push(cell);
				reset = false;
			}
			continue;
		}

		// Skip empty lines and non-fenced content between blocks
		i++;
	}

	return { cells };
}
