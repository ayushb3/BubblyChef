"""Issue #760: the saved lookup also finds saved meals ("make that pasta dinner again").

Three layers, all without a model or a database:

- `SupabaseRepository.search_saved_meals` on a fake client (scoping, drafts, ranking);
- `saved_recipe_lookup_response`, the deterministic node, on a fake repository;
- `classify_intent`, where the meal-again phrasing must not drift to
  `meal_plan` / `recipe_generation` even if the classifier would say so.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.workflows.chat.nodes import saved_recipe_lookup_response
from bubbly_chef.workflows.router import classify_intent

# ---------------------------------------------------------------------------
# Repository: search_saved_meals
# ---------------------------------------------------------------------------


class _FakeQuery:
    """Replays `meals` rows for `.select().eq()...execute()`.

    Plain-column `eq` filters are applied for real (so user scoping and the
    draft filter are exercised, not assumed); a dotted embed filter such as
    `meal_dishes.user_id` is recorded but doesn't drop the parent row, which
    matches PostgREST semantics.
    """

    def __init__(self, rows: list[dict[str, Any]], log: list[tuple[str, Any]]) -> None:
        self._rows = rows
        self._filters: dict[str, Any] = {}
        self._log = log

    def select(self, *_a: Any, **_k: Any) -> _FakeQuery:
        return self

    def eq(self, field: str, value: Any) -> _FakeQuery:
        self._filters[field] = value
        self._log.append((field, value))
        return self

    def order(self, *_a: Any, **_k: Any) -> _FakeQuery:
        return self

    def limit(self, _n: int) -> _FakeQuery:
        return self

    def execute(self) -> Any:
        rows = [
            r
            for r in self._rows
            if all(r.get(k) == v for k, v in self._filters.items() if "." not in k)
        ]
        return type("Result", (), {"data": rows})()


class _FakeClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self.tables: list[str] = []
        self.filters: list[tuple[str, Any]] = []

    def table(self, name: str) -> _FakeQuery:
        self.tables.append(name)
        return _FakeQuery(self._rows, self.filters)


def _dish(role: str, position: int, title: str) -> dict[str, Any]:
    return {
        "role": role,
        "position": position,
        "recipe_id": f"r-{title.lower().replace(' ', '-')}",
        "recipes": {"title": title},
    }


def _meal(
    meal_id: str,
    title: str,
    dishes: list[dict[str, Any]],
    *,
    user_id: str = "u1",
    is_draft: bool = False,
    description: str | None = None,
    last_cooked_at: str | None = None,
    created_at: str = "2026-09-01T00:00:00+00:00",
) -> dict[str, Any]:
    return {
        "id": meal_id,
        "user_id": user_id,
        "title": title,
        "description": description,
        "servings": 2,
        "is_draft": is_draft,
        "last_cooked_at": last_cooked_at,
        "created_at": created_at,
        "meal_dishes": dishes,
    }


def _repo(rows: list[dict[str, Any]]) -> tuple[SupabaseRepository, _FakeClient]:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    client = _FakeClient(rows)
    repo.client = client  # type: ignore[assignment]
    return repo, client


PASTA_NIGHT = _meal(
    "m-pasta",
    "Cozy Pasta Night",
    [
        _dish("side", 2, "Garlic Bread"),
        _dish("main", 0, "Lemon Pasta"),
        _dish("side", 1, "Green Salad"),
    ],
)
CURRY_NIGHT = _meal(
    "m-curry", "Curry Night", [_dish("main", 0, "Butter Chicken"), _dish("side", 1, "Rice")]
)


@pytest.mark.asyncio
async def test_finds_saved_meal_by_title_and_dish_words() -> None:
    repo, client = _repo([PASTA_NIGHT, CURRY_NIGHT])

    by_title = await repo.search_saved_meals("u1", "make that pasta dinner again")
    by_dish = await repo.search_saved_meals("u1", "the lemon one I made")

    assert [m["id"] for m in by_title] == ["m-pasta"]
    assert [m["id"] for m in by_dish] == ["m-pasta"]
    assert client.tables == ["meals", "meals"]


@pytest.mark.asyncio
async def test_result_carries_dishes_main_first() -> None:
    repo, _ = _repo([PASTA_NIGHT])

    (meal,) = await repo.search_saved_meals("u1", "pasta dinner")

    assert [(d["role"], d["title"]) for d in meal["dishes"]] == [
        ("main", "Lemon Pasta"),
        ("side", "Green Salad"),
        ("side", "Garlic Bread"),
    ]
    assert meal["dishes"][0]["recipe_id"] == "r-lemon-pasta"


@pytest.mark.asyncio
async def test_never_returns_a_draft_meal() -> None:
    draft = _meal("m-draft", "Draft Pasta Night", [_dish("main", 0, "Pasta")], is_draft=True)
    repo, client = _repo([draft, PASTA_NIGHT])

    found = await repo.search_saved_meals("u1", "pasta dinner")

    assert [m["id"] for m in found] == ["m-pasta"]
    assert ("is_draft", False) in client.filters


@pytest.mark.asyncio
async def test_is_scoped_to_the_user() -> None:
    theirs = _meal("m-theirs", "Pasta Night", [_dish("main", 0, "Pasta")], user_id="u2")
    repo, client = _repo([theirs, PASTA_NIGHT])

    found = await repo.search_saved_meals("u1", "pasta dinner")

    assert [m["id"] for m in found] == ["m-pasta"]
    assert ("user_id", "u1") in client.filters
    assert ("meal_dishes.user_id", "u1") in client.filters


@pytest.mark.asyncio
async def test_every_dish_word_must_match_and_a_miss_returns_nothing() -> None:
    repo, _ = _repo([PASTA_NIGHT, CURRY_NIGHT])

    assert await repo.search_saved_meals("u1", "pasta curry dinner") == []
    assert await repo.search_saved_meals("u1", "poutine dinner") == []


@pytest.mark.asyncio
async def test_title_hit_outranks_dish_hit_and_recency_breaks_ties() -> None:
    dish_hit = _meal("m-dish", "Friday Feast", [_dish("main", 0, "Chicken Soup")])
    title_hit = _meal("m-title", "Chicken Night", [_dish("main", 0, "Roast Thing")])
    old_tie = _meal("m-old", "Chicken Bowl", [], last_cooked_at="2026-08-01T00:00:00+00:00")
    new_tie = _meal("m-new", "Chicken Wrap", [], last_cooked_at="2026-09-20T00:00:00+00:00")
    repo, _ = _repo([dish_hit, old_tie, title_hit, new_tie])

    found = await repo.search_saved_meals("u1", "chicken dinner", limit=10)

    assert [m["id"] for m in found] == ["m-new", "m-old", "m-title", "m-dish"]


@pytest.mark.asyncio
async def test_occasion_word_alone_lists_recent_saved_meals() -> None:
    older = _meal("m-a", "Older", [], created_at="2026-08-01T00:00:00+00:00")
    cooked = _meal("m-b", "Cooked", [], last_cooked_at="2026-09-25T00:00:00+00:00")
    repo, _ = _repo([older, cooked])

    found = await repo.search_saved_meals("u1", "show me my saved meals")

    assert [m["id"] for m in found] == ["m-b", "m-a"]


# ---------------------------------------------------------------------------
# Node: saved_recipe_lookup_response
# ---------------------------------------------------------------------------


def _meal_match(meal_id: str = "m-pasta", title: str = "Cozy Pasta Night") -> dict[str, Any]:
    return {
        "id": meal_id,
        "title": title,
        "description": None,
        "servings": 2,
        "user_id": "u1",  # must never leave the node
        "dishes": [
            {"role": "main", "position": 0, "recipe_id": "r1", "title": "Lemon Pasta"},
            {"role": "side", "position": 1, "recipe_id": "r2", "title": "Green Salad"},
        ],
    }


def _recipe(recipe_id: str = "rec-1", title: str = "Pasta Bake") -> dict[str, Any]:
    return {"id": recipe_id, "title": title, "description": "", "cuisine": None, "user_id": "u1"}


def _node_repo(
    recipes: list[dict[str, Any]], meals: list[dict[str, Any]] | Exception
) -> tuple[Any, MagicMock]:
    repo = MagicMock()
    repo.search_saved_recipes = AsyncMock(return_value=recipes)
    repo.get_user_recipes = AsyncMock(return_value=recipes)
    if isinstance(meals, Exception):
        repo.search_saved_meals = AsyncMock(side_effect=meals)
    else:
        repo.search_saved_meals = AsyncMock(return_value=meals)
    return (
        patch(
            "bubbly_chef.workflows.chat.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ),
        repo,
    )


def _state(text: str) -> Any:
    return {"input_text": text, "user_id": "u1", "errors": [], "warnings": []}


@pytest.mark.asyncio
async def test_meal_again_request_returns_the_saved_meal() -> None:
    patcher, repo = _node_repo([], [_meal_match()])
    with patcher:
        result = await saved_recipe_lookup_response(_state("make that pasta dinner again"))

    (match,) = result["saved_meal_matches"]
    assert match["id"] == "m-pasta"
    assert match["title"] == "Cozy Pasta Night"
    assert [d["title"] for d in match["dishes"]] == ["Lemon Pasta", "Green Salad"]
    assert "user_id" not in match
    assert "Cozy Pasta Night" in result["assistant_message"]
    assert result["saved_recipe_matches"] == []
    assert result["intent"] == Intent.SAVED_RECIPE_LOOKUP.value
    repo.search_saved_meals.assert_awaited_once()
    assert repo.search_saved_meals.await_args.args[0] == "u1"


@pytest.mark.asyncio
async def test_recipes_still_come_back_alongside_a_meal_and_the_meal_leads() -> None:
    patcher, _ = _node_repo(
        [_recipe("rec-1", "Pasta Bake"), _recipe("rec-2", "Pasta Salad")], [_meal_match()]
    )
    with patcher:
        result = await saved_recipe_lookup_response(_state("show me my saved pasta"))

    assert [m["id"] for m in result["saved_recipe_matches"]] == ["rec-1", "rec-2"]
    assert [m["id"] for m in result["saved_meal_matches"]] == ["m-pasta"]
    assert result["assistant_message"].startswith("Found it — your saved meal Cozy Pasta Night")
    assert all("user_id" not in m for m in result["saved_recipe_matches"])


@pytest.mark.asyncio
async def test_recipe_only_lookup_is_unchanged() -> None:
    patcher, _ = _node_repo([_recipe("rec-1", "Butter Chicken")], [])
    with patcher:
        result = await saved_recipe_lookup_response(_state("show me my saved butter chicken"))

    assert result["saved_meal_matches"] == []
    assert result["assistant_message"] == "Found it — your saved Butter Chicken!"


@pytest.mark.asyncio
async def test_browsing_recipes_does_not_search_meals() -> None:
    patcher, repo = _node_repo([_recipe()], [_meal_match()])
    with patcher:
        result = await saved_recipe_lookup_response(_state("show me my saved recipes"))

    repo.search_saved_meals.assert_not_awaited()
    assert result["saved_meal_matches"] == []
    assert [m["id"] for m in result["saved_recipe_matches"]] == ["rec-1"]


@pytest.mark.asyncio
async def test_a_failed_meal_search_keeps_the_recipe_matches() -> None:
    patcher, _ = _node_repo([_recipe("rec-1", "Pasta Bake")], RuntimeError("db down"))
    with patcher:
        result = await saved_recipe_lookup_response(_state("show me my saved pasta"))

    assert [m["id"] for m in result["saved_recipe_matches"]] == ["rec-1"]
    assert result["saved_meal_matches"] == []
    assert "Pasta Bake" in result["assistant_message"]


@pytest.mark.asyncio
async def test_a_failed_meal_search_with_nothing_else_does_not_claim_no_match() -> None:
    patcher, _ = _node_repo([], RuntimeError("db down"))
    with patcher:
        result = await saved_recipe_lookup_response(_state("make that pasta dinner again"))

    message = result["assistant_message"].lower()
    assert "couldn't reach" in message
    assert "generate" not in message


@pytest.mark.asyncio
async def test_nothing_found_still_offers_generation() -> None:
    patcher, _ = _node_repo([], [])
    with patcher:
        result = await saved_recipe_lookup_response(_state("make that poutine dinner again"))

    assert "couldn't find" in result["assistant_message"].lower()
    assert result["saved_meal_matches"] == []


# ---------------------------------------------------------------------------
# Classifier: the phrasing reaches the lookup, not meal_plan / recipe_generation
# ---------------------------------------------------------------------------


def _classify_state(text: str, **extra: Any) -> Any:
    return {
        "input_text": text,
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
        **extra,
    }


def _llm_says(intent: str) -> Any:
    from bubbly_chef.workflows.shared_state import LLMIntentResult

    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=LLMIntentResult(
            intent=intent, confidence=0.9, reasoning="stub", entities=[]
        )
    )
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


@pytest.mark.asyncio
@pytest.mark.parametrize("llm_intent", ["meal_plan", "recipe_generation"])
@pytest.mark.parametrize(
    "text",
    [
        "make that pasta dinner again",
        "Make the pasta dinner again",
        "can you cook that lasagna meal again?",
        "show me my saved pasta dinner",
        "show me my saved meals",
        "the pasta dinner I made last week",
    ],
)
async def test_meal_again_phrasing_routes_to_the_lookup(text: str, llm_intent: str) -> None:
    with _llm_says(llm_intent):
        result = await classify_intent(_classify_state(text))

    assert result["intent"] == Intent.SAVED_RECIPE_LOOKUP.value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text,llm_intent,expected",
    [
        ("what's for dinner?", "meal_plan", Intent.MEAL_PLAN.value),
        ("dinner tonight", "meal_plan", Intent.MEAL_PLAN.value),
        ("make a pasta dinner", "recipe_generation", Intent.RECIPE_GENERATION.value),
        ("Plan dinner for 2", "meal_plan", Intent.MEAL_PLAN.value),
    ],
)
async def test_fresh_meal_requests_are_not_hijacked(
    text: str, llm_intent: str, expected: str
) -> None:
    with _llm_says(llm_intent):
        result = await classify_intent(_classify_state(text))

    assert result["intent"] == expected


@pytest.mark.asyncio
async def test_an_explicit_meal_pick_still_beats_the_phrasing() -> None:
    with _llm_says("recipe_generation"):
        result = await classify_intent(
            _classify_state("make that pasta dinner again", context={"meal_option_id": "opt-1"})
        )

    assert result["intent"] == Intent.MEAL_PLAN.value
