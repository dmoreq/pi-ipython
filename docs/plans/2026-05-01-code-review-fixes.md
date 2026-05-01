# Code Review Fixes Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Fix all 14 issues identified in the pi-ipython code review (1 critical, 6 important, 7 minor).

**Architecture:** Each task is self-contained to a single file or small set of files. Tasks are ordered by priority (critical → important → minor). All tasks can be done independently except Task 2 (test infra) which is a prerequisite for Tasks that write tests.

**Tech Stack:** TypeScript (ESNext/Bun), Rust (edition 2021), Python 3.8+

**Test framework:** Node.js built-in `node:assert` (migrate from `console.assert`)

---

### Task 1: Fix timeout wiring in kernel.ts execute() — CRITICAL

**Files:**
- Modify: `src/kernel.ts` lines ~310-355

**Problem:** The `execute()` method has dead-code timeout handling:
- `finalizeWithClear` / `tempResolve` are assigned but never used
- The timeout calls `finalize()` (original, no timeout clear) — potential race condition
- The timeout does not wire into the `checkDone` completion mechanism properly

**Step 1: Read the current code to confirm the exact lines**

Read: `src/kernel.ts` lines 300-360

Expected: Identify the dead-code block around timeout setup.

**Step 2: Replace the timeout handling**

Replace this dead-code block (lines ~320-335):
```ts
// Handle timeout
if (options?.timeoutMs && options.timeoutMs > 0) {
  const timeoutId = setTimeout(() => {
    timedOut = true;
    cancelled = true;
    this.#interruptKernel().catch(() => {});
    finalize();
  }, options.timeoutMs);

  const originalFinalize = finalize;
  const finalizeWithClear = () => {
    clearTimeout(timeoutId);
    originalFinalize();
  };
  // Override finalize to clear timeout
  const tempResolve = resolve;
  // We can't easily override — use a wrapper
}
```

With:
```ts
// Handle timeout
let timeoutId: ReturnType<typeof setTimeout> | undefined;
if (options?.timeoutMs && options.timeoutMs > 0) {
  timeoutId = setTimeout(() => {
    timedOut = true;
    cancelled = true;
    this.#interruptKernel().catch(() => {});
    resolved = true;
    this.#messageHandlers.delete(msgId);
    this.#pendingExecutions.delete(msgId);
    resolve({ status, executionCount, error: errorResult, cancelled, timedOut });
  }, options.timeoutMs);
}
```

Then modify the existing `finalize` function (lines ~308-314) to clear the timeout:
```ts
const finalize = () => {
  if (resolved) return;
  resolved = true;
  if (timeoutId) clearTimeout(timeoutId);
  this.#messageHandlers.delete(msgId);
  this.#pendingExecutions.delete(msgId);
  resolve({ status, executionCount, error: errorResult, cancelled, timedOut });
};
```

**Step 3: Build to check for syntax errors**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: No TypeScript errors.

**Step 4: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "fix: properly wire timeout cancellation in kernel.execute()
  
Replace dead-code timeout handling with working implementation.
Timeout now correctly cancels execution via interruptKernel()
and clears the timeout timer on normal completion."
```

---

### Task 2: Set up test infrastructure (node:assert, fix smoke tests) — IMPORTANT

**Files:**
- Modify: `tests/parse.test.ts`

**Step 1: Rewrite parse.test.ts to use node:assert (throws on failure)**

Replace the current `console.assert`-based tests with `assert.strictEqual`:

```ts
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
    const input = "```py title=init t=60000\nimport pandas\n```\n\n```py title=analysis\nx=1\n```";
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
```

**Step 2: Run tests to verify they pass**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && node --test tests/parse.test.ts`

