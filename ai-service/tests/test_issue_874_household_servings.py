"""Issue #874: the AI service's default servings honours the household size.

The first-run staples step (issue #853) stores the household size in the auth
user's `user_metadata.household_size`. The Next.js starter-context route already
lets it beat the servings learned from cooked meals; this is the same rule for
the meal workflow's `_default_servings`, where a typed "what's for dinner?" with
no number used to ignore it.

Order, highest first: an explicit number in the ask, the household size, the
mode of the last three cooked meals, 2.

The model is mocked throughout and the Supabase client is a fake: no live
provider or database needed.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.meal import (
    MealOptionLLM,
    MealOptionsLLMResult,
    MealOptionsProposal,
)
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.workflows.meal.nodes import _default_servings
from bubbly_chef.workflows.router import run_chat_workflow
from tests.test_issue_650_meal_from_chat import (
    _CONV_ID,
    _dish_llm,
    _fake_extract_recipe_constraints,
    _fake_score_pantry_ingredients,
    _meal_repo,
    _mock_classifier_ai,
    _reset_graphs,
)

# ---------------------------------------------------------------------------
# The shared fixture for the servings rule. Keep in step with the Next route's
# `computeDefaultServings` / `coerceHouseholdSize`
# (nextjs/src/__tests__/starter-context-route.test.ts, "household size").
# (household_size, recent cooked servings) -> default servings
# ---------------------------------------------------------------------------

_SERVINGS_RULE_FIXTURE: list[tuple[Any, list[int], int]] = [
    (4, [], 4),  # household size with no cooking history
    (4, [3, 3, 3], 4),  # household size beats the learned mode
    (1, [4, 4, 2], 1),  # the smallest size is still the user's answer
    (20, [2], 20),  # the largest size the app accepts
    (None, [3, 3, 2], 3),  # nothing set: the learned mode
    (None, [], 2),  # nothing at all: 2
    (0, [3, 3, 2], 3),  # unusable sizes fall through to the learned mode
    (21, [3, 3, 2], 3),
    (2.5, [3, 3, 2], 3),
    ("4", [3, 3, 2], 3),
]

_UNUSABLE_SIZES: list[Any] = [None, 0, -1, 21, 2.5, "4", True, [], {}]


# ---------------------------------------------------------------------------
# The coercion rule
# ---------------------------------------------------------------------------


class TestCoerceHouseholdSize:
    @pytest.mark.parametrize("raw", [1, 4, 6, 20, 4.0])
    def test_integers_one_to_twenty_are_kept(self, raw: Any) -> None:
        from bubbly_chef.domain.household import coerce_household_size

        assert coerce_household_size(raw) == int(raw)

    @pytest.mark.parametrize("raw", _UNUSABLE_SIZES)
    def test_everything_else_is_none(self, raw: Any) -> None:
        from bubbly_chef.domain.household import coerce_household_size

        assert coerce_household_size(raw) is None


# ---------------------------------------------------------------------------
# SupabaseRepository.get_household_size
# ---------------------------------------------------------------------------


class _FakeProfileQuery:
    def __init__(self, rows: list[dict[str, Any]], log: list[str]) -> None:
        self._rows = rows
        self._log = log
        self._eq: dict[str, Any] = {}

    def select(self, *_a: Any, **_k: Any) -> _FakeProfileQuery:
        return self

    def eq(self, field: str, value: Any) -> _FakeProfileQuery:
        self._eq[field] = value
        self._log.append(f"eq:{field}={value}")
        return self

    def execute(self) -> Any:
        rows = [r for r in self._rows if all(r.get(k) == v for k, v in self._eq.items())]
        return SimpleNamespace(data=rows)


class _FakeAdmin:
    def __init__(self, users: dict[str, dict[str, Any] | None], log: list[str]) -> None:
        self._users = users
        self._log = log

    def get_user_by_id(self, uid: str) -> Any:
        self._log.append(f"admin:{uid}")
        if uid == "boom":
            raise RuntimeError("auth down")
        if uid not in self._users:
            return SimpleNamespace(user=None)
        return SimpleNamespace(user=SimpleNamespace(user_metadata=self._users[uid]))


class _FakeClient:
    def __init__(
        self,
        *,
        users: dict[str, dict[str, Any] | None] | None = None,
        profiles: list[dict[str, Any]] | None = None,
        profile_error: bool = False,
    ) -> None:
        self.log: list[str] = []
        self.auth = SimpleNamespace(admin=_FakeAdmin(users or {}, self.log))
        self._profiles = profiles or []
        self._profile_error = profile_error

    def table(self, name: str) -> _FakeProfileQuery:
        assert name == "user_profiles"
        self.log.append("table:user_profiles")
        if self._profile_error:
            raise RuntimeError("db down")
        return _FakeProfileQuery(self._profiles, self.log)


def _repo_with(client: _FakeClient) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = client  # type: ignore[assignment]
    return repo


@pytest.mark.asyncio
class TestRepositoryGetHouseholdSize:
    async def test_reads_the_auth_metadata_with_the_service_role(self) -> None:
        client = _FakeClient(users={"u1": {"household_size": 4}})
        assert await _repo_with(client).get_household_size("u1") == 4
        # Scoped by user_id; a user with metadata never touches the profile table.
        assert client.log == ["admin:u1"]

    async def test_auth_metadata_wins_over_the_profile_column(self) -> None:
        client = _FakeClient(
            users={"u1": {"household_size": 3}},
            profiles=[{"user_id": "u1", "household_size": 5}],
        )
        assert await _repo_with(client).get_household_size("u1") == 3

    async def test_profile_column_is_the_fallback_when_metadata_is_unset(self) -> None:
        client = _FakeClient(
            users={"u1": {"onboarding_completed": True}},
            profiles=[{"user_id": "u1", "household_size": 5}],
        )
        assert await _repo_with(client).get_household_size("u1") == 5
        assert "eq:user_id=u1" in client.log

    async def test_profile_fallback_is_scoped_to_the_user(self) -> None:
        client = _FakeClient(
            users={"u1": {}},
            profiles=[{"user_id": "someone-else", "household_size": 6}],
        )
        assert await _repo_with(client).get_household_size("u1") is None

    @pytest.mark.parametrize("raw", _UNUSABLE_SIZES)
    async def test_unusable_metadata_falls_through_to_the_profile(self, raw: Any) -> None:
        client = _FakeClient(
            users={"u1": {"household_size": raw}},
            profiles=[{"user_id": "u1", "household_size": 2}],
        )
        assert await _repo_with(client).get_household_size("u1") == 2

    async def test_nothing_set_anywhere_is_none(self) -> None:
        client = _FakeClient(users={"u1": {}}, profiles=[])
        assert await _repo_with(client).get_household_size("u1") is None

    async def test_null_metadata_object_is_handled(self) -> None:
        client = _FakeClient(users={"u1": None})
        assert await _repo_with(client).get_household_size("u1") is None

    async def test_unknown_user_is_none(self) -> None:
        assert await _repo_with(_FakeClient()).get_household_size("ghost") is None

    async def test_auth_error_falls_back_to_the_profile_and_never_raises(self) -> None:
        client = _FakeClient(profiles=[{"user_id": "boom", "household_size": 3}])
        assert await _repo_with(client).get_household_size("boom") == 3

    async def test_every_source_failing_is_none_and_never_raises(self) -> None:
        client = _FakeClient(profile_error=True)
        assert await _repo_with(client).get_household_size("boom") is None


# ---------------------------------------------------------------------------
# _default_servings: the precedence
# ---------------------------------------------------------------------------


def _servings_repo(household: Any, recent: list[int]) -> MagicMock:
    repo = MagicMock()
    repo.get_household_size = AsyncMock(return_value=household)
    repo.get_recent_meal_servings = AsyncMock(return_value=recent)
    return repo


@pytest.mark.asyncio
class TestDefaultServingsPrecedence:
    @pytest.mark.parametrize(("household", "recent", "expected"), _SERVINGS_RULE_FIXTURE)
    async def test_shared_fixture(self, household: Any, recent: list[int], expected: int) -> None:
        repo = _servings_repo(household, recent)
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            assert await _default_servings("u1") == expected

    async def test_household_size_skips_the_meal_history_query(self) -> None:
        # The household read replaces the history read, so a user who set a size
        # costs no extra call over the old behaviour.
        repo = _servings_repo(4, [3, 3, 3])
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            await _default_servings("u1")
        repo.get_household_size.assert_awaited_once_with("u1")
        repo.get_recent_meal_servings.assert_not_awaited()

    async def test_household_read_failure_falls_through_to_learned_servings(self) -> None:
        repo = _servings_repo(None, [3, 3, 2])
        repo.get_household_size = AsyncMock(side_effect=RuntimeError("auth down"))
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            assert await _default_servings("u1") == 3

    async def test_repository_without_the_method_degrades_to_learned_servings(self) -> None:
        # The bare-MagicMock repos in older suites have no configured
        # `get_household_size`; awaiting the auto attribute raises TypeError.
        repo = MagicMock()
        repo.get_recent_meal_servings = AsyncMock(return_value=[4, 4, 2])
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            assert await _default_servings("u1") == 4


# ---------------------------------------------------------------------------
# Through the chat workflow: what the user actually sees on the proposal
# ---------------------------------------------------------------------------


def _two_options() -> MealOptionsLLMResult:
    return MealOptionsLLMResult(
        options=[
            MealOptionLLM(
                title=title,
                dishes=[
                    _dish_llm("main", "Roast", ["chicken"]),
                    _dish_llm("side", "Salad", ["lettuce"]),
                ],
            )
            for title in ("Family Dinner", "Family Dinner Too")
        ]
    )


async def _typed_meal_request(
    message: str,
    *,
    household: Any,
    recent: list[int],
    constraints: RecipeConstraints,
) -> tuple[MealOptionsProposal, MagicMock]:
    _reset_graphs()
    repo = _meal_repo(recent_meal_servings=recent)
    repo.get_household_size = AsyncMock(return_value=household)
    meal_ai = MagicMock()
    meal_ai.complete = AsyncMock(return_value=_two_options())
    with (
        _mock_classifier_ai("meal_plan", confidence=0.95),
        patch(
            "bubbly_chef.workflows.router.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ),
        patch(
            "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
            _fake_extract_recipe_constraints(constraints.model_dump()),
        ),
        patch(
            "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
            _fake_score_pantry_ingredients(),
        ),
        patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ),
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
    ):
        envelope = await run_chat_workflow(
            message=message, conversation_id=_CONV_ID, user_id="user-1"
        )
    _reset_graphs()
    proposal = envelope.proposal
    assert isinstance(proposal, MealOptionsProposal)
    return proposal, repo


@pytest.mark.asyncio
class TestTypedMealRequest:
    async def test_household_size_is_the_default_servings(self) -> None:
        proposal, _ = await _typed_meal_request(
            "what's for dinner?", household=4, recent=[2, 2, 2], constraints=RecipeConstraints()
        )
        assert proposal.servings == 4

    async def test_explicit_number_in_the_message_beats_the_household_size(self) -> None:
        proposal, repo = await _typed_meal_request(
            "dinner for 6",
            household=4,
            recent=[2, 2, 2],
            constraints=RecipeConstraints(servings=6),
        )
        assert proposal.servings == 6
        repo.get_household_size.assert_not_awaited()

    async def test_no_household_size_keeps_the_learned_mode(self) -> None:
        proposal, _ = await _typed_meal_request(
            "what's for dinner?", household=None, recent=[3, 3, 2], constraints=RecipeConstraints()
        )
        assert proposal.servings == 3

    async def test_nothing_known_is_two(self) -> None:
        proposal, _ = await _typed_meal_request(
            "what's for dinner?", household=None, recent=[], constraints=RecipeConstraints()
        )
        assert proposal.servings == 2
