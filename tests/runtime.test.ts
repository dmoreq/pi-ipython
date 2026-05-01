/**
 * Tests for runtime.ts — pure-function tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterEnv } from "../src/runtime.js";

describe("filterEnv", () => {
	it("keeps allowed env vars", () => {
		const result = filterEnv({ PATH: "/usr/bin", HOME: "/home/user" });
		assert.equal(result.PATH, "/usr/bin");
		assert.equal(result.HOME, "/home/user");
	});

	it("filters out unknown env vars", () => {
		const result = filterEnv({
			PATH: "/usr/bin",
			SECRET_API_KEY: "topsecret",
			MY_CUSTOM_VAR: "value",
		});
		assert.equal(result.PATH, "/usr/bin");
		assert.equal(result["SECRET_API_KEY"], undefined);
		assert.equal(result["MY_CUSTOM_VAR"], undefined);
	});

	it("skips undefined values", () => {
		const result = filterEnv({ PATH: "/usr/bin", HOME: undefined });
		assert.equal(result.PATH, "/usr/bin");
		assert.equal(result.HOME, undefined);
	});

	it("keeps PI_PYTHON_GATEWAY_URL and TOKEN", () => {
		const result = filterEnv({
			PI_PYTHON_GATEWAY_URL: "http://localhost:8888",
			PI_PYTHON_GATEWAY_TOKEN: "abc123",
		});
		assert.equal(result.PI_PYTHON_GATEWAY_URL, "http://localhost:8888");
		assert.equal(result.PI_PYTHON_GATEWAY_TOKEN, "abc123");
	});

	it("returns empty object for empty input", () => {
		const result = filterEnv({});
		assert.deepEqual(result, {});
	});

	it("preserves VIRTUAL_ENV and CONDA_PREFIX", () => {
		const result = filterEnv({
			VIRTUAL_ENV: "/path/to/venv",
			CONDA_PREFIX: "/path/to/conda",
		});
		assert.equal(result.VIRTUAL_ENV, "/path/to/venv");
		assert.equal(result.CONDA_PREFIX, "/path/to/conda");
	});
});
