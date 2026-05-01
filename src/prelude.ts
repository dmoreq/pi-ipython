/**
 * Python prelude script embedder.
 *
 * Loads the prelude.py file at build time and exposes it as a string
 * that can be injected into the Python kernel at startup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The Python prelude script, loaded once at module init. */
let _prelude: string | null = null;

/**
 * Get the Python prelude script, loading it on first access.
 */
export function getPrelude(): string {
	if (_prelude === null) {
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		const preludePath = path.join(__dirname, "..", "python", "prelude.py");
		_prelude = fs.readFileSync(preludePath, "utf-8");
	}
	return _prelude;
}
