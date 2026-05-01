/**
 * Tests for executor.ts — pool management helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("executor", () => {
	it("shutdownAll handles empty pool gracefully", async () => {
		const { shutdownAll } = await import("../src/executor.js");
		// Should not throw with no kernels running
		await shutdownAll();
	});

	it("warmPythonEnvironment on missing gateway returns error", async () => {
		const { warmPythonEnvironment } = await import("../src/executor.js");
		// No gateway running - should return error, not throw
		const result = await warmPythonEnvironment(
			process.cwd(),
			"test-session",
			AbortSignal.timeout(100),
		);
		assert.equal(result.ok, false);
		assert.ok(typeof result.reason === "string", "should return a reason string");
	});
});
