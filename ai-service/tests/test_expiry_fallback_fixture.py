"""Drift guard for the Next.js expiry fallback table (#705).

`nextjs/src/lib/expiry-fallback.ts` mirrors `ExpiryHeuristics` so a pantry add
still gets a deterministic expiry when the AI service is unreachable. The two
tables stay in sync through `tests/fixtures/expiry_heuristics.json`: this test
fails if the Python table changes without the fixture (and, through the fixture,
the Jest test in nextjs/src/__tests__/expiry-fallback.test.ts forces the TS table
to follow).

Regenerate after an intentional change to the Python table:

    UPDATE_EXPIRY_FIXTURE=1 python -m pytest tests/test_expiry_fallback_fixture.py
"""

import json
import os
from pathlib import Path
from typing import Any

from bubbly_chef.tools.expiry import ExpiryHeuristics

FIXTURE = Path(__file__).parent / "fixtures" / "expiry_heuristics.json"


def _export() -> dict[str, Any]:
    shelf_life: dict[str, dict[str, int]] = {}
    for (category, storage), days in ExpiryHeuristics.SHELF_LIFE_DAYS.items():
        shelf_life.setdefault(category.value, {})[storage.value] = days
    return {
        "shelf_life_days": shelf_life,
        # Order matters: estimate_expiry returns the first substring match.
        "specific_items": dict(ExpiryHeuristics.SPECIFIC_ITEMS),
        "default_storage": {c.value: s.value for c, s in ExpiryHeuristics.DEFAULT_STORAGE.items()},
        # estimate_expiry's `.get(key, 30)` for a (category, storage) pair not in the table.
        "fallback_days": 30,
    }


def test_fixture_matches_python_heuristics() -> None:
    exported = _export()
    if os.environ.get("UPDATE_EXPIRY_FIXTURE"):
        FIXTURE.write_text(json.dumps(exported, indent=2) + "\n", encoding="utf-8")
    on_disk = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert on_disk == exported, (
        "ExpiryHeuristics changed: regenerate tests/fixtures/expiry_heuristics.json "
        "(UPDATE_EXPIRY_FIXTURE=1) and update nextjs/src/lib/expiry-fallback.ts to match"
    )
    # dict equality ignores order, and order decides which specific item wins.
    assert list(on_disk["specific_items"]) == list(exported["specific_items"])
