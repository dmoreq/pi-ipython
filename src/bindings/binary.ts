/**
 * Binary resolution helper for the pi-ipython-cli CLI.
 *
 * Locates the compiled Rust binary in dev or production install.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function resolveBinary(): string {
	const binaryName = process.platform === "win32" ? "pi-ipython-cli.exe" : "pi-ipython-cli";
	const dir = path.dirname(fileURLToPath(import.meta.url));

	// Search order: bin/ next to src/, bin/ at package root
	const candidates = [
		path.join(dir, "..", "bin", binaryName),
		path.join(dir, "..", "..", "bin", binaryName),
	];

	for (const candidate of candidates) {
		try {
			if (fs.statSync(candidate).size > 0) return candidate;
		} catch {
			// file doesn't exist, try next
		}
	}

	throw new Error(
		`pi-ipython-cli binary not found. Searched: ${candidates.join(", ")}. Run: bun run build`,
	);
}

export { resolveBinary };
