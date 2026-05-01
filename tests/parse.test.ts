/**
 * Tests for parse.ts using node:assert.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEvalInput } from "../src/parse.js";

describe("parseEvalInput", () => {
	it("parses a single fenced code block", () => {
		const result = parseEvalInput("```py\nprint('hello')\n```");
		assert.equal(result.cells.length, 1);
		assert.equal(result.cells[0].code.trim(), "print('hello')");
	});

	it("parses multi-cell with title and timeout", () => {
		const input =
			"```py title=init t=60000\nimport pandas\n```\n\n```py title=analysis\nx=1\n```";
		const result = parseEvalInput(input);
		assert.equal(result.cells.length, 2);
		assert.equal(result.cells[0].title, "init");
		assert.equal(result.cells[0].timeoutMs, 60000);
		assert.equal(result.cells[1].title, "analysis");
	});

	it("handles RESET directive", () => {
		const result = parseEvalInput("RESET\n```py\nx=1\n```");
		assert.equal(result.cells.length, 1);
		assert.equal(result.cells[0].reset, true);
	});

	it("returns empty cells for non-fenced input", () => {
		const result = parseEvalInput("just some text\nwith no fence blocks");
		assert.equal(result.cells.length, 0);
	});

	it("recognizes ipython alias", () => {
		const result = parseEvalInput("```ipython\nx = 42\n```");
		assert.equal(result.cells.length, 1);
		assert.equal(result.cells[0].language, "python");
	});
});
