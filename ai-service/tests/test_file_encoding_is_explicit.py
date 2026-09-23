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
            # KNOWN BLIND SPOT: a positional arg that is not a mode-shaped
            # literal is left alone. Usually it really is a path handed to a
            # non-filesystem `.open` (`Image.open(photo)`, `zf.open(name)`),
            # but it also covers `p.open(mode_var)` / `p.open("r" if x
            # else "rb")` — a genuine text-mode Path.open this guard then
            # misses. Builtin `open()` above has no such gap, because its
            # mode is unambiguously arg 1, so it can flag an unknown mode.
            #
            # Deliberately not closed: telling the two apart needs the
            # receiver's type, which the AST does not carry, and guessing
            # from the receiver's *name* would make `Image.open(path_var)`
            # a false positive. A false positive breaks the build for
            # everyone; this false negative only narrows the guard, and the
            # forms that actually caused #451 (bare `read_text()`,
            # `open(p)`, literal modes) are all still covered.

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


def test_matcher_flags_the_forms_that_caused_issue_451() -> None:
    """The shapes the guard must never miss."""
    for source in (
        "p.read_text()",
        "p.write_text(s)",
        "open(f)",
        'open(f, "w")',
        "p.open()",
        'p.open("r")',
        'p.open(mode="w")',
        'gzip.open(path, "rt")',
        # `encoding=None` IS the locale default, so it must not count as
        # "an encoding was given" — the bug wearing the fix's clothes.
        "open(p, encoding=None)",
        # A mode the matcher cannot read is assumed text for builtin open,
        # whose mode position is unambiguous.
        "open(p, mode_var)",
    ):
        assert _offenders_in(source), f"should have been flagged: {source}"


def test_matcher_stays_silent_on_safe_and_non_filesystem_calls() -> None:
    """False positives break the build for everyone, so these must not fire."""
    for source in (
        'p.read_text(encoding="utf-8")',
        'p.write_text(s, encoding="utf-8")',
        'open(f, encoding="utf-8")',
        'open(f, "rb")',
        'open(f, mode="wb")',
        'p.open(encoding="utf-8")',
        'p.open("rb")',
        'gzip.open(path, "rb")',
        # Not filesystem text reads: arg 0 is a path or a stream, not a mode.
        'Image.open("photo.png")',
        'Image.open(io.BytesIO(b""))',
        "os.open(path, flags)",
        'zf.open("manifest.json")',
    ):
        assert not _offenders_in(source), f"should have been left alone: {source}"


def test_known_blind_spot_is_deliberate_not_accidental() -> None:
    """`Path.open()` with a non-literal mode is missed — see the comment in
    `_offenders_in`. Pinned so the gap is a recorded decision rather than a
    surprise, and so closing it later is a visible change to this test.
    """
    for source in (
        "p.open(mode_var)",
        'p.open("r" if binary else "rb")',
        'p.open(f"{m}")',
    ):
        assert not _offenders_in(source), (
            f"blind spot changed for {source} — if this was closed on purpose, "
            "update this test and the comment in _offenders_in"
        )
