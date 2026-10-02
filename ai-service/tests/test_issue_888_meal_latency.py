"""Issue #888: cut avoidable latency on the meal pick and add-a-side AI paths.

The model is faked with a provider that sleeps a fixed time per call (`LLM_S`), and
the repository with one that BLOCKS a fixed time per read (`DB_S`) exactly the way
the real one does: `SupabaseRepository` wraps the synchronous supabase client, so a
read stalls the event loop and `asyncio.gather` over repo coroutines is not
concurrent. The tests read the critical path off a shared event log:

- how many LLM calls run, and which (no classifier or other redundant call);
- how long until the first LLM call can start (all the DB work before the model);
- the whole turn's wall time.

Printed with `-s`, the numbers feed the PR's before/after table.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealCoverage,
    MealDishOutline,
    MealDishOutlineLLM,
    MealOption,
    MealPlanSessionState,
    MealSideAlternativesLLMResult,
)
from bubbly_chef.models.pantry import FoodCategory, PantryItem
from bubbly_chef.models.recipe import StepMetadata
from bubbly_chef.models.session import ConversationSession, SessionContext, SessionMode
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.workflows.meal.nodes import MealDishLLMResult
from bubbly_chef.workflows.state import LLMRecipeResult

USER = "user-888"
CONV = "88888888-8888-8888-8888-888888888888"
MEAL_ID = "meal-888"

DB_S = 0.1  # one blocking repository read
LLM_S = 0.2  # one model call


class _Log:
    """Time-stamped event log shared by the fake repo and fake model."""

    def __init__(self) -> None:
        self.t0 = time.perf_counter()
        self.events: list[tuple[str, float]] = []
        # (name, start, end) of every blocking read/write, for overlap checks.
        self.spans: list[tuple[str, float, float]] = []

    @contextmanager
    def span(self, name: str) -> Iterator[None]:
        self.add(name)
        start = self.now()
        try:
            yield
        finally:
            self.spans.append((name, start, self.now()))

    def db_spans(self, *, before_first_llm: bool = False) -> list[tuple[str, float, float]]:
        cutoff = self.first("llm:") if before_first_llm else float("inf")
        return [sp for sp in self.spans if sp[0].startswith("db:") and sp[1] < cutoff]

    def span_of(self, name: str) -> list[tuple[str, float, float]]:
        return [sp for sp in self.spans if sp[0] == name]

    def rounds(self, spans: list[tuple[str, float, float]]) -> int:
        """How many back-to-back groups the spans form: reads that overlap in time
        share a round, so N reads one after another are N rounds and N reads issued
        together are 1. Structural, so it does not depend on how fast the machine is."""
        rounds = 0
        end = -1.0
        for _, start, stop in sorted(spans, key=lambda sp: sp[1]):
            if start >= end:
                rounds += 1
                end = stop
            else:
                end = max(end, stop)
        return rounds

    def now(self) -> float:
        return time.perf_counter() - self.t0

    def add(self, name: str) -> None:
        self.events.append((name, self.now()))

    def names(self) -> list[str]:
        return [n for n, _ in self.events]

    def first(self, prefix: str) -> float:
        return next(t for n, t in self.events if n.startswith(prefix))

    def llm_calls(self) -> list[str]:
        return [n for n in self.names() if n.startswith("llm:")]


class _BlockingRepo:
    """A repo whose every read blocks like the sync supabase client does."""

    def __init__(self, log: _Log, session: ConversationSession, meal: dict[str, Any] | None):
        self._log = log
        self._session = session
        self._meal = meal

    def _op(self, name: str) -> None:
        with self._log.span(f"db:{name}"):
            time.sleep(DB_S)

    async def get_history(self, **_: Any) -> list[dict[str, Any]]:
        self._op("get_history")
        return []

    async def save_message(self, **kwargs: Any) -> None:
        self._op(f"save_message:{kwargs.get('role')}")

    async def get_or_create_session(self, *_: Any) -> ConversationSession:
        self._op("get_or_create_session")
        return self._session

    async def update_session(self, *_: Any) -> None:
        self._op("update_session")

    async def get_all_pantry_items(self, *_: Any) -> list[PantryItem]:
        self._op("get_all_pantry_items")
        return [PantryItem(name="pasta", category=FoodCategory.OTHER, quantity=2.0)]

    async def get_profile(self, *_: Any) -> dict[str, Any]:
        self._op("get_profile")
        return {}

    async def get_meal_with_dishes(self, *_: Any) -> dict[str, Any] | None:
        self._op("get_meal_with_dishes")
        return self._meal


def _recipe(title: str, *, follow_ups: bool) -> LLMRecipeResult:
    fields: dict[str, Any] = {
        "title": title,
        "servings": 2,
        "ingredients": [{"name": "pasta"}],
        "instructions": ["Cook it"],
        "steps": [StepMetadata(label="Cook it")],
    }
    if follow_ups:
        return MealDishLLMResult(**fields, follow_ups=["Make it spicier"])
    return LLMRecipeResult(**fields)


class _SleepingModel:
    """A provider that sleeps LLM_S per call, whatever the schema."""

    def __init__(self, log: _Log) -> None:
        self._log = log
        self._n = 0

    async def complete(
        self, prompt: str, response_schema: Any = None, temperature: float = 0.7
    ) -> Any:
        self._n += 1
        name = response_schema.__name__ if response_schema is not None else "text"
        self._log.add(f"llm:{name}")
        await asyncio.sleep(LLM_S)
        if response_schema is MealSideAlternativesLLMResult:
            return MealSideAlternativesLLMResult(
                alternatives=[
                    MealDishOutlineLLM(role="side", name=f"Side {i}", key_ingredients=["x"])
                    for i in range(3)
                ]
            )
        return _recipe(f"Dish {self._n}", follow_ups=response_schema is MealDishLLMResult)


def _pick_session() -> ConversationSession:
    option = MealOption(
        option_id="opt_1",
        title="Cozy Pasta Night",
        dishes=[
            MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta"]),
            MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread"]),
            MealDishOutline(role="side", name="Green Salad", key_ingredients=["lettuce"]),
        ],
        coverage=MealCoverage(pantry_items_used=1, to_buy=[]),
    )
    state = MealPlanSessionState(
        options=[option], servings=2, constraints=MealConstraintsEcho()
    )
    return ConversationSession(
        conversation_id=CONV,
        active_mode=SessionMode.DEFAULT,
        metadata=SessionContext(meal_plan=state),
    )


def _meal_row() -> dict[str, Any]:
    def dish(role: str, position: int, title: str) -> dict[str, Any]:
        return {
            "role": role,
            "position": position,
            "recipe_id": f"r{position}",
            "recipe": {"title": title},
        }

    return {
        "meal": {"id": MEAL_ID, "title": "Cozy Pasta Night", "servings": 2, "constraints": {}},
        "dishes": [dish("main", 0, "Creamy Pasta"), dish("side", 1, "Garlic Bread")],
    }


def _reset_graphs() -> None:
    import bubbly_chef.workflows.router as router_mod

    router_mod._chat_router_graph = None
    router_mod._chat_dispatch_graph = None


@contextmanager
def _world(repo: Any, model: Any) -> Iterator[None]:
    async def _get_repo() -> Any:
        return repo

    patches = [
        patch(f"{mod}.get_repository", _get_repo)
        for mod in (
            "bubbly_chef.api.routes.chat",
            "bubbly_chef.api.routes.meals_ai",
            "bubbly_chef.workflows.router",
            "bubbly_chef.workflows.meal.nodes",
            "bubbly_chef.services.food_exclusions",
            "bubbly_chef.services.expiry_priority",
        )
    ] + [
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=model)),
        patch("bubbly_chef.api.routes.meals_ai.get_ai_manager", MagicMock(return_value=model)),
    ]
    _reset_graphs()
    for p in patches:
        p.start()
    try:
        # Compile the graph now so its one-off build is not billed to the turn.
        from bubbly_chef.workflows.router import get_chat_dispatch_graph

        get_chat_dispatch_graph()
        yield
    finally:
        for p in patches:
            p.stop()
        _reset_graphs()


@pytest_asyncio.fixture
async def client() -> Any:
    app = create_app()

    async def _fake_user_id() -> str:
        return USER

    app.dependency_overrides[get_current_user_id] = _fake_user_id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _report(label: str, log: _Log, elapsed: float) -> None:
    print(
        f"\n[#888] {label}: llm_calls={len(log.llm_calls())} "
        f"db_ops={sum(n.startswith('db:') for n in log.names())} "
        f"first_llm_at={log.first('llm:'):.2f}s total={elapsed:.2f}s"
    )


async def _pick(client: AsyncClient, **body: Any) -> tuple[_Log, float, list[dict[str, Any]]]:
    log = _Log()
    repo = _BlockingRepo(log, _pick_session(), None)
    with _world(repo, _SleepingModel(log)):
        log.t0 = start = time.perf_counter()
        response = await client.post(
            "/v1/chat/stream",
            json={
                "message": "Cozy Pasta Night",
                "conversation_id": CONV,
                "context": {"meal_option_id": "opt_1"},
                **body,
            },
        )
        elapsed = time.perf_counter() - start
    events = [
        json.loads(line[len("data: ") :])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    return log, elapsed, events


# ---------------------------------------------------------------------------
# Meal pick: POST /v1/chat/stream with context.meal_option_id
# ---------------------------------------------------------------------------


class TestMealPick:
    @pytest.mark.asyncio
    async def test_pick_makes_exactly_one_model_call_per_dish_and_no_other(
        self, client: AsyncClient
    ) -> None:
        log, elapsed, events = await _pick(client)
        _report("meal pick", log, elapsed)

        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["intent"] == "meal_plan"
        assert len(envelope["proposal"]["dishes"]) == 3
        # 3 dishes -> 3 model calls, all dish expansions: no intent classifier, no
        # constraint extraction, no follow-up pass, no planner.
        assert sorted(log.llm_calls()) == ["llm:LLMRecipeResult"] * 2 + ["llm:MealDishLLMResult"]

    @pytest.mark.asyncio
    async def test_pick_does_not_read_history_it_never_uses(self, client: AsyncClient) -> None:
        log, _, _ = await _pick(client)
        assert "db:get_history" not in log.names()

    @pytest.mark.asyncio
    async def test_a_forced_intent_pick_still_reads_history(self, client: AsyncClient) -> None:
        # A chip override beats meal_option_id in classify_intent, so that turn can
        # reach history-reading nodes; it keeps the read.
        log, _, _ = await _pick(client, forced_intent="recipe_card")
        assert "db:get_history" in log.names()

    @pytest.mark.asyncio
    async def test_user_turn_is_still_saved_before_the_assistant_turn(
        self, client: AsyncClient
    ) -> None:
        log, _, _ = await _pick(client)
        saves = [n for n in log.names() if n.startswith("db:save_message")]
        assert saves == ["db:save_message:user", "db:save_message:assistant"]

    @pytest.mark.asyncio
    async def test_the_dish_reads_overlap_each_other(self, client: AsyncClient) -> None:
        log, _, _ = await _pick(client)
        reads = log.span_of("db:get_all_pantry_items") + log.span_of("db:get_profile")
        assert len(reads) == 3  # pantry, allergies, expiry priority
        assert log.rounds(reads) == 1

    @pytest.mark.asyncio
    async def test_pick_has_fewer_rounds_in_front_of_the_model(self, client: AsyncClient) -> None:
        # main: history, user save, session, 2 profile reads, pantry = 6 rounds in a row.
        # Now: the session (with the user save beside it), then the three dish reads.
        log, _, _ = await _pick(client)
        assert log.rounds(log.db_spans(before_first_llm=True)) <= 3
        # The model starts only after every one of those reads has finished.
        first_llm = log.first("llm:")
        assert all(end <= first_llm for _, _, end in log.db_spans(before_first_llm=True))

    @pytest.mark.asyncio
    async def test_pick_critical_path_has_fewer_rounds(self, client: AsyncClient) -> None:
        # main: 9 database rounds in a row around the one model unit. Now 5 (session,
        # dish reads, re-read session, update session, assistant save), the user save
        # overlapping the first.
        log, _, _ = await _pick(client)
        assert log.rounds(log.db_spans()) <= 6


# ---------------------------------------------------------------------------
# Add a side: side-alternatives, then expand-dish
# ---------------------------------------------------------------------------


class TestAddASide:
    @staticmethod
    def _assert_two_rounds_then_the_model(log: _Log) -> None:
        # main: meal, allergies, expiry priority, pantry = 4 rounds one after another.
        # Now: [meal | allergies], then [expiry priority | pantry], then the model.
        before_model = log.db_spans(before_first_llm=True)
        assert len(before_model) == 4
        assert log.rounds(before_model) == 2
        first_llm = log.first("llm:")
        assert all(end <= first_llm for _, _, end in before_model)

    @pytest.mark.asyncio
    async def test_side_alternatives_one_model_call_and_reads_overlap(
        self, client: AsyncClient
    ) -> None:
        log = _Log()
        repo = _BlockingRepo(log, _pick_session(), _meal_row())
        with _world(repo, _SleepingModel(log)):
            log.t0 = start = time.perf_counter()
            response = await client.post("/v1/meals/side-alternatives", json={"meal_id": MEAL_ID})
            elapsed = time.perf_counter() - start
        _report("side-alternatives", log, elapsed)

        assert response.status_code == 200
        assert log.llm_calls() == ["llm:MealSideAlternativesLLMResult"]
        self._assert_two_rounds_then_the_model(log)

    @pytest.mark.asyncio
    async def test_expand_dish_one_model_call_and_reads_overlap(
        self, client: AsyncClient
    ) -> None:
        log = _Log()
        repo = _BlockingRepo(log, _pick_session(), _meal_row())
        with _world(repo, _SleepingModel(log)):
            log.t0 = start = time.perf_counter()
            response = await client.post(
                "/v1/meals/expand-dish",
                json={
                    "meal_id": MEAL_ID,
                    "position": 2,
                    "outline": {"role": "side", "name": "Slaw", "key_ingredients": ["cabbage"]},
                },
            )
            elapsed = time.perf_counter() - start
        _report("expand-dish", log, elapsed)

        assert response.status_code == 200
        assert log.llm_calls() == ["llm:LLMRecipeResult"]
        self._assert_two_rounds_then_the_model(log)


# ---------------------------------------------------------------------------
# The repository read the meal routes sit on
# ---------------------------------------------------------------------------


class _SlowQuery:
    def __init__(self, table: str, rows: dict[str, list[dict[str, Any]]], log: _Log) -> None:
        self._table = table
        self._rows = rows
        self._log = log
        self._filters: dict[str, Any] = {}

    def select(self, *_: Any) -> _SlowQuery:
        return self

    def eq(self, column: str, value: Any) -> _SlowQuery:
        self._filters[column] = value
        return self

    def order(self, *_: Any, **__: Any) -> _SlowQuery:
        return self

    def limit(self, *_: Any) -> _SlowQuery:
        return self

    def execute(self) -> Any:
        with self._log.span(f"db:{self._table}"):
            time.sleep(DB_S)  # a sync HTTP round trip
        data = self._rows[self._table]
        if self._table == "recipes":
            data = [r for r in data if r["id"] == self._filters["id"]]
        return MagicMock(data=data)


class _SlowClient:
    def __init__(self, rows: dict[str, list[dict[str, Any]]], log: _Log) -> None:
        self._rows = rows
        self._log = log

    def table(self, name: str) -> _SlowQuery:
        return _SlowQuery(name, self._rows, self._log)


class TestGetMealWithDishes:
    @pytest.mark.asyncio
    async def test_dish_recipes_are_read_together_and_stay_in_position_order(self) -> None:
        log = _Log()
        repo = SupabaseRepository.__new__(SupabaseRepository)
        repo.client = _SlowClient(  # type: ignore[assignment]
            {
                "meals": [{"id": MEAL_ID, "title": "Night"}],
                "meal_dishes": [
                    {"role": "main", "position": 0, "recipe_id": "a"},
                    {"role": "side", "position": 1, "recipe_id": "b"},
                    {"role": "side", "position": 2, "recipe_id": "c"},
                ],
                "recipes": [{"id": i, "title": f"Recipe {i}"} for i in "abc"],
            },
            log,
        )

        result = await repo.get_meal_with_dishes(USER, MEAL_ID)

        assert result is not None
        assert [d["recipe"]["title"] for d in result["dishes"]] == [
            "Recipe a",
            "Recipe b",
            "Recipe c",
        ]
        assert [d["position"] for d in result["dishes"]] == [0, 1, 2]
        # main: meal, dishes and 3 recipes in a row = 5 rounds. Now 3: the recipes together.
        recipe_reads = log.span_of("db:recipes")
        assert len(recipe_reads) == 3
        assert log.rounds(recipe_reads) == 1
        assert log.rounds(log.spans) == 3
