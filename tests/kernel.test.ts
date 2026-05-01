/**
 * Tests for kernel.ts — pure-function tests only (no live kernel).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderKernelDisplay } from "../src/kernel.js";

describe("renderKernelDisplay", () => {
	it("returns empty output for empty data", () => {
		const result = renderKernelDisplay({});
		assert.equal(result.text, "");
		assert.deepEqual(result.outputs, []);
	});

	it("renders text/plain output", () => {
		const result = renderKernelDisplay({
			data: { "text/plain": "hello world" },
		});
		assert.equal(result.text, "hello world\n");
		assert.equal(result.outputs.length, 0);
	});

	it("renders image/png output", () => {
		const result = renderKernelDisplay({
			data: { "image/png": "iVBORw0KGgo=", "text/plain": "" },
		});
		assert.equal(result.outputs.length, 1);
		assert.equal(result.outputs[0].type, "image");
		if (result.outputs[0].type === "image") {
			assert.equal(result.outputs[0].mimeType, "image/png");
			assert.equal(result.outputs[0].data, "iVBORw0KGgo=");
		}
	});

	it("renders application/json output", () => {
		const result = renderKernelDisplay({
			data: { "application/json": { key: "value" } },
		});
		assert.equal(result.outputs.length, 1);
		assert.equal(result.outputs[0].type, "json");
	});

	it("prefers text/markdown over text/plain", () => {
		const result = renderKernelDisplay({
			data: { "text/markdown": "# Title", "text/plain": "plain text" },
		});
		assert.equal(result.text, "# Title\n");
		assert.ok(result.outputs.some((o) => o.type === "markdown"));
	});

	it("handles status events from custom MIME type", () => {
		const result = renderKernelDisplay({
			data: {
				"application/x-pi-ipython-status": {
					op: "read",
					path: "test.py",
					lines: 10,
				},
			},
		});
		assert.equal(result.text, "");
		assert.equal(result.outputs.length, 1);
		assert.equal(result.outputs[0].type, "status");
	});

	it("ensures text/plain ends with newline", () => {
		const result = renderKernelDisplay({
			data: { "text/plain": "no newline at end" },
		});
		assert.equal(result.text, "no newline at end\n");
	});

	it("preserves text/plain that already ends with newline", () => {
		const result = renderKernelDisplay({
			data: { "text/plain": "has newline\n" },
		});
		assert.equal(result.text, "has newline\n");
	});
});
