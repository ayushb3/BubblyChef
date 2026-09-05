#!/usr/bin/env bash
# Type-check gate for ai-service (issue #309).
#
# Runs `mypy bubbly_chef/ --strict` and filters the output through
# mypy-baseline, so this exits non-zero ONLY for errors that are new
# (or newly-reintroduced) relative to `ai-service/mypy-baseline.txt`.
# Pre-existing errors captured in the baseline are tolerated until they
# are fixed one at a time under #128 — that is a separate, judgement-call
# piece of work, not this gate's job.
#
# This is the exact command CI runs (see .github/workflows/ci.yml,
# "AI service" job, "Mypy (baseline-gated)" step) — run it locally to get
# the same verdict before opening a PR:
#
#   cd ai-service && ./scripts/mypy_gate.sh
#
# To refresh the baseline after fixing pre-existing errors (or, less
# commonly, after knowingly accepting new ones as a batch), regenerate it
# and commit the result:
#
#   cd ai-service && ./scripts/mypy_gate.sh --sync
#
# mypy strictness itself (see pyproject.toml [tool.mypy]) is never touched
# by this script — it only decides which of mypy's own findings are new.
# Deliberately no `set -o pipefail`: mypy itself exits 1 whenever it finds
# ANY error, including ones already in the baseline, and pipefail would
# propagate that non-zero status regardless of what mypy-baseline decides.
# The verdict that matters is mypy-baseline's, so we read its exit status
# via PIPESTATUS explicitly instead.
set -eu

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Prefer the local venv if one exists (matches how the other quality gates
# in CLAUDE.md are invoked, e.g. `./.venv/bin/python -m pytest`); otherwise
# fall back to whatever `python` is on PATH (this is what CI uses, since the
# GitHub Actions job installs straight into the runner's Python).
PYTHON=python
if [[ -x ".venv/bin/python" ]]; then
    PYTHON=".venv/bin/python"
fi

if [[ "${1:-}" == "--sync" ]]; then
    "$PYTHON" -m mypy bubbly_chef/ --strict | "$PYTHON" -m mypy_baseline sync
    echo "Baseline refreshed: mypy-baseline.txt"
    exit 0
fi

"$PYTHON" -m mypy bubbly_chef/ --strict | "$PYTHON" -m mypy_baseline filter
exit "${PIPESTATUS[1]}"
