# pi-ipython

IPython kernel integration for the pi coding agent. Executes Python code cells
with rich display outputs via the Jupyter kernel gateway protocol.

The `eval` tool is automatically selected by the agent when it needs to debug
Python code, explore data, or generate visualizations. Execution always requires
user confirmation.

> **Inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi)** — the
> plugin ecosystem for the pi coding agent that this package belongs to.

## Architecture

**Hybrid Rust + TypeScript:**

- **Rust** — gateway lifecycle management (`gateway` crate), compiled to a
  single `pi-ipython-cli` CLI binary.
- **TypeScript** — pi extension, WebSocket Jupyter protocol, kernel session
  pool, TUI rendering, atom input parsing, Python runtime resolution.

## Prerequisites

- Python 3.8+ with `jupyter_kernel_gateway` and `ipykernel`:
  ```bash
  pip install jupyter_kernel_gateway ipykernel
  ```

## Development

```bash
# Build Rust binary + TypeScript
bun run build

# Build Rust only
bun run build:rs

# Build TypeScript only
bun run build:ts

# TypeScript check only
bun run check
```

## Testing

```bash
# Rust tests
cd crates && cargo test

# TypeScript tests (when added)
bun test
```
