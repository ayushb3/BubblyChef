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
import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

# The project's two Python trees, walked whole so a new file can't land
# outside the guard (`ai-service/conftest.py` sits in neither a package nor
# a test directory, and pytest imports it). Roots that don't exist are
# skipped so the guard stays runnable from a partial checkout.
_SCAN_ROOTS = (_REPO_ROOT / "ai-service", _REPO_ROOT / "scripts")

_SKIP_DIRS = {".venv", "venv", "node_modules", "__pycache__", ".git"}

# Path methods that are always text-mode and always accept `encoding=`.
_TEXT_METHODS = {"read_text", "write_text"}

# A file mode, as opposed to a path or any other string. Lets the matcher
# tell `Path.open("r")` (arg 0 is a mode) from `Image.open("photo.png")`
# (arg 0 is a path) without having to know the receiver's type.
_MODE_RE = re.compile(r"^[rwxab+t]{1,3}$")


def _python_files() -> list[Path]:
    files: list[Path] = []
    for root in _SCAN_ROOTS:
        if not root.is_dir():
            continue
        files.extend(
            path for path in root.rglob("*.py") if _SKIP_DIRS.isdisjoint(path.parts)
        )
    return files


def _string_at(call: ast.Call, position: int) -> str | None:
    if len(call.args) <= position:
        return None
    arg = call.args[position]
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        return arg.value
    return None


def _keyword(call: ast.Call, name: str) -> ast.expr | None:
    return next((kw.value for kw in call.keywords if kw.arg == name), None)


def _has_encoding(call: ast.Call) -> bool:
    """True only for a *usable* encoding. `encoding=None` means the locale
    default — the precise bug this guard exists to catch — so it doesn't count.
    """
    value = _keyword(call, "encoding")
    return value is not None and not (
        isinstance(value, ast.Constant) and value.value is None
    )


def _declared_mode(call: ast.Call, *, mode_positions: tuple[int, ...]) -> str | None:
    """The file mode this call declares, if it declares one literally."""
    keyword = _keyword(call, "mode")
    if isinstance(keyword, ast.Constant) and isinstance(keyword.value, str):
        return keyword.value
    for position in mode_positions:
        candidate = _string_at(call, position)
        if candidate is not None and _MODE_RE.match(candidate):
            return candidate
    return None


def _offenders_in(source: str) -> list[tuple[int, str]]:
    """Return (lineno, call description) for text-mode opens lacking encoding."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call) or _has_encoding(node):
            continue
        func = node.func

        if isinstance(func, ast.Attribute) and func.attr in _TEXT_METHODS:
            found.append((node.lineno, f".{func.attr}(...)"))

        elif isinstance(func, ast.Name) and func.id == "open":
            # builtin open(file, mode) — text unless the mode says otherwise.
            mode = _declared_mode(node, mode_positions=(1,))
            if mode is None or "b" not in mode:
                found.append((node.lineno, "open(...)"))

        elif isinstance(func, ast.Attribute) and func.attr == "open":
            # Ambiguous: `Path.open(mode)` takes the mode first, while
            # `gzip.open(path, mode)` / `Image.open(path)` take the path
            # first. Check both positions for something mode-shaped rather
            # than assuming the receiver's type.
            mode = _declared_mode(node, mode_positions=(0, 1))
            if mode is not None:
                if "b" not in mode:
                    found.append((node.lineno, ".open(...)"))
            elif not node.args:
                # `p.open()` — Path.open defaults to text mode.
                found.append((node.lineno, ".open(...)"))
            # Otherwise a positional arg with no mode-shaped string: a path
            # being handed to something like Image.open. Left alone, so this
            # guard stays silent on non-filesystem `.open` calls.

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
        'text-mode file I/O without encoding="utf-8" — these read the '
        "locale encoding, so they pass on Linux CI and raise "
        "UnicodeDecodeError on Windows:\n  " + "\n  ".join(offenders)
    )
