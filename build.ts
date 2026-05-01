/**
 * pi-ipython build script.
 *
 * 1. Build Rust crates → pi-ipython-cli binary
 * 2. Copy binary to bin/
 * 3. Compile TypeScript → dist/
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { $ } from "bun";

const ROOT = import.meta.dir;
const CRATES_DIR = path.join(ROOT, "crates");
const BIN_DIR = path.join(ROOT, "bin");
const DIST_DIR = path.join(ROOT, "dist");
const TARGET_DIR = path.join(ROOT, "target");

async function buildRust(): Promise<void> {
	console.log("[build] Building Rust crates...");

	const result = await $`cargo build --release --manifest-path ${path.join(CRATES_DIR, "pi-ipython-cli", "Cargo.toml")}`
		.cwd(ROOT)
		.quiet()
		.nothrow();

	if (result.exitCode !== 0) {
		console.error("[build] Rust build failed:", result.stderr.toString());
		process.exit(1);
	}

	// Determine platform binary name
	const platform = os.platform();
	const binaryName = platform === "win32" ? "pi-ipython-cli.exe" : "pi-ipython-cli";
	const releaseBinary = path.join(TARGET_DIR, "release", binaryName);

	if (!fs.existsSync(releaseBinary)) {
		throw new Error(`Rust build did not produce binary at ${releaseBinary}`);
	}

	// Copy to bin/
	await fs.promises.mkdir(BIN_DIR, { recursive: true });
	const destBinary = path.join(BIN_DIR, binaryName);
	await fs.promises.copyFile(releaseBinary, destBinary);
	await fs.promises.chmod(destBinary, 0o755);

	console.log(`[build] Binary copied to ${destBinary}`);
}

async function buildTypeScript(): Promise<void> {
	console.log("[build] Compiling TypeScript...");

	// Clean dist
	await fs.promises.rm(DIST_DIR, { recursive: true, force: true });

	// Run tsc
	const result = await $`bunx tsc --project ${path.join(ROOT, "tsconfig.json")}`
		.cwd(ROOT)
		.quiet()
		.nothrow();

	if (result.exitCode !== 0) {
		console.error("[build] TypeScript build failed:", result.stderr.toString());
		process.exit(1);
	}

	// Copy prelude.py to dist
	const preludeSrc = path.join(ROOT, "python", "prelude.py");
	if (fs.existsSync(preludeSrc)) {
		const preludeDist = path.join(DIST_DIR, "python", "prelude.py");
		await fs.promises.mkdir(path.dirname(preludeDist), { recursive: true });
		await fs.promises.copyFile(preludeSrc, preludeDist);
	}

	console.log("[build] TypeScript compiled to dist/");
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const skipRust = args.includes("--skip-rust");
	const skipTs = args.includes("--skip-ts");

	if (!skipRust) await buildRust();
	if (!skipTs) await buildTypeScript();

	console.log("[build] pi-ipython build complete");
}

main().catch((err) => {
	console.error("[build] Build failed:", err);
	process.exit(1);
});
