/**
 * pi-ipython build script.
 *
 * 1. Build Rust crates → pi-ipython-cli binary
 * 2. Copy binary to bin/
 * 3. Compile TypeScript → dist/
 *
 * Compatible with both Node.js and Bun runtimes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const ROOT = import.meta.dir
	? import.meta.dir
	: path.dirname(new URL(import.meta.url).pathname);
const CRATES_DIR = path.join(ROOT, "crates");
const BIN_DIR = path.join(ROOT, "bin");
const DIST_DIR = path.join(ROOT, "dist");
const TARGET_DIR = path.join(ROOT, "target");

function run(cmd: string, opts?: { cwd?: string }): { exitCode: number; stdout: string; stderr: string } {
	try {
		const stdout = execSync(cmd, {
			cwd: opts?.cwd ?? ROOT,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { exitCode: 0, stdout, stderr: "" };
	} catch (err: unknown) {
		const error = err as { status?: number; stdout?: string; stderr?: string; message?: string };
		return {
			exitCode: error.status ?? 1,
			stdout: error.stdout?.toString() ?? "",
			stderr: error.stderr?.toString() ?? error.message ?? "",
		};
	}
}

async function buildRust(): Promise<void> {
	console.log("[build] Building Rust crates...");

	const cargoManifest = path.join(CRATES_DIR, "pi-ipython-cli", "Cargo.toml");
	const result = run(`cargo build --release --manifest-path "${cargoManifest}"`);

	if (result.exitCode !== 0) {
		console.error("[build] Rust build failed:", result.stderr);
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

	// Run tsc — use npx for portability
	const result = run(`npx tsc --project "${path.join(ROOT, "tsconfig.json")}"`);

	if (result.exitCode !== 0) {
		console.error("[build] TypeScript build failed:", result.stderr);
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

	if (!skipRust) {
		try {
			await buildRust();
		} catch (err) {
			console.warn("[build] Rust build skipped (not available?):", err instanceof Error ? err.message : String(err));
		}
	}
	if (!skipTs) await buildTypeScript();

	console.log("[build] pi-ipython build complete");
}

main().catch((err) => {
	console.error("[build] Build failed:", err);
	process.exit(1);
});
