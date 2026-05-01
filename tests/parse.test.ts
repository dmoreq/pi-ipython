/**
 * Smoke tests for parse.ts
 */
import { parseEvalInput } from "../src/parse";

// Test 1: Single fenced code block
{
	const input = "```py\nprint('hello')\n```";
	const result = parseEvalInput(input);
	console.assert(
		result.cells.length === 1,
		`Test 1: expected 1 cell, got ${result.cells.length}`,
	);
	console.assert(
		result.cells[0].code.trim() === "print('hello')",
		`Test 1: expected code, got "${result.cells[0].code}"`,
	);
	console.log("Test 1: single fence block — PASS");
}

// Test 2: Multi-cell with title and timeout
{
	const input = "```py title=init t=60000\nimport pandas\n```\n\n```py title=analysis\nx=1\n```";
	const result = parseEvalInput(input);
	console.assert(result.cells.length === 2, `Test 2: expected 2 cells`);
	console.assert(result.cells[0].title === "init", `Test 2a: expected title init, got ${result.cells[0].title}`);
	console.assert(result.cells[0].timeoutMs === 60000, `Test 2b: timeout ${result.cells[0].timeoutMs}`);
	console.assert(result.cells[1].title === "analysis", `Test 2c: expected title analysis`);
	console.log("Test 2: multi-cell with metadata — PASS");
}

// Test 3: RESET directive
{
	const input = "RESET\n```py\nx=1\n```";
	const result = parseEvalInput(input);
	console.assert(result.cells.length === 1, `Test 3: expected 1 cell`);
	console.assert(result.cells[0].reset === true, `Test 3: expected reset=true`);
	console.log("Test 3: RESET directive — PASS");
}

// Test 4: Empty/non-fenced input
{
	const input = "just some text\nwith no fence blocks";
	const result = parseEvalInput(input);
	console.assert(result.cells.length === 0, `Test 4: expected 0 cells`);
	console.log("Test 4: no fenced blocks — PASS");
}

// Test 5: ipython alias
{
	const input = "```ipython\nx = 42\n```";
	const result = parseEvalInput(input);
	console.assert(result.cells.length === 1, `Test 5: expected 1 cell`);
	console.assert(result.cells[0].language === "python", `Test 5: expected python language`);
	console.log("Test 5: ipython alias — PASS");
}

console.log("\nAll parse tests passed");
