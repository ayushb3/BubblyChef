"""Guard: every text-mode file read/write names its encoding explicitly.

CI runs on Ubuntu, where `locale.getpreferredencoding()` is UTF-8, so a
`Path.read_text()` with no `encoding=` reads emoji-bearing data files
perfectly and the suite goes green. The same call on Windows defaults to
the cp1252 locale encoding and dies with
`UnicodeDecodeError: 'charmap' codec can't decode byte ...`.

That asymmetry is the whole problem: the platform that catches this bug is
not the platform CI runs on, so nothing structurally prevents it from being
reintroduced. `tests/test_issue_300_catalog_emoji.py` loaded
`pantry_catalog.json` (305 non-ASCII bytes) without an encoding and failed
5/5 on Windows while passing in CI.

Ruff can express this as PLW1514, but in the pinned ruff (>=0.15,<0.16) that
rule is preview-only, and enabling preview surfaces 8 unrelated findings on
existing code — the same rule-set churn issue #129 tracks. Hence a test.

Reproduce the Windows failure on Linux/macOS:

    cd ai-service && LC_ALL=C PYTHONUTF8=0 python -m pytest -q
"""

from __future__ import annotations

import ast
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Python trees that ship or run as part of this project. Roots that don't
# exist are skipped: the Docker image packages only `bubbly_chef`.
_SCAN_ROOTS = (
    _REPO_ROOT / "ai-service" / "bubbly_chef",
    _REPO_ROOT / "ai-service" / "tests",
    _REPO_ROOT / "ai-service" / "scripts",
    _REPO_ROOT / "scripts",
)

_SKIP_DIRS = {".venv", "venv", "node_modules", "__pycache__", ".git"}

# Path methods that are always text-mode and always take `encoding=`.
_TEXT_METHODS = {"read_text", "write_text"}


def _python_files() -> list[Path]:
    files: list[Path] = []
    for root in _SCAN_ROOTS:
        if not root.is_dir():
            continue
        for path in root.rglob("*.py"):
            if _SKIP_DIRS.isdisjoint(path.parts):
                files.append(path)
    return files


def _mode_arg(call: ast.Call, position: int) -> str | None:
    """Return the mode string passed to `call`, if it is a literal."""
    for kw in call.keywords:
        if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
            value = kw.value.value
            return value if isinstance(value, str) else None
    if len(call.args) > position:
        arg = call.args[position]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return arg.value
    return None


def _has_encoding(call: ast.Call) -> bool:
    return any(kw.arg == "encoding" for kw in call.keywords)


def _offenders_in(source: str) -> list[tuple[int, str]]:
    """Return (lineno, call description) for text-mode opens lacking encoding."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call) or _has_encoding(node):
            continue
        func = node.func

        if isinstance(func, ast.Name) and func.id == "open":
            # builtin open(file, mode=...) — binary mode needs no encoding.
            mode = _mode_arg(node, position=1)
            if mode is None or "b" not in mode:
                found.append((node.lineno, "open(...)"))

        elif isinstance(func, ast.Attribute) and func.attr in _TEXT_METHODS:
            found.append((node.lineno, f".{func.attr}(...)"))

        elif isinstance(func, ast.Attribute) and func.attr == "open":
            # Path.open(mode=...). Excludes things like `Image.open(buffer)`,
            # whose first positional arg is a stream rather than a mode string.
            mode = _mode_arg(node, position=0)
            if not node.args or (mode is not None and "b" not in mode):
                found.append((node.lineno, ".open(...)"))

    return found


def test_no_text_file_io_without_an_explicit_encoding() -> None:
    files = _python_files()
    assert files, f"found no Python files to scan under {_REPO_ROOT}"

    offenders = [
        f"{path.relative_to(_REPO_ROOT)}:{lineno}: {what}"
        for path in files
        for lineno, what in _offenders_in(path.read_text(encoding="utf-8"))
    ]

    assert offenders == [], (
        "text-mode file I/O without encoding=\"utf-8\" — these read the "
        "locale encoding, so they pass on Linux CI and raise "
        "UnicodeDecodeError on Windows:\n  " + "\n  ".join(offenders)
    )
