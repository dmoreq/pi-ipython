# pi-ipython prelude helpers
# Injected into every IPython kernel at startup.
# Provides convenience functions for file I/O, process execution, and display.

from __future__ import annotations
if "__pi_ipython_prelude_loaded__" not in globals():
    __pi_ipython_prelude_loaded__ = True
    from pathlib import Path
    import os, re, json, shutil, subprocess
    from datetime import datetime
    from IPython.display import display as _ipy_display, JSON

    _PRESENTABLE_REPRS = (
        "_repr_mimebundle_",
        "_repr_html_",
        "_repr_json_",
        "_repr_markdown_",
        "_repr_png_",
        "_repr_jpeg_",
        "_repr_svg_",
        "_repr_latex_",
    )

    def display(value):
        """Render a value. Wraps plain dict/list values as interactive JSON."""
        if any(hasattr(value, attr) for attr in _PRESENTABLE_REPRS):
            _ipy_display(value)
            return
        if isinstance(value, (dict, list, tuple)):
            try:
                _ipy_display(JSON(value))
                return
            except Exception:
                pass
        _ipy_display(value)

    def _emit_status(op: str, **data):
        """Emit structured status event for TUI rendering."""
        _ipy_display({"application/x-pi-ipython-status": {"op": op, **data}}, raw=True)

    def env(key: str | None = None, value: str | None = None):
        """Get/set environment variables."""
        if key is None:
            items = dict(sorted(os.environ.items()))
            _emit_status("env", count=len(items), keys=list(items.keys())[:20])
            return items
        if value is not None:
            os.environ[key] = value
            _emit_status("env", key=key, value=value, action="set")
            return value
        val = os.environ.get(key)
        _emit_status("env", key=key, value=val, action="get")
        return val

    def read(path: str | Path, *, offset: int = 1, limit: int | None = None) -> str:
        """Read file contents. offset/limit are 1-indexed line numbers."""
        p = Path(path)
        data = p.read_text(encoding="utf-8")
        lines = data.splitlines(keepends=True)
        if offset > 1 or limit is not None:
            start = max(0, offset - 1)
            end = start + limit if limit else len(lines)
            lines = lines[start:end]
        _emit_status("read", path=str(p), lines=len(lines))
        return "".join(lines)

    def write(path: str | Path, content: str):
        """Write content to a file (overwrites)."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        _emit_status("write", path=str(p), bytes=len(content.encode("utf-8")))

    def find(pattern: str, base_dir: str | Path = ".", *, gitignore: bool = True):
        """Find files matching a glob pattern. The gitignore parameter is reserved for future use."""
        base = Path(base_dir)
        matches = [str(p) for p in base.rglob(pattern)]
        _emit_status("find", pattern=pattern, count=len(matches))
        return matches

    def grep(pattern: str, base_dir: str | Path = ".", *, max_matches: int = 50):
        """Search for pattern in files. Returns matching lines."""
        import subprocess
        try:
            result = subprocess.run(
                ["rg", "--line-number", "--max-count", str(max_matches), pattern, str(base_dir)],
                capture_output=True, text=True, timeout=10
            )
            lines = result.stdout.splitlines()
            _emit_status("grep", pattern=pattern, count=len(lines))
            return lines
        except (subprocess.TimeoutExpired, FileNotFoundError):
            _emit_status("grep", pattern=pattern, count=-1, error="rg not available or timeout")
            return []

    def run(cmd: str, *, timeout: int = 30, capture: bool = True):
        """Run a shell command and return output."""
        import subprocess
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=capture, text=True, timeout=timeout
            )
            output = []
            if result.stdout:
                output.append(result.stdout)
            if result.stderr:
                output.append(result.stderr)
            _emit_status("run", cmd=cmd, exit_code=result.returncode)
            return "".join(output)
        except subprocess.TimeoutExpired:
            _emit_status("run", cmd=cmd, error="timeout")
            return f"[timeout] Command timed out after {timeout}s"
        except Exception as e:
            _emit_status("run", cmd=cmd, error=str(e))
            return f"[error] {e}"

    def tree(directory: str | Path = ".", *, max_depth: int = 3):
        """Show directory tree structure."""
        base = Path(directory)
        result = []
        for i, p in enumerate(base.rglob("*")):
            if p.is_dir() or i >= 200:
                continue
            rel = p.relative_to(base)
            depth = len(rel.parts)
            if depth > max_depth:
                continue
            indent = "  " * (depth - 1)
            marker = "📄" if p.is_file() else "📁"
            result.append(f"{indent}{marker} {rel.name}")
        _emit_status("tree", directory=str(base), files=len(result))
        return "\n".join(result) if result else "(empty)"

    def stat(path: str | Path):
        """Get file/directory metadata."""
        p = Path(path)
        if not p.exists():
            _emit_status("stat", path=str(p), exists=False)
            return {"exists": False}
        info = {
            "exists": True,
            "type": "directory" if p.is_dir() else "file",
            "size": p.stat().st_size,
            "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(),
        }
        _emit_status("stat", path=str(p), **info)
        return info

    def diff(file1: str | Path, file2: str | Path):
        """Show diff between two files."""
        import subprocess
        try:
            result = subprocess.run(
                ["diff", "-u", str(file1), str(file2)],
                capture_output=True, text=True, timeout=10
            )
            _emit_status("diff", file1=str(file1), file2=str(file2))
            return result.stdout or "(no differences)"
        except (subprocess.TimeoutExpired, FileNotFoundError):
            _emit_status("diff", file1=str(file1), file2=str(file2), error="diff not available")
            return "[error] diff command not available"

    def output(value):
        """Explicitly mark a value as the cell's final output."""
        display(value)
