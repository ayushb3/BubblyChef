"""Issue #652: the meal screen's two AI routes.

Route-level contract tests through the FastAPI app (auth dependency
overridden, repository and `AIManager` mocked -- no live provider or DB
required), mirroring `test_recipe_steps_ensure_route.py`'s pattern for the
same 404 / 502 `detail: {error_kind, message}` shape:

- POST /v1/meals/side-alternatives -- 3 alternatives, dedup against every
  current dish (including the one being replaced), the prompt names the
  main and the other side but never the one being replaced, fewer-than-3
  and zero-valid handling, unknown meal, model unavailable, pantry opt-out.
- POST /v1/meals/expand-dish -- a recipe at the meal's servings with
  validated structured steps carrying exclusive tags, the prompt knows
  every other dish except the one at `position`, unknown meal, model
  unavailable.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.meal import MealDishOutlineLLM, MealSideAlternativesLLMResult
from bubbly_chef.models.recipe import StepMetadata
from bubbly_chef.workflows.state import LLMRecipeResult

TEST_USER_ID = "test-user-652"
_ROUTE_MODULE = "bubbly_chef.api.routes.meals_ai"
_NODES_MODULE = "bubbly_chef.workflows.meal.nodes"
MEAL_ID = "meal-1"


@pytest.fixture
def app():
    _app = create_app()

    async def _fake_user_id() -> str:
        return TEST_USER_ID

    _app.dependency_overrides[get_current_user_id] = _fake_user_id
    return _app


@pytest_asyncio.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def _recipe_row(title: str, **overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": f"recipe-{title.lower().replace(' ', '-')}",
        "title": title,
        "description": "A tasty dish.",
        "servings": 2,
        "ingredients": [{"name": "ingredient"}],
        "instructions": ["Do the thing"],
        "steps": None,
    }
    row.update(overrides)
    return row


def _dish(role: str, position: int, title: str) -> dict[str, Any]:
    return {"role": role, "position": position, "recipe": _recipe_row(title)}


def _meal_with_dishes(
    *,
    title: str = "Cozy Pasta Night",
    servings: int = 2,
    constraints: dict[str, Any] | None = None,
    dishes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    default_dishes = [
        _dish("main", 0, "Creamy Pasta"),
        _dish("side", 1, "Garlic Bread"),
        _dish("side", 2, "Roasted Carrots"),
    ]
    return {
        "meal": {
            "id": MEAL_ID,
            "user_id": TEST_USER_ID,
            "title": title,
            "servings": servings,
            "constraints": constraints or {},
        },
        "dishes": dishes if dishes is not None else default_dishes,
    }


def _repo(meal_with_dishes: dict[str, Any] | None, pantry_items: list[Any] | None = None) -> MagicMock:
    repo = MagicMock()
    repo.get_meal_with_dishes = AsyncMock(return_value=meal_with_dishes)
    repo.get_all_pantry_items = AsyncMock(return_value=pantry_items or [])
    return repo


def _alt_llm(role: str, name: str, blurb: str | None = "Tasty and quick.") -> MealDishOutlineLLM:
    return MealDishOutlineLLM(
        role=role,  # type: ignore[arg-type]
        name=name,
        blurb=blurb,
        key_ingredients=["a", "b", "c"],
        est_total_minutes=15,
        est_hands_on_minutes=8,
    )


def _recipe_llm_result(title: str, n_steps: int = 2, servings: int = 2, exclusive: list[str] | None = None) -> LLMRecipeResult:
    instructions = [f"Step {i + 1} for {title}" for i in range(n_steps)]
    steps = [
        StepMetadata(
            label=f"Step {i + 1}",
            exclusive=exclusive if (exclusive and i == 0) else [],
        )
        for i in range(n_steps)
    ]
    return LLMRecipeResult(
        title=title,
        description="A tasty dish.",
        prep_time_minutes=10,
        cook_time_minutes=15,
        total_time_minutes=25,
        servings=servings,
        ingredients=[{"name": "broccolini"}, {"name": "lemon"}],
        instructions=instructions,
        steps=steps,
    )


def _patched(repo: MagicMock, ai: MagicMock):
    return (
        patch(f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)),
        patch(f"{_ROUTE_MODULE}.get_ai_manager", return_value=ai),
        patch(f"{_NODES_MODULE}.get_repository", AsyncMock(return_value=repo)),
    )


# ---------------------------------------------------------------------------
# POST /v1/meals/side-alternatives
# ---------------------------------------------------------------------------


class TestSideAlternatives:
    @pytest.mark.asyncio
    async def test_three_alternatives_excluding_current_dishes(self, client):
        repo = _repo(_meal_with_dishes())
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[
                    _alt_llm("side", "Charred Broccolini"),
                    _alt_llm("side", "Lemon Asparagus"),
                    _alt_llm("side", "Herby Couscous"),
                ]
            )
        )

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/side-alternatives", json={"meal_id": MEAL_ID, "position": 1}
            )

        assert response.status_code == 200, response.text
        body = response.json()
        names = [a["name"] for a in body["alternatives"]]
        assert names == ["Charred Broccolini", "Lemon Asparagus", "Herby Couscous"]
        assert all(a["role"] == "side" for a in body["alternatives"])
        assert body["alternatives"][0]["blurb"] == "Tasty and quick."
        assert "Garlic Bread" not in names
        assert "Roasted Carrots" not in names
        assert "Creamy Pasta" not in names

    @pytest.mark.asyncio
    async def test_prompt_names_main_and_other_side_but_not_replaced(self, client):
        repo = _repo(_meal_with_dishes())
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[_alt_llm("side", "Charred Broccolini")]
            )
        )

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/side-alternatives", json={"meal_id": MEAL_ID, "position": 1}
            )

        assert response.status_code == 200, response.text
        prompt = ai.complete.await_args.kwargs["prompt"]
        assert "Creamy Pasta" in prompt  # the main
        assert "Roasted Carrots" in prompt  # the other side (position 2)
        assert "Garlic Bread" not in prompt  # the side being replaced (position 1)

    @pytest.mark.asyncio
    async def test_fewer_than_three_valid_alternatives_are_kept(self, client):
        """A duplicate of a current dish and a wrong-role entry are dropped;
        the one genuinely valid alternative survives."""
        repo = _repo(_meal_with_dishes())
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[
                    _alt_llm("side", "Roasted Carrots"),  # duplicates a current dish
                    _alt_llm("main", "Some Main"),  # wrong role
                    _alt_llm("side", "Charred Broccolini"),  # valid
                ]
            )
        )

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/side-alternatives", json={"meal_id": MEAL_ID, "position": 1}
            )

        assert response.status_code == 200, response.text
        alternatives = response.json()["alternatives"]
        assert len(alternatives) == 1
        assert alternatives[0]["name"] == "Charred Broccolini"

    @pytest.mark.asyncio
    async def test_zero_valid_alternatives_returns_502(self, client):
        repo = _repo(_meal_with_dishes())
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[
                    _alt_llm("side", "Garlic Bread"),  # duplicates the one being replaced
                    _alt_llm("main", "Some Main"),  # wrong role
                ]
            )
        )

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/side-alternatives", json={"meal_id": MEAL_ID, "position": 1}
            )

        assert response.status_code == 502, response.text
        assert response.json()["detail"]["error_kind"] == "invalid_output"

    @pytest.mark.asyncio
    async def test_unknown_meal_returns_404(self, client):
        repo = _repo(None)
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=AssertionError("AI called for unknown meal"))

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/side-alternatives", json={"meal_id": "ghost", "position": 1}
            )

        assert response.status_code == 404, response.text
        ai.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_model_unavailable_returns_502(self, client):
        repo = _repo(_meal_with_dishes())
        ai = MagicMock()
        ai.complete = AsyncMock(
            side_effect=NoProviderAvailableError("no provider", kind="quota_exhausted", configured=True)
        )

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/side-alternatives", json={"meal_id": MEAL_ID, "position": 1}
            )

        assert response.status_code == 502, response.text
        assert response.json()["detail"]["error_kind"] == "model_unavailable"

    @pytest.mark.asyncio
    async def test_add_a_side_omits_position_and_names_the_sole_side(self, client):
        """No `position` -- adding a second side. The lone existing side is
        the "other side" named in the prompt."""
        meal = _meal_with_dishes(
            dishes=[_dish("main", 0, "Creamy Pasta"), _dish("side", 1, "Garlic Bread")]
        )
        repo = _repo(meal)
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[_alt_llm("side", "Charred Broccolini")]
            )
        )

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post("/v1/meals/side-alternatives", json={"meal_id": MEAL_ID})

        assert response.status_code == 200, response.text
        prompt = ai.complete.await_args.kwargs["prompt"]
        assert "Garlic Bread" in prompt  # the sole current side, named as "the other side"

    @pytest.mark.asyncio
    async def test_pantry_optout_never_reads_pantry(self, client):
        meal = _meal_with_dishes(constraints={"recipe_constraints": {"use_pantry": False}})
        repo = _repo(meal)
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[_alt_llm("side", "Charred Broccolini")]
            )
        )

        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/side-alternatives", json={"meal_id": MEAL_ID, "position": 1}
            )

        assert response.status_code == 200, response.text
        repo.get_all_pantry_items.assert_not_awaited()
        prompt = ai.complete.await_args.kwargs["prompt"]
        assert "NOT to use their pantry" in prompt


# ---------------------------------------------------------------------------
# POST /v1/meals/expand-dish
# ---------------------------------------------------------------------------


class TestExpandDish:
    @pytest.mark.asyncio
    async def test_returns_recipe_at_meal_servings_with_structured_steps(self, client):
        repo = _repo(_meal_with_dishes(servings=4))
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_recipe_llm_result("Charred Broccolini", n_steps=2, servings=4))

        outline = {
            "role": "side",
            "name": "Charred Broccolini",
            "key_ingredients": ["broccolini", "lemon"],
            "est_total_minutes": 12,
            "est_hands_on_minutes": 6,
        }
        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/expand-dish",
                json={"meal_id": MEAL_ID, "position": 1, "outline": outline},
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["proposal_type"] == "meal_dish"
        assert body["role"] == "side"
        assert body["position"] == 1
        recipe = body["recipe"]
        assert recipe["servings"] == 4
        assert recipe["steps"] is not None
        assert len(recipe["steps"]) == len(recipe["instructions"])

    @pytest.mark.asyncio
    async def test_exclusive_tags_carry_through_to_steps(self, client):
        repo = _repo(
            _meal_with_dishes(constraints={"exclusive_tags": ["pan"], "kitchen_limits": ["one pan"]})
        )
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_recipe_llm_result("Charred Broccolini", n_steps=2, exclusive=["pan"])
        )

        outline = {"role": "side", "name": "Charred Broccolini", "key_ingredients": []}
        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/expand-dish",
                json={"meal_id": MEAL_ID, "position": 1, "outline": outline},
            )

        assert response.status_code == 200, response.text
        steps = response.json()["recipe"]["steps"]
        assert steps[0]["exclusive"] == ["pan"]

        prompt = ai.complete.await_args.kwargs["prompt"]
        assert "pan" in prompt

    @pytest.mark.asyncio
    async def test_prompt_knows_other_dishes_but_not_the_one_at_position(self, client):
        repo = _repo(_meal_with_dishes())
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_recipe_llm_result("Charred Broccolini"))

        outline = {"role": "side", "name": "Charred Broccolini", "key_ingredients": []}
        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/expand-dish",
                json={"meal_id": MEAL_ID, "position": 1, "outline": outline},
            )

        assert response.status_code == 200, response.text
        prompt = ai.complete.await_args.kwargs["prompt"]
        assert "Creamy Pasta" in prompt  # position 0, kept
        assert "Roasted Carrots" in prompt  # position 2, kept
        assert "Garlic Bread" not in prompt  # position 1 -- being replaced

    @pytest.mark.asyncio
    async def test_unknown_meal_returns_404(self, client):
        repo = _repo(None)
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=AssertionError("AI called for unknown meal"))

        outline = {"role": "side", "name": "Charred Broccolini", "key_ingredients": []}
        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/expand-dish",
                json={"meal_id": "ghost", "position": 1, "outline": outline},
            )

        assert response.status_code == 404, response.text
        ai.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_model_unavailable_returns_502(self, client):
        repo = _repo(_meal_with_dishes())
        ai = MagicMock()
        ai.complete = AsyncMock(
            side_effect=NoProviderAvailableError("no provider", kind="auth", configured=True)
        )

        outline = {"role": "side", "name": "Charred Broccolini", "key_ingredients": []}
        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/expand-dish",
                json={"meal_id": MEAL_ID, "position": 1, "outline": outline},
            )

        assert response.status_code == 502, response.text
        assert response.json()["detail"]["error_kind"] == "model_unavailable"

    @pytest.mark.asyncio
    async def test_pantry_optout_never_reads_pantry(self, client):
        repo = _repo(
            _meal_with_dishes(constraints={"recipe_constraints": {"use_pantry": False}})
        )
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_recipe_llm_result("Charred Broccolini"))

        outline = {"role": "side", "name": "Charred Broccolini", "key_ingredients": []}
        p1, p2, p3 = _patched(repo, ai)
        with p1, p2, p3:
            response = await client.post(
                "/v1/meals/expand-dish",
                json={"meal_id": MEAL_ID, "position": 1, "outline": outline},
            )

        assert response.status_code == 200, response.text
        repo.get_all_pantry_items.assert_not_awaited()
        prompt = ai.complete.await_args.kwargs["prompt"]
        assert "NOT to use their pantry" in prompt
