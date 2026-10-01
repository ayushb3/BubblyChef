"""Run one ``Case`` through the real cook matcher and the real pantry deduction.

No model is called: the LLM alias tier is replaced by the case's literal
``aliases`` map. The matcher is ``match_ingredients`` itself and the deduction is
``SupabaseRepository.deduct_pantry_item`` against an in-memory row, so what comes
back is what a cook would see on the review sheet and what the pantry would hold
afterwards.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from bubbly_chef.domain.normalizer import normalize_to_base_unit
from bubbly_chef.models.cook import CookProposal, IngredientMatch
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.cook_matcher import ResolvedAlias, match_ingredients
from tests.unit_conversion_cases import Case

RECIPE_ID = str(uuid.uuid4())


@dataclass
class Outcome:
    proposal: CookProposal
    match: IngredientMatch | None
    # "ready", "shortfall", ... or "missing" when the line never matched a pantry row.
    status: str
    # Display quantity left on the first pantry row after applying the deduction,
    # or None when nothing was deducted.
    remaining: float | None
    approximate: bool | None


class _Query:
    def __init__(self, store: dict[str, Any], row: dict[str, Any] | None) -> None:
        self._store = store
        self._row = row

    def select(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def update(self, payload: dict[str, Any]) -> _Query:
        self._store["updates"].append(payload)
        return self

    def eq(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def limit(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def execute(self) -> Any:
        return type("Result", (), {"data": [self._row] if self._row else []})()


class _Client:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.store: dict[str, Any] = {"updates": []}
        self._row = row

    def table(self, _name: str) -> _Query:
        return _Query(self.store, self._row)


def _build_pantry(case: Case, stored_base: bool) -> list[PantryItem]:
    items: list[PantryItem] = []
    for name, qty, unit in case.pantry:
        qty_base: float | None = None
        unit_base: str | None = None
        if stored_base:
            # What the write path (POST /v1/pantry/normalize-base-unit) would have stored.
            qty_base, unit_base = normalize_to_base_unit(
                name=name, quantity=qty, unit=unit, category="other"
            )
        items.append(
            PantryItem(
                id=uuid.uuid4(),
                name=name,
                category=FoodCategory.OTHER,
                storage_location=StorageLocation.PANTRY,
                quantity=qty,
                unit=unit,
                quantity_base=qty_base,
                unit_base=unit_base,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
    return items


def _deduct(item: PantryItem, deduct_qty: float) -> float | None:
    """Apply `deduct_qty` (base unit) through the real repository; the new display qty."""
    row = {
        "name": item.name,
        "quantity": item.quantity,
        "unit": item.unit,
        "quantity_base": item.quantity_base,
        "unit_base": item.unit_base,
    }
    client = _Client(row)
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = client  # type: ignore[assignment]
    applied = asyncio.run(repo.deduct_pantry_item("u1", str(item.id), deduct_qty))
    if not applied or not client.store["updates"]:
        return None
    return float(client.store["updates"][-1]["quantity"])


def run_case(case: Case, *, stored_base: bool = False) -> Outcome:
    pantry = _build_pantry(case, stored_base)
    aliases = {
        recipe_name: ResolvedAlias(pantry_name=pantry_name, match_type="exact")
        for recipe_name, pantry_name in case.aliases.items()
    } or None
    proposal = match_ingredients(RECIPE_ID, "Case", [_line(case)], pantry, aliases=aliases)

    if proposal.matches:
        match = proposal.matches[0]
        remaining: float | None = None
        if match.deduct_qty and match.pantry_item_id is not None:
            item = next(i for i in pantry if i.id == match.pantry_item_id)
            remaining = _deduct(item, match.deduct_qty)
        return Outcome(
            proposal, match, match.status, remaining, getattr(match, "approximate", None)
        )
    return Outcome(proposal, None, "missing" if proposal.missing else "none", None, None)


def _line(case: Case) -> Any:
    return case.line
