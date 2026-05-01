# Changelog

## [Unreleased]

### Added

- **Inline image display** — matplotlib/seaborn/plotly figures rendered directly in session via pi-tui `Image` component (adopted from pi-poster technology)
- **`tool_call` interceptor** — requires user confirmation before Python execution
- **Eval skill triggers** — agent auto-selects `eval` for Python debugging, data exploration, visualization

### Changed

- **Removed `jupyter-protocol` Rust crate** — dead code; `kernel.ts` implements its own WebSocket framing inline
- **Removed `kernel-pool` Rust crate** — duplicated pool management already handled by the TypeScript executor
- **Removed `pool-*` and `protocol-*` CLI subcommands** — no longer needed
- **Removed `src/bindings/pool.ts` and `src/bindings/protocol.ts`** — unused bindings
- **Simplified architecture** — only `gateway` crate + `pi-ipython-cli` binary remain on the Rust side
- **`renderResult` upgraded** — uses `Container`/`Image`/`Text` from `@mariozechner/pi-tui` for rich TUI output
- **`execute()` captures `displayOutputs`** — image data passed through result details for rendering

### Added (initial)

- Initial pi-ipython package with Python kernel integration
- Rust crates: `gateway` (process lifecycle), `pi-ipython-cli` (CLI binary)
- `PythonKernel` class with WebSocket Jupyter protocol (execute_request/stream/display_data/error handling)
- Kernel session pool with LRU eviction (capacity 4, 5min idle timeout)
- Atom-style eval input parser (fenced code blocks with title/timeout/reset metadata)
- Python prelude helpers: read(), write(), find(), grep(), run(), env(), tree(), stat(), diff(), display()
- TypeScript bindings for CLI subcommands
- gateway-start auto port allocation and health check with exponential backoff
- `allowArbitraryExtensions` TypeScript support for `.ts` import resolution
