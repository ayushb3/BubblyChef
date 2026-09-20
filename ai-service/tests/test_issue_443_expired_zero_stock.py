"""Issue #443 (defect 1): expired and zero-quantity pantry rows must not reach
the model as available stock.

A refinement turn produced "Spicy Fig-Glazed Pad Thai with Spinach ...
incorporating fresh spinach from your pantry" when the only spinach row was
two days past its expiry date at quantity 0 (fully consumed by an earlier
cook). Rows like that stay in the table, so every read that turns the pantry
into prompt context has to drop them. The regression guard in each section
is the other half of the contract: a row expiring *soon* (today, tomorrow)
is exactly what grounding exists to push and must keep flowing through.

The ignored-ingredient half of #443 (mushrooms requested, spinach returned)
is not covered here — see tests/test_preferred_ingredients_reach_prompt.py.
"""

from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.domain.stock import (
    filter_usable_pantry_items,
    filter_usable_pantry_rows,
    is_usable_stock,
)
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.services.recipe_generator import (
    AIRecipeOutput,
    generate_recipe,
)
from bubbly_chef.workflows.chat.nodes import _fetch_pantry_context
from bubbly_chef.workflows.recipe.nodes import (
    brainstorm_recipe_ideas,
    generate_grounded_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.state import LLMRecipeResult

TODAY = date(2026, 9, 13)  # the date in the issue's repro


def _iso(days_from_today: int) -> str:
    return (date.today() + timedelta(days=days_from_today)).isoformat()


def _row(
    name: str, *, quantity: Any = 1.0, days_until_expiry: int | None = None
) -> dict[str, Any]:
    row: dict[str, Any] = {"name": name, "quantity": quantity, "unit": "bunch"}
    if days_until_expiry is not None:
        row["expiry_date"] = _iso(days_until_expiry)
    return row


def _item(name: str, *, quantity: float = 1.0, days_until_expiry: int | None = None) -> PantryItem:
    expiry = (
        date.today() + timedelta(days=days_until_expiry)
        if days_until_expiry is not None
        else None
    )
    return PantryItem(name=name, quantity=quantity, unit="bunch", expiry_date=expiry)


def _mock_ai(return_value: Any) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=return_value)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _prompt(mock_mgr: Any) -> str:
    return str(mock_mgr.return_value.complete.call_args.kwargs["prompt"])


# ---------------------------------------------------------------------------
# domain/stock.py — the rule itself
# ---------------------------------------------------------------------------


class TestIsUsableStock:
    def test_zero_quantity_is_not_stock(self) -> None:
        assert is_usable_stock(0, None, TODAY) is False
        assert is_usable_stock(0.0, None, TODAY) is False
        assert is_usable_stock("0", None, TODAY) is False

    def test_negative_quantity_is_not_stock(self) -> None:
        assert is_usable_stock(-1, None, TODAY) is False

    def test_unknown_quantity_is_kept(self) -> None:
        """None / missing / non-numeric is *unknown*, not zero — hiding real
        stock silently would be worse than listing an item of unknown amount."""
        assert is_usable_stock(None, None, TODAY) is True
        assert is_usable_stock("a few", None, TODAY) is True

    def test_expired_yesterday_is_not_stock(self) -> None:
        assert is_usable_stock(1, TODAY - timedelta(days=1), TODAY) is False
        assert is_usable_stock(1, (TODAY - timedelta(days=1)).isoformat(), TODAY) is False

    def test_expiring_today_or_later_is_stock(self) -> None:
        """Same boundary as PantryItem.is_expired (days_until_expiry < 0)."""
        assert is_usable_stock(1, TODAY, TODAY) is True
        assert is_usable_stock(1, TODAY + timedelta(days=1), TODAY) is True

    def test_unknown_expiry_is_kept(self) -> None:
        assert is_usable_stock(1, None, TODAY) is True
        assert is_usable_stock(1, "not-a-date", TODAY) is True

    def test_issue_repro_row_is_not_stock(self) -> None:
        """Spinach: quantity 0, expiry 2026-09-11, today 2026-09-13."""
        assert is_usable_stock(0, "2026-09-11", TODAY) is False


def test_filter_usable_pantry_rows_keeps_only_cookable_rows() -> None:
    rows = [
        _row("spinach", quantity=0, days_until_expiry=-2),
        _row("rice", quantity=0),
        _row("old milk", days_until_expiry=-1),
        _row("bread", days_until_expiry=1),
        _row("salt", quantity=None),
    ]
    assert [r["name"] for r in filter_usable_pantry_rows(rows)] == ["bread", "salt"]