Expected: All 5 tests PASS.

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "test: migrate parse tests from console.assert to node:test
"
```

---

### Task 3: Add unit tests for kernel.ts (renderKernelDisplay, message encoding) — IMPORTANT

**Files:**
- Create: `tests/kernel.test.ts`
- Reference: `src/kernel.ts`

**Context:** The `renderKernelDisplay` function is a pure function that converts Jupyter display_data content into structured output. It's easy to unit test without a running kernel. Also add message encoding/decoding tests.

**Step 1: Create tests/kernel.test.ts**

```ts
/**
 * Tests for kernel.ts — pure-function tests only (no live kernel).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderKernelDisplay, PythonKernel } from "../src/kernel.js";

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
        "application/x-pi-ipython-status": { op: "read", path: "test.py", lines: 10 },
      },
    });
    assert.equal(result.text, "");
    assert.equal(result.outputs.length, 1);
    assert.equal(result.outputs[0].type, "status");
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && node --test tests/kernel.test.ts`

Expected: All 6 tests PASS.

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "test: add kernel.ts pure-function tests for renderKernelDisplay
"
```

---

### Task 4: Add unit tests for executor.ts (session pool eviction) — IMPORTANT

**Files:**
- Create: `tests/executor.test.ts`
- Reference: `src/executor.ts`

**Context:** The LRU session eviction (`findOldestSession`, `evictSession`) and cleanup logic can be tested by inspecting internal state. Since the module uses module-level state, tests should be careful about isolation.

**Step 1: Create tests/executor.test.ts**

```ts
/**
 * Tests for executor.ts — pool management and execution helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Note: Full integration tests require a running gateway.
// These tests cover the pure-logic helpers that don't need a kernel.

describe("executor pure helpers", () => {
  // The findOldestSession, evictSession, and cleanupIdleSessions
  // are not exported. We test them via the public API: shutdownAll
  // and warmPythonEnvironment mock-friendly interface.

  it("shutdownAll handles empty pool gracefully", async () => {
    // Import dynamically to get fresh module state
    const { shutdownAll } = await import("../src/executor.js");
    // Should not throw with no kernels running
    await shutdownAll();
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && node --test tests/executor.test.ts`

Expected: 1 test PASS.

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "test: add executor.ts baseline test
"
```

---

### Task 5: Add unit tests for runtime.ts (Python resolution, env filtering) — IMPORTANT

**Files:**
- Create: `tests/runtime.test.ts`
- Reference: `src/runtime.ts`

**Step 1: Create tests/runtime.test.ts**

```ts
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
});
```

**Step 2: Run tests**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && node --test tests/runtime.test.ts`

Expected: All 4 tests PASS.

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "test: add runtime.ts env filtering tests
"
```

---

### Task 6: Remove or re-purpose types.ts — IMPORTANT

**Files:**
- Modify: `src/types.ts`

**Options:**
A. Remove the file entirely
B. Re-export types from `@oh-my-pi/pi` as documentation

**Recommendation:** Option B — keep it as a documentation aid but re-export from the real package so it stays in sync.

**Step 1: Replace types.ts content**

Replace the entire file with re-exports from `@oh-my-pi/pi`:

```ts
/**
 * Re-exported pi extension types from @oh-my-pi/pi.
 *
 * These mirror the pi SDK's extension interfaces.
 * Import from here instead of using @ts-nocheck.
 */
export type {
  PiContext,
  PiExtension,
  PiToolDefinition,
  PiToolResult,
} from "@oh-my-pi/pi";
```

**Step 2: Build to check**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: Either passes, or we learn that `@oh-my-pi/pi` doesn't export these exact types, in which case Option A (delete) is the fallback.

**Step 3: If Option A (delete) is needed:**

Delete the file and remove it from git tracking.

**Step 4: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "refactor: replace types.ts with re-exports from @oh-my-pi/pi
"
```

---

### Task 7: Fix prelude find() docstring (remove false .gitignore claim) — IMPORTANT

**Files:**
- Modify: `skills/eval/SKILL.md`
- Modify: `python/prelude.py`

**Step 1: Fix the docstring in prelude.py**

Change the `find` function's docstring line:
```python
def find(pattern: str, base_dir: str | Path = ".", *, gitignore: bool = True):
    """Find files matching a glob pattern. Honors .gitignore when gitignore=True."""
```
To:
```python
def find(pattern: str, base_dir: str | Path = ".", *, gitignore: bool = True):
    """Find files matching a glob pattern. The gitignore parameter is reserved for future use."""
```

