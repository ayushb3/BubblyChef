"""Tests for GET /v1/dashboard/daily (#225, #168).

Covers the route wiring, the AI-provider-down fallback, the no-saved-recipes
case, and cache behaviour. `rank_recipes` itself is covered without any of
this machinery in `test_dashboard_ranking.py`; here the LLM is always mocked.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.dashboard import DashboardCopyResult
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services import dashboard_service
from bubbly_chef.services.dashboard_ranking import RankedRecipe

TEST_USER_ID = "test-user-dashboard"

_ROUTE_MODULE = "bubbly_chef.api.routes.dashboard"


@pytest.fixture(autouse=True)
def _clear_cache():
    dashboard_service.clear_dashboard_cache()
    yield
    dashboard_service.clear_dashboard_cache()


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


def _pantry_item(name: str, expiry_days: int | None = None) -> PantryItem:
    expiry = (date.today() + timedelta(days=expiry_days)) if expiry_days is not None else None
    return PantryItem(
        id=uuid.uuid4(),
        name=name,
        category=FoodCategory.OTHER,
        storage_location=StorageLocation.PANTRY,
        quantity=1.0,
        unit="item",
        quantity_base=1.0,
        unit_base="count",
        expiry_date=expiry,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _recipe_row(recipe_id: str, title: str, ingredients: list[str]) -> dict:
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, recipe_id)),
        "title": title,
        "ingredients": [{"name": n, "quantity": 1, "unit": "count"} for n in ingredients],
        "meal_type": None,
        "total_time_minutes": 15,
        "created_at": "2026-01-01T00:00:00+00:00",
    }


def _fake_repo(pantry_items: list[PantryItem], recipes: list[dict]) -> MagicMock:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=pantry_items)
    repo.get_user_recipes = AsyncMock(return_value=recipes)
    repo.get_profile = AsyncMock(return_value={"dietary_preferences": []})
    return repo


def _fake_ai_manager_success() -> MagicMock:
    manager = MagicMock()
    manager.complete = AsyncMock(
        return_value=DashboardCopyResult(
            tip_text="Rest your meat before slicing.",
            tip_category="technique",
            suggestion_copy="Your chicken is about to turn — cook it tonight.",
        )
    )
    return manager


def _fake_ai_manager_unavailable() -> MagicMock:
    manager = MagicMock()
    manager.complete = AsyncMock(side_effect=NoProviderAvailableError("no providers"))
    return manager


@pytest.fixture
def repo_and_ai(monkeypatch):
    """Patch get_repository/get_ai_manager as imported inside the route module."""

    def _apply(repo: MagicMock, ai_manager: MagicMock) -> None:
        monkeypatch.setattr(
            f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)
        )
        monkeypatch.setattr(f"{_ROUTE_MODULE}.get_ai_manager", lambda: ai_manager)

    return _apply


@pytest.mark.asyncio
async def test_returns_ai_suggestion_when_provider_available(client, repo_and_ai) -> None:
    pantry = [_pantry_item("chicken", expiry_days=1)]
    recipes = [_recipe_row("r1", "Chicken soup", ["chicken"])]
    repo_and_ai(_fake_repo(pantry, recipes), _fake_ai_manager_success())

    resp = await client.get("/v1/dashboard/daily")

    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "ai"
    assert body["tip"]["text"] == "Rest your meat before slicing."
    assert body["suggestion"]["recipe_id"] == recipes[0]["id"]
    assert body["suggestion"]["title"] == "Chicken soup"
    assert body["suggestion"]["reason"] == "expiring"


@pytest.mark.asyncio
async def test_no_saved_recipes_gives_null_suggestion_no_error(client, repo_and_ai) -> None:
    repo_and_ai(_fake_repo([], []), _fake_ai_manager_success())

    resp = await client.get("/v1/dashboard/daily")

    assert resp.status_code == 200
    body = resp.json()
    assert body["suggestion"] is None
    assert body["tip"]["text"]


@pytest.mark.asyncio
async def test_fallback_when_ai_unavailable(client, repo_and_ai) -> None:
    pantry = [_pantry_item("chicken", expiry_days=1)]
    recipes = [_recipe_row("r1", "Chicken soup", ["chicken"])]
    repo_and_ai(_fake_repo(pantry, recipes), _fake_ai_manager_unavailable())

    resp = await client.get("/v1/dashboard/daily")

    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "fallback"
    assert body["tip"]["text"]
    assert body["suggestion"]["reason"] == "fallback"
    assert body["suggestion"]["title"] == "Chicken soup"


@pytest.mark.asyncio
async def test_fallback_with_no_recipes_still_returns_tip(client, repo_and_ai) -> None:
    repo_and_ai(_fake_repo([], []), _fake_ai_manager_unavailable())

    resp = await client.get("/v1/dashboard/daily")

    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "fallback"
    assert body["suggestion"] is None
    assert body["tip"]["text"]


@pytest.mark.asyncio
async def test_unauthenticated_request_rejected() -> None:
    app = create_app()  # no auth override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/v1/dashboard/daily")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_same_day_same_pantry_hits_cache_not_a_second_ai_call(client, repo_and_ai) -> None:
    pantry = [_pantry_item("chicken", expiry_days=1)]
    recipes = [_recipe_row("r1", "Chicken soup", ["chicken"])]
    ai_manager = _fake_ai_manager_success()
    repo_and_ai(_fake_repo(pantry, recipes), ai_manager)

    resp1 = await client.get("/v1/dashboard/daily")
    resp2 = await client.get("/v1/dashboard/daily")

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["tip"] == resp2.json()["tip"]
    assert ai_manager.complete.await_count == 1


# ---------------------------------------------------------------------------
# Finding 1 (BLOCKER): tz_offset_minutes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tz_offset_out_of_range_is_rejected(client, repo_and_ai) -> None:
    repo_and_ai(_fake_repo([], []), _fake_ai_manager_success())

    resp = await client.get("/v1/dashboard/daily", params={"tz_offset_minutes": 10000})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_tz_offset_defaults_to_utc_when_omitted(client, repo_and_ai) -> None:
    repo_and_ai(_fake_repo([], []), _fake_ai_manager_success())

    resp = await client.get("/v1/dashboard/daily")

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_tz_offset_changes_meal_time_bucket_used_for_ranking(monkeypatch) -> None:
    """15:00 UTC is 'snack' by the ranking rule. Shifting the client 12 hours
    east (tz_offset_minutes=720) makes local time 03:00 the next day —
    'late-night' -> also folds to 'snack'. Pick offsets that land on
    genuinely different buckets instead: 15:00 UTC (snack) vs. 15:00 UTC + a
    -8h offset = 07:00 local (breakfast)."""
    pantry: list[PantryItem] = []
    breakfast_recipe = _recipe_row("bfast", "Pancakes", [])
    breakfast_recipe["meal_type"] = "breakfast"
    snack_recipe = _recipe_row("snack", "Chips", [])
    snack_recipe["meal_type"] = "snack"
    recipes = [breakfast_recipe, snack_recipe]

    fixed_utc_now = datetime(2026, 1, 1, 15, 0, tzinfo=UTC)  # 15:00 UTC -> "snack" bucket
    repo = _fake_repo(pantry, recipes)
    ai_manager = _fake_ai_manager_success()

    # UTC (offset 0): bucket is "snack" -> snack_recipe should win the
    # meal-time signal (all else equal, both recipes have zero pantry match).
    resp_utc = await dashboard_service.get_dashboard_daily(
        TEST_USER_ID, ai_manager=ai_manager, repo=repo, now=fixed_utc_now, tz_offset_minutes=0
    )
    assert resp_utc.suggestion is not None
    assert resp_utc.suggestion.title == "Chips"

    dashboard_service.clear_dashboard_cache()

    # -8 hours -> local time 07:00 -> "breakfast" bucket -> breakfast_recipe wins.
    resp_shifted = await dashboard_service.get_dashboard_daily(
        TEST_USER_ID,
        ai_manager=ai_manager,
        repo=repo,
        now=fixed_utc_now,
        tz_offset_minutes=-8 * 60,
    )
    assert resp_shifted.suggestion is not None
    assert resp_shifted.suggestion.title == "Pancakes"


# ---------------------------------------------------------------------------
# Finding 3 (BLOCKER): tip must be grounded in the general pantry, not just
# the winning recipe's ingredients
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prompt_differs_between_pantries_with_no_recipes_or_dietary(monkeypatch) -> None:
    """Reproduces the review's exact repro: two users, no saved recipes, no
    dietary preferences — the prompt must still differ because the pantries
    differ. Asserts on the prompt actually sent to `complete`, not just the
    (mocked, identical) return value."""
    ai_manager = _fake_ai_manager_success()

    repo_a = _fake_repo([_pantry_item("kale", expiry_days=2)], [])
    await dashboard_service.get_dashboard_daily(
        "user-a", ai_manager=ai_manager, repo=repo_a, now=datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    )
    prompt_a = ai_manager.complete.call_args.kwargs["prompt"]

    repo_b = _fake_repo([_pantry_item("beef", expiry_days=2)], [])
    await dashboard_service.get_dashboard_daily(
        "user-b", ai_manager=ai_manager, repo=repo_b, now=datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    )
    prompt_b = ai_manager.complete.call_args.kwargs["prompt"]

    assert prompt_a != prompt_b
    assert "kale" in prompt_a
    assert "beef" not in prompt_a
    assert "beef" in prompt_b
    assert "kale" not in prompt_b


@pytest.mark.asyncio
async def test_prompt_includes_pantry_even_without_a_suggestion() -> None:
    ai_manager = _fake_ai_manager_success()
    repo = _fake_repo([_pantry_item("spinach", expiry_days=1)], [])  # no saved recipes

    await dashboard_service.get_dashboard_daily(
        TEST_USER_ID, ai_manager=ai_manager, repo=repo, now=datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    )

    prompt = ai_manager.complete.call_args.kwargs["prompt"]
    assert "spinach" in prompt
    assert "No suggested recipe today" in prompt


# ---------------------------------------------------------------------------
# Finding 4 (BLOCKER): cache must invalidate when a non-newest pantry row is
# deleted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_invalidates_when_older_pantry_item_is_deleted() -> None:
    older_expiring = _pantry_item("chicken", expiry_days=1)
    newer_fresh = _pantry_item("rice", expiry_days=60)
    recipes = [_recipe_row("r1", "Chicken soup", ["chicken"])]
    ai_manager = _fake_ai_manager_success()
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)

    repo_before = _fake_repo([older_expiring, newer_fresh], recipes)
    resp_before = await dashboard_service.get_dashboard_daily(
        TEST_USER_ID, ai_manager=ai_manager, repo=repo_before, now=now
    )
    assert resp_before.suggestion is not None
    assert resp_before.suggestion.title == "Chicken soup"

    # Delete the OLDER row (chicken) — the max(updated_at) of the remaining
    # pantry is unchanged (rice was already the newest), so a revision built
    # from max(updated_at) alone would not notice this and would keep
    # serving "Chicken soup" for a pantry that no longer has chicken.
    repo_after = _fake_repo([newer_fresh], recipes)
    resp_after = await dashboard_service.get_dashboard_daily(
        TEST_USER_ID, ai_manager=ai_manager, repo=repo_after, now=now
    )

    # No expiring ingredient left to match "Chicken soup" on, and it's the
    # only saved recipe, so it still gets suggested (there's nothing else to
    # suggest) — the real assertion is that ranking re-ran at all, which we
    # can see because "expiring" is no longer the reason (chicken is gone).
    assert resp_after.suggestion is not None
    assert resp_after.suggestion.reason != "expiring"
    assert ai_manager.complete.await_count == 2  # not served from cache


# ---------------------------------------------------------------------------
# Finding 5: cache must invalidate when the saved-recipe set changes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_invalidates_when_a_recipe_is_saved() -> None:
    pantry = [_pantry_item("chicken", expiry_days=1)]
    ai_manager = _fake_ai_manager_success()
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)

    repo_before = _fake_repo(pantry, [])
    resp_before = await dashboard_service.get_dashboard_daily(
        TEST_USER_ID, ai_manager=ai_manager, repo=repo_before, now=now
    )
    assert resp_before.suggestion is None

    repo_after = _fake_repo(pantry, [_recipe_row("r1", "Chicken soup", ["chicken"])])
    resp_after = await dashboard_service.get_dashboard_daily(
        TEST_USER_ID, ai_manager=ai_manager, repo=repo_after, now=now
    )

    assert resp_after.suggestion is not None
    assert resp_after.suggestion.title == "Chicken soup"
    assert ai_manager.complete.await_count == 2  # not served from a stale cache hit


# ---------------------------------------------------------------------------
# Finding 6 (BLOCKER): the fallback path must never raise, even with a
# malformed recipe id
# ---------------------------------------------------------------------------


def _bad_ranked_recipe() -> RankedRecipe:
    return RankedRecipe(
        recipe_id="not-a-real-uuid",
        title="Broken",
        total_time_minutes=10,
        score=1.0,
        reason="pantry_match",
    )


def test_fallback_response_degrades_on_malformed_recipe_id() -> None:
    response = dashboard_service._fallback_response(_bad_ranked_recipe(), datetime.now(UTC))
    assert response.source == "fallback"
    assert response.suggestion is None  # degraded, not raised


@pytest.mark.asyncio
async def test_ai_response_degrades_on_malformed_recipe_id() -> None:
    ai_manager = _fake_ai_manager_success()
    response = await dashboard_service._ai_response(
        ai_manager, _bad_ranked_recipe(), [], [], datetime.now(UTC)
    )
    assert response.source == "ai"
    assert response.suggestion is None


@pytest.mark.asyncio
async def test_end_to_end_never_raises_even_with_malformed_recipe_id_and_no_ai(
    monkeypatch,
) -> None:
    """Belt-and-braces: drive the malformed-id case through the full service
    entrypoint with AI unavailable — the exact path the review found raising."""
    bad_recipe_row = {
        "id": "not-a-real-uuid",
        "title": "Broken",
        "ingredients": [],
        "meal_type": None,
        "total_time_minutes": 10,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    repo = _fake_repo([], [bad_recipe_row])
    ai_manager = _fake_ai_manager_unavailable()

    # rank_recipes skips rows whose id can't be used to build a CookProposal
    # UUID internally via cook_matcher — but to exercise the fallback's own
    # UUID handling directly, patch rank_recipes to return a bad id anyway.
    monkeypatch.setattr(
        dashboard_service,
        "rank_recipes",
        lambda *a, **k: _bad_ranked_recipe(),
    )

    response = await dashboard_service.get_dashboard_daily(
        TEST_USER_ID, ai_manager=ai_manager, repo=repo, now=datetime.now(UTC)
    )

    assert response.source == "fallback"
    assert response.suggestion is None


# ---------------------------------------------------------------------------
# Smaller finding: a genuine bug in AI generation should log with a
# traceback (logger.exception), not silently as a warning; the ordinary "no
# provider configured" case should stay a plain warning.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unexpected_ai_failure_logs_with_traceback(caplog) -> None:
    pantry = [_pantry_item("chicken", expiry_days=1)]
    recipes = [_recipe_row("r1", "Chicken soup", ["chicken"])]
    ai_manager = MagicMock()
    ai_manager.complete = AsyncMock(side_effect=RuntimeError("boom"))
    repo = _fake_repo(pantry, recipes)

    with caplog.at_level("ERROR", logger="bubbly_chef.services.dashboard_service"):
        response = await dashboard_service.get_dashboard_daily(
            TEST_USER_ID, ai_manager=ai_manager, repo=repo, now=datetime.now(UTC)
        )

    assert response.source == "fallback"
    exception_records = [r for r in caplog.records if r.exc_info is not None]
    assert exception_records, "expected logger.exception to record a traceback"


@pytest.mark.asyncio
async def test_no_provider_available_does_not_log_a_traceback(caplog) -> None:
    pantry = [_pantry_item("chicken", expiry_days=1)]
    recipes = [_recipe_row("r1", "Chicken soup", ["chicken"])]
    repo = _fake_repo(pantry, recipes)

    with caplog.at_level("INFO", logger="bubbly_chef.services.dashboard_service"):
        response = await dashboard_service.get_dashboard_daily(
            TEST_USER_ID,
            ai_manager=_fake_ai_manager_unavailable(),
            repo=repo,
            now=datetime.now(UTC),
        )

    assert response.source == "fallback"
    exception_records = [r for r in caplog.records if r.exc_info is not None]
    assert not exception_records