def test_filter_usable_pantry_items_matches_model_is_expired() -> None:
    items = [
        _item("spinach", quantity=0, days_until_expiry=-2),
        _item("old milk", days_until_expiry=-1),
        _item("bread", days_until_expiry=0),
        _item("flour"),
    ]
    kept = filter_usable_pantry_items(items)
    assert [it.name for it in kept] == ["bread", "flour"]
    assert all(not it.is_expired for it in kept)


# ---------------------------------------------------------------------------
# score_pantry_ingredients — the grounding workflow's entry point for stock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scoring_drops_expired_and_zero_quantity_rows_from_snapshot() -> None:
    state = {
        "input_text": "what's for dinner?",
        "user_id": "user-1",
        "pantry_snapshot": [
            _row("spinach", quantity=0, days_until_expiry=-2),
            _row("rice", quantity=0),
            _row("old yogurt", days_until_expiry=-1),
            _row("bread", days_until_expiry=10),
        ],
        "recipe_constraints": {},
    }
    result = await score_pantry_ingredients(state)  # type: ignore[arg-type]
    assert [i["name"] for i in result["scored_pantry_items"]] == ["bread"]


@pytest.mark.asyncio
async def test_scoring_still_prioritises_expiring_soon_rows() -> None:
    """Regression guard: dropping *expired* must not touch *expiring*. Milk
    expiring tomorrow keeps its urgency bonus and leads the ranked list."""
    state = {
        "input_text": "what's for dinner?",
        "user_id": "user-1",
        "pantry_snapshot": [
            _row("flour"),
            _row("milk", days_until_expiry=1),
            _row("spinach", quantity=0, days_until_expiry=-2),
            _row("eggs", days_until_expiry=0),
        ],
        "recipe_constraints": {},
    }
    result = await score_pantry_ingredients(state)  # type: ignore[arg-type]
    ranked = result["scored_pantry_items"]
    names = [i["name"] for i in ranked]
    assert "spinach" not in names
    assert set(names) == {"flour", "milk", "eggs"}
    assert names[:2] == ["milk", "eggs"] or names[:2] == ["eggs", "milk"]
    by_name = {i["name"]: i for i in ranked}
    assert by_name["milk"]["_score"] == 4
    assert by_name["eggs"]["_score"] == 4
    assert by_name["flour"]["_score"] == 0


@pytest.mark.asyncio
async def test_scoring_drops_dead_rows_fetched_from_the_database() -> None:
    """No snapshot -> rows come from the repo; the same filter applies."""
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(
        return_value=[
            _item("spinach", quantity=0, days_until_expiry=-2),
            _item("bread", days_until_expiry=2),
        ]
    )
    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_repository",
        AsyncMock(return_value=repo),
    ):
        result = await score_pantry_ingredients(  # type: ignore[arg-type]
            {"input_text": "dinner", "user_id": "user-1", "pantry_snapshot": [], "recipe_constraints": {}}
        )
    assert [i["name"] for i in result["scored_pantry_items"]] == ["bread"]


# ---------------------------------------------------------------------------
# generate_grounded_recipe — the recipe-card prompt
# ---------------------------------------------------------------------------


def _llm_recipe() -> LLMRecipeResult:
    return LLMRecipeResult(title="Toast", description="d", ingredients=[], instructions=["s"])


@pytest.mark.asyncio
async def test_grounded_recipe_prompt_never_lists_expired_or_empty_rows() -> None:
    """Pre-#443 an expired row was flagged by score_and_rank but still
    formatted into "Supporting ingredients available"."""
    from bubbly_chef.workflows.recipe.nodes import score_and_rank

    scored = score_and_rank(
        [
            _row("spinach", quantity=0, days_until_expiry=-2),
            _row("old yogurt", days_until_expiry=-3),
            _row("rice", quantity=0),
            _row("bread", days_until_expiry=5),
        ],
        {},
    )
    assert any(i["name"] == "spinach" for i in scored)  # scoring alone keeps it
    with _mock_ai(_llm_recipe()) as mgr:
        await generate_grounded_recipe(  # type: ignore[arg-type]
            {
                "input_text": "toast",
                "selected_recipe_name": "Toast",
                "scored_pantry_items": scored,
                "recipe_constraints": {},
            }
        )
    prompt = _prompt(mgr)
    assert "spinach" not in prompt
    assert "yogurt" not in prompt
    assert "rice" not in prompt
    assert "bread" in prompt