**Step 2: Fix the eval skill docs**

In `skills/eval/SKILL.md`, change the `find` row in the prelude helpers table from:
```
| `find(pattern, base_dir=".")` | Glob file search (honors .gitignore) |
```
To:
```
| `find(pattern, base_dir=".")` | Glob file search |
```

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "docs: correct prelude find() docstring — .gitignore not yet implemented
"
```

---

### Task 8: Wrap TUI rendering in try-catch — IMPORTANT

**Files:**
- Modify: `src/pi-ipython.ts`

**Step 1: Add try-catch around renderResult**

Wrap the `renderResult` method body in a try-catch:

```ts
renderResult(result, options, theme, context) {
  try {
    const container = new Container("vertical", 0);
    // ... existing code ...
    return container;
  } catch (err) {
    return new Text(
      theme.fg("error", `[pi-ipython] TUI render error: ${err}`),
      0, 0,
    );
  }
}
```

**Step 2: Also wrap renderCall for safety**

```ts
renderCall(args, theme, context) {
  try {
    const input = String(args.input ?? "");
    const firstLine = input.split("\n")[0] || "(empty)";
    return new Text(`eval: ${firstLine}`, 0, 0);
  } catch (err) {
    return new Text(`eval: (render error)`, 0, 0);
  }
}
```

**Step 3: Build to check**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: No TypeScript errors.

**Step 4: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "fix: wrap TUI render methods in try-catch for resilience
"
```

---

### Task 9: Add depth limit to resolvePythonRuntime .venv walk — IMPORTANT

**Files:**
- Modify: `src/runtime.ts` (~line 97 area)

**Step 1: Add max depth constant and modify the loop**

Add a constant near the walk:
```ts
const MAX_VENV_WALK_DEPTH = 20;
```

Modify the loop to track depth:
```ts
// Walk up from cwd looking for .venv
let dir = cwd;
let depth = 0;
while (dir !== path.dirname(dir) && depth < MAX_VENV_WALK_DEPTH) {
  const venvDir = path.join(dir, ".venv");
  // ... existing check ...
  dir = path.dirname(dir);
  depth++;
}
```

**Step 2: Build to check**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: No errors.

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "fix: limit .venv directory walk depth to 20 levels
"
```

---

### Task 10: Handle execute_input message in kernel router — MINOR

**Files:**
- Modify: `src/kernel.ts`

**Step 1: Add execute_input case to the message handler**

In the `#messageHandlers.set` callback, add a case for `execute_input`:

```ts
case "execute_input": {
  // Log which code is being executed (for progress tracking)
  if (options?.onChunk) {
    const execCode = String(response.content.code ?? "").trim();
    const shortCode = execCode.slice(0, 60).replace(/\n/g, " ");
    await options.onChunk(`  [executing: ${shortCode}${execCode.length > 60 ? "..." : ""}]\n`);
  }
  break;
}
```

**Step 2: Build to check**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: No errors.

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "feat: add execute_input handler for progress visibility
"
```

---

### Task 11: Detect terminal width instead of hardcoded 80 — MINOR

**Files:**
- Modify: `src/pi-ipython.ts`

**Step 1: Determine terminal width**

Replace:
```ts
const MAX_WIDTH_CELLS = 80;
```
With:
```ts
const MAX_WIDTH_CELLS = (typeof process !== "undefined" && process.stdout?.columns)
  ? Math.min(process.stdout.columns, 120)
  : 80;
```

This uses `process.stdout.columns` if available (most terminals), caps at 120 to avoid overly wide images, and falls back to 80.

**Step 2: Build to check**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: No errors.

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "feat: detect terminal width for image rendering instead of hardcoded 80
"
```

---

### Task 12: Remove unused notebook() from prelude — MINOR

**Files:**
- Modify: `python/prelude.py`

**Step 1: Remove the notebook() function**

