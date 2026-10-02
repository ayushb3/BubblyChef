"""Issue #878: the single-dish recipe path avoids repeating a saved recipe.

PR #876 (issue #852) gave the meal option prompt the user's recent saved/cooked titles as
dishes to avoid. `recipe-generate` in chat (the brainstorm idea list and the one grounded
card) had no such list, so a library of tomato-chickpea stews could still get a seventh.

Covers, with the model and the repository mocked throughout (no live provider):

  * the avoid list reaches the grounded-card prompt on a direct request, and the brainstorm
    prompt
  * the user's own message wins: a title the message names is not listed, and an explicit
    "make my chickpea stew again" is never blocked
  * a brainstorm pick (the user chose an idea) is never blocked
  * the read is best-effort (no titles, a failing repo, a repo without the method) and is
    scoped to the turn's user
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.services.food_exclusions import FoodExclusions
from bubbly_chef.workflows.recipe.nodes import brainstorm_recipe_ideas, generate_grounded_recipe
from bubbly_chef.workflows.state import LLMRecipeResult
from bubbly_chef.workflows.meal.variety import avoidable_titles

USER = "user-878"
TITLES = ["Tomato Chickpea Stew", "Lemon Butter Pasta"]
MARKER = "already has saved or has cooked recently"


def _repo(titles: Any) -> MagicMock:
    repo = MagicMock()
    if isinstance(titles, Exception):
        repo.get_recent_dish_titles = AsyncMock(side_effect=titles)
    else:
        repo.get_recent_dish_titles = AsyncMock(return_value=titles)
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    return repo


def _card(title: str = "Garlic Noodles") -> LLMRecipeResult:
    return LLMRecipeResult(
        title=title,
        description="d",
        ingredients=[{"name": "noodles", "quantity": 1, "unit": "cup"}],
        instructions=["cook"],
    )


def _state(text: str, **extra: Any) -> dict[str, Any]:
    return {
        "input_text": text,
        "errors": [],
        "warnings": [],
        "session": None,
        "user_id": USER,
        "scored_pantry_items": [{"name": "noodles", "_score": 1}],
        **extra,
    }


def _direct(text: str, **extra: Any) -> dict[str, Any]:
    """A fresh generation request: extract_recipe_constraints ran this turn."""
    return _state(text, **{"constraints_extracted": True, "recipe_constraints": {}, **extra})


async def _run_card(repo: Any, state: dict[str, Any]) -> tuple[Any, MagicMock]:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_card())
    with (
        patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch("bubbly_chef.workflows.recipe.nodes.get_repository", AsyncMock(return_value=repo)),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_food_exclusions",
            AsyncMock(return_value=FoodExclusions(allergies=(), dislikes=())),
        ),
    ):
        out = await generate_grounded_recipe(state)
    return out, ai


async def _run_brainstorm(repo: Any, state: dict[str, Any]) -> MagicMock:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value="1. **Garlic Noodles**\n2. **Veggie Fried Rice**")
    with (
        patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch("bubbly_chef.workflows.recipe.nodes.get_repository", AsyncMock(return_value=repo)),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_food_exclusions",
            AsyncMock(return_value=FoodExclusions(allergies=(), dislikes=())),
        ),
    ):
        await brainstorm_recipe_ideas(state)
    return ai


def _prompt(ai: MagicMock) -> str:
    return str(ai.complete.call_args.kwargs["prompt"])


# ---------------------------------------------------------------------------
# The pure rule
# ---------------------------------------------------------------------------


class TestAvoidableTitles:
    def test_every_title_stays_when_the_message_names_none(self) -> None:
        assert avoidable_titles(TITLES, "Something quick for dinner") == TITLES

    def test_a_title_the_message_names_is_not_avoided(self) -> None:
        assert avoidable_titles(TITLES, "make my tomato chickpea stew again") == [
            "Lemon Butter Pasta"
        ]

    def test_a_partial_mention_does_not_lift_the_title(self) -> None:
        # "stew" alone is not the dish: the stew is still something to avoid repeating
        assert avoidable_titles(TITLES, "a warming stew please") == TITLES

    def test_no_titles_is_empty(self) -> None:
        assert avoidable_titles([], "anything") == []


# ---------------------------------------------------------------------------
# The grounded card (one dish)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGroundedCard:
    async def test_the_avoid_list_is_in_the_prompt(self) -> None:
        out, ai = await _run_card(_repo(TITLES), _direct("give me a dinner recipe"))
        prompt = _prompt(ai)
        assert "Tomato Chickpea Stew; Lemon Butter Pasta" in prompt
        assert MARKER in prompt
        assert out["proposal"] is not None

    async def test_the_titles_are_read_for_this_user_only(self) -> None:
        repo = _repo(TITLES)
        await _run_card(repo, _direct("give me a dinner recipe"))
        repo.get_recent_dish_titles.assert_awaited_once()
        assert repo.get_recent_dish_titles.await_args.args[0] == USER

    async def test_an_explicit_request_for_a_saved_dish_is_not_blocked(self) -> None:
        _out, ai = await _run_card(_repo(TITLES), _direct("make my tomato chickpea stew again"))
        prompt = _prompt(ai)
        assert "Tomato Chickpea Stew" not in prompt  # the request's own words are lower-case
        # the other saved dish is still avoided
        assert "Lemon Butter Pasta" in prompt

    async def test_when_the_request_names_the_only_title_there_is_no_block(self) -> None:
        _out, ai = await _run_card(
            _repo(["Tomato Chickpea Stew"]), _direct("make my tomato chickpea stew again")
        )
        assert MARKER not in _prompt(ai)

    async def test_a_brainstorm_pick_is_never_blocked(self) -> None:
        # No `constraints_extracted`: the user chose an idea we offered. They asked for it.
        repo = _repo(TITLES)
        out, ai = await _run_card(
            repo, _state("the first one", selected_recipe_name="Tomato Chickpea Stew")
        )
        assert MARKER not in _prompt(ai)
        repo.get_recent_dish_titles.assert_not_awaited()
        assert out["proposal"] is not None

    async def test_the_list_survives_a_pantry_opt_out(self) -> None:
        _out, ai = await _run_card(
            _repo(TITLES),
            _direct("give me a dinner recipe", recipe_constraints={"use_pantry": False}),
        )
        assert "Tomato Chickpea Stew; Lemon Butter Pasta" in _prompt(ai)

    async def test_no_titles_leaves_the_prompt_without_a_block(self) -> None:
        out, ai = await _run_card(_repo([]), _direct("give me a dinner recipe"))
        assert MARKER not in _prompt(ai)
        assert out["proposal"] is not None

    async def test_a_failing_read_degrades_to_no_block(self) -> None:
        out, ai = await _run_card(_repo(RuntimeError("db down")), _direct("a dinner recipe"))
        assert MARKER not in _prompt(ai)
        assert out["proposal"] is not None

    async def test_a_repo_without_the_method_degrades_the_same_way(self) -> None:
        out, ai = await _run_card(MagicMock(), _direct("a dinner recipe"))
        assert MARKER not in _prompt(ai)
        assert out["proposal"] is not None

    async def test_a_signed_out_turn_reads_nothing(self) -> None:
        repo = _repo(TITLES)
        _out, ai = await _run_card(repo, _direct("a dinner recipe", user_id=""))
        assert MARKER not in _prompt(ai)
        repo.get_recent_dish_titles.assert_not_awaited()


# ---------------------------------------------------------------------------
# Brainstorm (the idea list)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestBrainstorm:
    async def test_the_avoid_list_is_in_the_prompt_before_the_users_line(self) -> None:
        ai = await _run_brainstorm(_repo(TITLES), _state("what should I cook tonight?"))
        prompt = _prompt(ai)
        assert "Tomato Chickpea Stew; Lemon Butter Pasta" in prompt
        assert prompt.index("Tomato Chickpea Stew") < prompt.index("User:")

    async def test_the_request_wins_in_brainstorm_too(self) -> None:
        ai = await _run_brainstorm(_repo(TITLES), _state("ideas like my lemon butter pasta"))
        prompt = _prompt(ai)
        assert "Tomato Chickpea Stew" in prompt
        assert "Lemon Butter Pasta" not in prompt.split("User:")[0]

    async def test_no_titles_leaves_no_block(self) -> None:
        ai = await _run_brainstorm(_repo([]), _state("what should I cook tonight?"))
        assert MARKER not in _prompt(ai)