@pytest.mark.asyncio
async def test_grounded_recipe_prompt_keeps_expiring_soon_rows() -> None:
    """Regression guard for the recipe-card path."""
    with _mock_ai(_llm_recipe()) as mgr:
        await generate_grounded_recipe(  # type: ignore[arg-type]
            {
                "input_text": "toast",
                "selected_recipe_name": "Toast",
                "scored_pantry_items": [],
                "pantry_snapshot": [
                    _row("milk", days_until_expiry=1),
                    _row("spinach", quantity=0, days_until_expiry=-2),
                ],
                "recipe_constraints": {},
            }
        )
    prompt = _prompt(mgr)
    assert "milk" in prompt
    assert "spinach" not in prompt


# ---------------------------------------------------------------------------
# brainstorm_recipe_ideas — the ideas prompt
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_brainstorm_drops_zero_quantity_rows_but_keeps_expiring_ones() -> None:
    from bubbly_chef.workflows.recipe.nodes import score_and_rank

    scored = score_and_rank(
        [
            _row("rice", quantity=0),
            _row("spinach", quantity=0, days_until_expiry=-2),
            _row("milk", days_until_expiry=1),
            _row("flour"),
        ],
        {},
    )
    with _mock_ai("**Pancakes**") as mgr:
        await brainstorm_recipe_ideas(  # type: ignore[arg-type]
            {"input_text": "dinner?", "scored_pantry_items": scored, "recipe_constraints": {}}
        )
    prompt = _prompt(mgr)
    assert "rice" not in prompt
    assert "spinach" not in prompt
    expiring_line = next(li for li in prompt.splitlines() if li.startswith("Expiring soon"))
    assert "milk" in expiring_line
    assert "flour" in prompt


# ---------------------------------------------------------------------------
# services/recipe_generator.generate_recipe — the refine engine (the repro path)
# ---------------------------------------------------------------------------


def _ai_output(*ingredient_names: str) -> AIRecipeOutput:
    return AIRecipeOutput(
        title="Pad Thai",
        description="d",
        ingredients=[
            {"name": n, "quantity": 100.0, "unit": "g", "preparation": None, "optional": False}
            for n in ingredient_names
        ],
        instructions=["cook"],
    )


@pytest.mark.asyncio
async def test_refine_engine_hides_dead_rows_and_reports_them_missing() -> None:
    """The exact pantry from the issue. Spinach (qty 0, expired) must be absent
    from the prompt, and if the model still names it, the availability status
    must say "missing" rather than claim the user has it."""
    pantry = [
        _item("bread", days_until_expiry=5),
        _item("milk", days_until_expiry=1),
        _item("rice", quantity=0.59, days_until_expiry=200),
        _item("spinach", quantity=0, days_until_expiry=-2),
    ]
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_ai_output("spinach", "rice"))
    response = await generate_recipe("something with mushrooms", pantry, ai)

    prompt = str(ai.complete.call_args.kwargs["prompt"])
    assert "spinach" not in prompt.lower()
    assert "bread" in prompt
    assert "milk" in prompt
    assert "rice" in prompt
    status = {s.ingredient_name: s.status for s in response.ingredients_status}
    assert status["spinach"] == "missing"
    assert status["rice"] in {"have", "partial"}


@pytest.mark.asyncio
async def test_refine_engine_still_flags_expiring_soon_rows() -> None:
    """Regression guard: the "Items Expiring Soon" block keeps tomorrow's milk."""
    pantry = [
        _item("milk", days_until_expiry=1),
        _item("spinach", quantity=1, days_until_expiry=-2),
    ]
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_ai_output("milk"))
    await generate_recipe("something milky", pantry, ai)
    prompt = str(ai.complete.call_args.kwargs["prompt"])
    assert "milk - expires tomorrow!" in prompt
    assert "spinach" not in prompt
    assert "EXPIRED" not in prompt


# ---------------------------------------------------------------------------
# chat cooking-help context — the general "what can I cook" path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cooking_help_context_omits_dead_rows_and_bounds_expiring() -> None:
    """`days <= 3` used to sweep expired food into "EXPIRING SOON (use first!)"."""
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(
        return_value=[
            _item("spinach", quantity=0, days_until_expiry=-2),
            _item("old yogurt", days_until_expiry=-1),
            _item("milk", days_until_expiry=1),
            _item("flour"),
        ]
    )
    with patch(
        "bubbly_chef.workflows.chat.nodes.get_repository", AsyncMock(return_value=repo)
    ):
        context = await _fetch_pantry_context({"user_id": "user-1"})  # type: ignore[arg-type]
    assert "spinach" not in context
    assert "yogurt" not in context
    assert "pantry currently has 2 items" in context
    assert "EXPIRING SOON (use first!): milk" in context
