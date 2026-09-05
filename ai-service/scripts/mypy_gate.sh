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
#
# That said, mypy's own exit code (PIPESTATUS[0]) is still checked, just not
# via pipefail. mypy only ever exits 0 (clean) or 1 (found errors, however
# many) during a normal run; anything else (e.g. 2) means mypy itself crashed
# -- a bad flag, an internal error, a broken config/environment -- and in
# that failure mode it may print little or no output for mypy-baseline to
# parse, so mypy-baseline could exit 0 on empty input and mask the crash as
# "no new errors". We check PIPESTATUS[0] explicitly and fail hard on any
# code outside {0, 1} before trusting mypy-baseline's verdict at all.
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

# Note on the `if PIPELINE; then ... else ... fi` shape used below: this is
# deliberate, not stylistic. Under `set -e`, capturing PIPESTATUS as a plain
# statement *after* the pipeline doesn't work, because a pipeline whose last
# command exits non-zero (which mypy-baseline does whenever it reports new OR
# resolved violations, not just on a crash) would itself trigger `set -e` and
# end the script right there -- before a later line ever got to read
# PIPESTATUS. Using the pipeline as an `if` condition suppresses that trigger
# (commands tested by `if` are exempt from `set -e`), and reading PIPESTATUS
# as the very first statement in each branch captures it before anything else
# runs and overwrites it.
if [[ "${1:-}" == "--sync" ]]; then
    if "$PYTHON" -m mypy bubbly_chef/ --strict | "$PYTHON" -m mypy_baseline sync; then
        statuses=("${PIPESTATUS[@]}")
    else
        statuses=("${PIPESTATUS[@]}")
    fi
    mypy_status="${statuses[0]}"
    if [[ "$mypy_status" != "0" && "$mypy_status" != "1" ]]; then
        echo "mypy exited with an unexpected status $mypy_status — treating as a crash, not a normal error report" >&2
        exit 1
    fi
    echo "Baseline refreshed: mypy-baseline.txt"
    exit 0
fi

if "$PYTHON" -m mypy bubbly_chef/ --strict | "$PYTHON" -m mypy_baseline filter; then
    statuses=("${PIPESTATUS[@]}")
else
    statuses=("${PIPESTATUS[@]}")
fi
mypy_status="${statuses[0]}"
baseline_status="${statuses[1]}"
if [[ "$mypy_status" != "0" && "$mypy_status" != "1" ]]; then
    echo "mypy exited with an unexpected status $mypy_status — treating as a crash, not a normal error report" >&2
    exit 1
fi
exit "$baseline_status"
