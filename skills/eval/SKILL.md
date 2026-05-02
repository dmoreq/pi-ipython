---
name: eval
description: Python Code Execution via IPython kernel — run code cells for debugging, data exploration, and visualization.
---

# eval — Python Code Execution (IPython Kernel)

The `eval` tool executes Python code in an IPython kernel with rich display
support (DataFrames, matplotlib figures, JSON). The agent automatically selects
this tool when it needs to debug Python code, explore datasets, or generate
visualizations.

## When the Agent Uses This Tool

The agent should use `eval` when:
- **Debugging Python code** — testing snippets, inspecting state, reproducing errors
- **Data exploration** — loading CSVs/JSON, running pandas/numpy operations, exploring datasets
- **Data visualization** — matplotlib/seaborn/plotly figures, charts, plots
- **Quick computations** — one-off calculations that benefit from Python's ecosystem
- **File analysis** — using prelude helpers (read, grep, find, stat) from Python

## Basic Usage

Wrap Python code in fenced blocks with the `py` language tag:

````
```py
print("hello world")
```
````

## Multiple Cells

You can include multiple code cell blocks. Each cell is executed sequentially
in the same kernel session (state is shared between cells):

````
```py title=imports
import pandas as pd
import numpy as np
```

```py title=load-data
df = pd.read_csv("data.csv")
df.head()
```

```py title=analysis
df.describe()
```
````

## Cell Options

Add options in the fence info string after the language tag:

| Option | Format | Description |
|--------|--------|-------------|
| `title=` | `title=my-cell` | Label the cell for display |
| `t=` | `t=60000` | Timeout in milliseconds (default: 30000) |
| `rst` | `rst` or `rst=true` | Reset (restart) the kernel before this cell |

````
```py title=heavy-compute t=120000 rst
# This cell has a 2-minute timeout and resets the kernel first
result = heavy_computation()
```
````

## RESET Directive

A standalone `RESET` line before a fenced block forces the kernel to restart
before executing that cell:

````
RESET
```py
# Fresh kernel state
x = 1
```
````

## Available Prelude Helpers

These Python functions are injected into every kernel:

| Helper | Description |
|--------|-------------|
| `read(path, offset=1, limit=None)` | Read file contents with line range |
| `write(path, content)` | Write content to a file |
| `find(pattern, base_dir=".")` | Glob file search |
| `grep(pattern, base_dir=".", max_matches=50)` | Regex file search (uses ripgrep) |
| `run(cmd, timeout=30)` | Run a shell command |
| `env(key=None, value=None)` | Get/set environment variables |
| `tree(directory=".", max_depth=3)` | Show directory tree |
| `stat(path)` | File/directory metadata |
| `diff(file1, file2)` | Show diff between two files |
| `display(value)` | Rich display (JSON trees, images, markdown) |
| `output(value)` | Mark a value as the cell's final output |

### Example: File Operations

```py
content = read("src/main.py", offset=1, limit=50)
print(f"File has {len(content.splitlines())} lines")
```

```py
matches = grep("TODO", "src/")
for m in matches[:5]:
    print(m)
```

## Rich Display

- `matplotlib` figures display as inline PNG images
- `pandas` DataFrames display as interactive JSON trees
- `display(dict)` renders nested objects with expandable trees
- Markdown output via `IPython.display.Markdown`

## Libraries Available

Most common Python packages are available if installed in your environment:
- `pandas`, `numpy`, `scipy`, `scikit-learn`
- `matplotlib`, `seaborn`, `plotly`
- `requests`, `httpx`, `aiohttp`
- `sqlite3`, `psycopg2`, `sqlalchemy`
- `rich`, `tqdm`, `pydantic`

## Error Handling

If a cell throws an exception, the full traceback is shown. The kernel state
is preserved so you can inspect variables in subsequent cells.

## Best Practices

1. **One logical operation per cell** — import in one cell, compute in the next
2. **Use `title=`** to label cells for readability
3. **Set `t=` timeout** for long-running computations
4. **Use `RESET`** when you need a clean state (memory leaks, stale state)
5. **Prefer prelude helpers** (`read()`/`write()`) over raw file I/O
6. **Use `display()`** for rich output instead of `print()` for dicts/lists