Delete the `notebook()` function at the end of prelude.py (the `__pi_ipython_prelude_loaded__` guard protects against double-execution; removing this function is safe).

**Step 2: Test that prelude still works**

Create a quick smoke check to validate the prelude code is syntactically valid Python:
Run: `python3 -c "exec(open('python/prelude.py').read().split('if \"__pi_ipython_prelude_loaded__\"')[1]); print('Prelude syntax OK')"`

Expected: "Prelude syntax OK".

**Step 3: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "refactor: remove unused notebook() function from prelude
"
```

---

### Task 13: Remove @ts-nocheck with proper type declarations — MINOR

**Files:**
- Modify: `src/pi-ipython.ts`

**Step 1: Create ambient type declarations**

Create (or check if exists) `src/pi-env.d.ts`:

```ts
/**
 * Ambient type declarations for pi's runtime globals.
 * These are injected by the pi agent host process.
 */
declare module "@mariozechner/pi-tui" {
  export class Container { constructor(layout: "vertical" | "horizontal", padding: number); addChild(child: unknown): void; }
  export class Image { constructor(base64: string, mime: string, opts?: Record<string, unknown>, layout?: Record<string, unknown>); }
  export class Text { constructor(text: string, x: number, y: number); }
  export function getCapabilities(): { images?: boolean };
}

// The pi.registerTool / pi.on APIs are injected via the
// function parameter `pi` — no module declaration needed.
```

**Step 2: Remove `// @ts-nocheck` from pi-ipython.ts**

Delete line 2 (`// @ts-nocheck - runs inside pi's module context...`).

**Step 3: Build to check for new errors**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: Zero TypeScript errors.

**Step 4: Commit**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "refactor: replace @ts-nocheck with ambient type declarations
"
```

---

### Task 14: Run all tests and final verification — VERIFICATION

**Step 1: Run all unit tests**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && node --test tests/`

Expected: All tests PASS.

**Step 2: Run TypeScript check**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run check`

Expected: Zero errors.

**Step 3: Run Rust tests**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && cargo test --manifest-path crates/gateway/Cargo.toml`

Expected: All Rust unit tests PASS.

**Step 4: Build full project**

Run: `cd /Users/quy.doan/Workspace/personal/pi-ipython && bun run build`

Expected: Build completes successfully.

**Step 5: Final commit with all fixes**

```bash
cd /Users/quy.doan/Workspace/personal/pi-ipython && git add -A && git commit -m "chore: final verification — all tests pass, build clean
"
```

---

## Summary of Tasks

| # | Priority | Task | File(s) | Est. Time |
|---|----------|------|---------|-----------|
| 1 | **Critical** | Fix timeout wiring in kernel.ts execute() | `src/kernel.ts` | 5 min |
| 2 | Important | Set up test infra with node:assert | `tests/parse.test.ts` | 5 min |
| 3 | Important | Add kernel.ts unit tests | `tests/kernel.test.ts` | 5 min |
| 4 | Important | Add executor.ts baseline test | `tests/executor.test.ts` | 3 min |
| 5 | Important | Add runtime.ts env filter tests | `tests/runtime.test.ts` | 5 min |
| 6 | Important | Remove/re-purpose types.ts | `src/types.ts` | 3 min |
| 7 | Important | Fix prelude find() docstring | `python/prelude.py`, `skills/eval/SKILL.md` | 3 min |
| 8 | Important | Wrap TUI rendering in try-catch | `src/pi-ipython.ts` | 3 min |
| 9 | Important | Limit .venv directory walk depth | `src/runtime.ts` | 3 min |
| 10 | Minor | Add execute_input message handler | `src/kernel.ts` | 3 min |
| 11 | Minor | Detect terminal width | `src/pi-ipython.ts` | 3 min |
| 12 | Minor | Remove unused notebook() from prelude | `python/prelude.py` | 2 min |
| 13 | Minor | Replace @ts-nocheck with type decls | `src/pi-ipython.ts`, `src/pi-env.d.ts` | 5 min |
| 14 | Verification | Run all tests + build | — | 5 min |
