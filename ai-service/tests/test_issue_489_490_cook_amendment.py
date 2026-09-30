"""Issues #489 + #490 -- a confirmed mid-cook amendment reaches the deduction.

Backend slice. The chat page's "Update what I'm cooking" card applies an
amended ingredient list; these tests pin the four seams that make it stick:

1. `POST /v1/recipes/cook` accepts an `ingredients` override and matches
   THAT list against the pantry (the same per-dish override `POST /v1/meals/cook`
   already takes, #654) instead of re-reading the stored recipe row. The stored
   row is checked for ownership and never written.
2. `POST /v1/workflows/apply` accepts `intent="recipe_amendment"`: it writes the
   amended list into the conversation's pinned `cooking_recipe` snapshot (so a
   SECOND amendment is detected against it) and records the turn as applied
   (#444's `proposal_review`), and never touches the recipes table.
3. The streaming chat path detects an amendment for a turn pinned by the
   session snapshot (the chat page sends its cook context only once), not only
   for a full request-context pin.
4. The amendment turn is stamped with its `request_id` and saved before its
   envelope reaches the client, so the apply can find it.

Fakes only (AsyncMock repos / patched router), same style as
test_cook_routes.py and test_issue_654_meal_amendments.py.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.base import Intent
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.models.proposals import RecipeAmendmentDetection, RecipeIngredientAmendment
from bubbly_chef.models.session import (
    ConversationSession,
    CookingRecipeSnapshot,
    SessionContext,
    SessionMode,
)
from bubbly_chef.workflows import router as router_mod

USER = "user-489"
RECIPE_ID = str(uuid.uuid4())
CONV = "550e8400-e29b-41d4-a716-4466554400bb"
TURN_RID = "a1000000-0000-4000-8000-0000000004a9"
REQ_ID = "b2000000-0000-4000-8000-0000000004a9"


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _pantry(name: str, qty: float = 500.0, unit: str = "g") -> PantryItem:
    return PantryItem(
        id=uuid.uuid4(),
        name=name,
        category=FoodCategory.OTHER,
        storage_location=StorageLocation.PANTRY,
        quantity=qty,
        unit=unit,
        quantity_base=qty,
        unit_base=unit,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


ROUX_AMENDMENT: list[dict[str, Any]] = [
    {"name": "pasta", "quantity": 200, "unit": "g", "optional": False, "notes": None},
    {"name": "butter", "quantity": 30, "unit": "g", "optional": False, "notes": None},
    {"name": "flour", "quantity": 30, "unit": "g", "optional": False, "notes": None},
]


def _amendment_proposal(ingredients: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "proposal_type": "recipe_amendment",
        "is_amendment": True,
        "amended_ingredients": ingredients if ingredients is not None else ROUX_AMENDMENT,
        "change_summary": "Swapped the cream for a butter and flour roux.",
        "recipe_id": RECIPE_ID,
        "recipe_title": "Creamy Tomato Garlic Pasta",
    }


def _session(
    *, recipe_id: str | None = RECIPE_ID, mode: SessionMode = SessionMode.COOKING
) -> ConversationSession:
    snapshot = (
        CookingRecipeSnapshot(
            id=recipe_id,
            title="Creamy Tomato Garlic Pasta",
            ingredients=["200 g pasta", "150 ml cream", "2 cloves garlic"],
        )
        if recipe_id is not None
        else None
    )
    return ConversationSession(
        conversation_id=CONV,
        active_mode=mode,
        pinned_recipe_id=recipe_id,
        metadata=SessionContext(cooking_recipe=snapshot),
    )


@pytest.fixture
def app() -> Any:
    _app = create_app()

    async def _uid() -> str:
        return USER

    _app.dependency_overrides[get_current_user_id] = _uid
    return _app


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ===========================================================================
# 1. POST /v1/recipes/cook -- the deduction runs against the amended list
# ===========================================================================

_STORED_RECIPE: dict[str, Any] = {
    "id": RECIPE_ID,
    "title": "Creamy Tomato Garlic Pasta",
    "ingredients": [
        {"name": "pasta", "quantity": 200, "unit": "g"},
        {"name": "cream", "quantity": 150, "unit": "g"},
    ],
}


def _cook_repo(recipe: dict[str, Any] | None = _STORED_RECIPE) -> AsyncMock:
    repo = AsyncMock()
    repo.get_recipe.return_value = recipe
    repo.get_all_pantry_items.return_value = [
        _pantry("pasta"),
        _pantry("butter"),
        _pantry("flour"),
    ]
    return repo


def _patch_cook_repo(repo: Any) -> Any:
    return patch("bubbly_chef.api.routes.recipes_ai.get_repository", return_value=repo)


class TestCookUsesTheAmendedList:
    @pytest.mark.asyncio
    async def test_override_matches_amended_lines_and_not_the_removed_one(
        self, client: AsyncClient
    ) -> None:
        with _patch_cook_repo(_cook_repo()):
            resp = await client.post(
                "/v1/recipes/cook",
                json={"recipe_id": RECIPE_ID, "ingredients": ROUX_AMENDMENT},
            )
        assert resp.status_code == 200
        data = resp.json()
        matched = {m["ingredient_name"].lower() for m in data["matches"]}
        assert {"pasta", "butter", "flour"} <= matched
        assert not any("cream" in n for n in matched)
        assert data["missing"] == []  # no phantom "Not in pantry" row for the cream

    @pytest.mark.asyncio
    async def test_without_an_override_the_stored_row_is_still_used(
        self, client: AsyncClient
    ) -> None:
        with _patch_cook_repo(_cook_repo()):
            resp = await client.post("/v1/recipes/cook", json={"recipe_id": RECIPE_ID})
        assert resp.status_code == 200
        data = resp.json()
        names = {m["ingredient_name"].lower() for m in data["matches"]}
        assert "pasta" in names
        assert any("cream" in str(x).lower() for x in data["missing"])

    @pytest.mark.asyncio
    async def test_override_never_writes_the_saved_recipe(self, client: AsyncClient) -> None:
        repo = _cook_repo()
        with _patch_cook_repo(repo):
            resp = await client.post(
                "/v1/recipes/cook",
                json={"recipe_id": RECIPE_ID, "ingredients": ROUX_AMENDMENT},
            )
        assert resp.status_code == 200
        called = {c[0] for c in repo.method_calls}
        assert called <= {"get_recipe", "get_all_pantry_items"}, called

    @pytest.mark.asyncio
    async def test_override_for_a_recipe_that_is_not_yours_is_404(
        self, client: AsyncClient
    ) -> None:
        with _patch_cook_repo(_cook_repo(recipe=None)):
            resp = await client.post(
                "/v1/recipes/cook",
                json={"recipe_id": RECIPE_ID, "ingredients": ROUX_AMENDMENT},
            )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_blank_named_lines_are_dropped_and_strings_are_parsed(
        self, client: AsyncClient
    ) -> None:
        with _patch_cook_repo(_cook_repo()):
            resp = await client.post(
                "/v1/recipes/cook",
                json={
                    "recipe_id": RECIPE_ID,
                    "ingredients": [
                        {"name": "   ", "quantity": 1, "unit": "g"},
                        "30 g butter",
                    ],
                },
            )
        assert resp.status_code == 200
        names = {m["ingredient_name"].lower() for m in resp.json()["matches"]}
        assert names == {"butter"}

    @pytest.mark.asyncio
    async def test_empty_override_is_rejected_not_read_as_nothing_to_cook(
        self, client: AsyncClient
    ) -> None:
        with _patch_cook_repo(_cook_repo()):
            resp = await client.post(
                "/v1/recipes/cook", json={"recipe_id": RECIPE_ID, "ingredients": []}
            )
        assert resp.status_code == 422


def test_resolve_supplied_ingredients_is_shared_with_the_meal_path() -> None:
    from bubbly_chef.models.cook import MealCookIngredient
    from bubbly_chef.services.meal_cook import resolve_supplied_ingredients

    resolved = resolve_supplied_ingredients(
        [MealCookIngredient(name=" butter ", quantity=30, unit="g"), "  ", "2 eggs"],
        string_scale=1.0,
    )
    assert resolved[0] == {"name": "butter", "quantity": 30, "unit": "g"}
    assert len(resolved) == 2
    assert resolved[1]["name"] == "eggs"


# ===========================================================================
# 2. POST /v1/workflows/apply (recipe_amendment) -- the snapshot is updated
# ===========================================================================


def _apply_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "request_id": REQ_ID,
        "intent": "recipe_amendment",
        "conversation_id": CONV,
        "turn_request_ids": [REQ_ID],
        "proposal": _amendment_proposal(),
    }
    body.update(overrides)
    return body


def _apply_repo(session: ConversationSession | None = None) -> AsyncMock:
    repo = AsyncMock()
    repo.get_session.return_value = session if session is not None else _session()
    repo.update_session.side_effect = lambda _uid, s: s
    repo.get_turns_by_request_ids.return_value = [
        {
            "id": "row-1",
            "proposal": _amendment_proposal(),
            "metadata": {"request_id": REQ_ID},
        }
    ]
    repo.set_turn_metadata.return_value = True
    return repo


def _patch_apply_repo(repo: Any) -> Any:
    return patch(
        "bubbly_chef.api.routes.workflows.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    )


class TestApplyAmendment:
    @pytest.mark.asyncio
    async def test_applying_writes_the_amended_list_into_the_pinned_snapshot(
        self, client: AsyncClient
    ) -> None:
        repo = _apply_repo()
        with _patch_apply_repo(repo):
            resp = await client.post("/v1/workflows/apply", json=_apply_body())
        assert resp.status_code == 200
        assert resp.json()["success"] is True

        repo.update_session.assert_awaited_once()
        saved: ConversationSession = repo.update_session.await_args.args[1]
        snap = saved.metadata.cooking_recipe
        assert snap is not None
        assert snap.id == RECIPE_ID
        joined = " | ".join(snap.ingredients).lower()
        assert "butter" in joined and "flour" in joined
        assert "cream" not in joined
        assert saved.active_mode == SessionMode.COOKING

    @pytest.mark.asyncio
    async def test_applying_records_the_turn_as_applied(self, client: AsyncClient) -> None:
        repo = _apply_repo()
        with _patch_apply_repo(repo):
            resp = await client.post("/v1/workflows/apply", json=_apply_body())
        assert resp.status_code == 200
        assert resp.json()["recorded_turn_request_ids"] == [REQ_ID]
        repo.set_turn_metadata.assert_awaited_once()
        written = repo.set_turn_metadata.await_args.args[2]
        assert written["proposal_review"]["status"] == "applied"
        assert written["request_id"] == REQ_ID

    @pytest.mark.asyncio
    async def test_a_saved_library_recipe_is_never_written(self, client: AsyncClient) -> None:
        repo = _apply_repo()
        with _patch_apply_repo(repo):
            await client.post("/v1/workflows/apply", json=_apply_body())
        called = {c[0] for c in repo.method_calls}
        assert called <= {
            "get_session",
            "update_session",
            "get_turns_by_request_ids",
            "set_turn_metadata",
        }, called

    @pytest.mark.asyncio
    async def test_a_second_amendment_is_detected_against_the_first_amended_list(
        self, client: AsyncClient
    ) -> None:
        from bubbly_chef.workflows.chat.nodes import _detect_amendment

        repo = _apply_repo()
        with _patch_apply_repo(repo):
            await client.post("/v1/workflows/apply", json=_apply_body())
        saved: ConversationSession = repo.update_session.await_args.args[1]

        ai = MagicMock()
        ai.complete = AsyncMock(return_value=None)
        state: Any = {
            "input_text": "also swap the parsley for basil",
            "context": None,
            "session": saved.model_dump(mode="json"),
        }
        await _detect_amendment(state, ai, "Sure, basil works.")
        prompt: str = ai.complete.await_args.kwargs["prompt"].lower()
        assert "butter" in prompt and "flour" in prompt  # the roux survived
        assert "cream" not in prompt

    @pytest.mark.asyncio
    async def test_a_conversation_not_cooking_that_recipe_is_409(
        self, client: AsyncClient
    ) -> None:
        repo = _apply_repo(_session(recipe_id=str(uuid.uuid4())))
        with _patch_apply_repo(repo):
            resp = await client.post("/v1/workflows/apply", json=_apply_body())
        assert resp.status_code == 409
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_conversation_with_no_cook_pin_is_409(self, client: AsyncClient) -> None:
        repo = _apply_repo(_session(recipe_id=None, mode=SessionMode.DEFAULT))
        with _patch_apply_repo(repo):
            resp = await client.post("/v1/workflows/apply", json=_apply_body())
        assert resp.status_code == 409
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_409_creates_no_session_row(self, client: AsyncClient) -> None:
        """Validation reads the session; a rejected apply never creates one."""
        repo = _apply_repo()
        repo.get_session.return_value = None  # no session exists for this conversation
        with _patch_apply_repo(repo):
            resp = await client.post("/v1/workflows/apply", json=_apply_body())
        assert resp.status_code == 409
        repo.get_or_create_session.assert_not_awaited()
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_proposal_that_is_not_an_amendment_is_422(self, client: AsyncClient) -> None:
        repo = _apply_repo()
        with _patch_apply_repo(repo):
            resp = await client.post(
                "/v1/workflows/apply", json=_apply_body(proposal={"actions": []})
            )
        assert resp.status_code == 422
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_amendment_with_no_usable_lines_is_422(self, client: AsyncClient) -> None:
        repo = _apply_repo()
        blank = _amendment_proposal([{"name": "  ", "quantity": 1, "unit": "g"}])
        with _patch_apply_repo(repo):
            resp = await client.post("/v1/workflows/apply", json=_apply_body(proposal=blank))
        assert resp.status_code == 422
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_apply_needs_a_conversation_id(self, client: AsyncClient) -> None:
        body = _apply_body()
        del body["conversation_id"]
        body["turn_request_ids"] = []
        with _patch_apply_repo(_apply_repo()):
            resp = await client.post("/v1/workflows/apply", json=body)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_a_failed_turn_record_does_not_fail_the_apply(
        self, client: AsyncClient
    ) -> None:
        repo = _apply_repo()
        repo.set_turn_metadata.side_effect = RuntimeError("write blew up")
        with _patch_apply_repo(repo):
            resp = await client.post("/v1/workflows/apply", json=_apply_body())
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert resp.json()["recorded_turn_request_ids"] == []


# ===========================================================================
# 3. The stream path detects for a session-pinned cook
# ===========================================================================

_CLASSIFIED_BASE: dict[str, Any] = {
    "request_id": "11111111-1111-4111-8111-111111111111",
    "workflow_id": "22222222-2222-4222-8222-222222222222",
    "conversation_id": CONV,
    "user_id": USER,
    "input_text": "no cream, use a roux",
    "input_mode": "chat",
    "conversation_history": [],
    "warnings": [],
    "errors": [],
    "context": None,
}


def _detection() -> RecipeAmendmentDetection:
    return RecipeAmendmentDetection(
        is_amendment=True,
        amended_ingredients=[
            RecipeIngredientAmendment(name="butter", quantity=30, unit="g"),
            RecipeIngredientAmendment(name="flour", quantity=30, unit="g"),
        ],
        change_summary="Swapped the cream for a roux.",
    )


async def _stream(
    *,
    session_mode: str | None,
    session: ConversationSession | None,
    context: dict[str, Any] | None = None,
    intent: str = Intent.COOKING_HELP.value,
    detect: AsyncMock | None = None,
) -> tuple[list[dict[str, Any]], AsyncMock]:
    async def _tokens(**_kwargs: Any) -> AsyncIterator[str]:
        for tok in ("Sure, ", "a roux works."):
            yield tok

    manager = MagicMock()
    manager.stream_complete = _tokens
    manager.complete = AsyncMock()

    classified = {
        **_CLASSIFIED_BASE,
        "intent": intent,
        "context": context,
        "session_mode": session_mode,
        "session": session.model_dump(mode="json") if session is not None else None,
    }
    detect_mock = detect if detect is not None else AsyncMock(return_value=_detection())
    dispatch_graph = MagicMock()
    dispatch_graph.ainvoke = AsyncMock(return_value={})

    with (
        patch.object(router_mod, "get_chat_dispatch_graph", return_value=dispatch_graph),
        patch.object(router_mod, "initialize_state", side_effect=lambda s: s),
        patch.object(router_mod, "load_session", AsyncMock(side_effect=lambda s: s)),
        patch.object(router_mod, "classify_intent", AsyncMock(return_value=classified)),
        patch.object(router_mod, "get_ai_manager", return_value=manager),
        patch.object(router_mod, "get_repository", AsyncMock(side_effect=RuntimeError("no db"))),
        patch.object(router_mod, "update_session_node", AsyncMock(side_effect=lambda s: s)),
        patch.object(router_mod, "_detect_amendment", detect_mock),
    ):
        events = [
            json.loads(chunk)
            async for chunk in router_mod.run_chat_workflow_streaming(
                message="no cream, use a roux",
                conversation_id=CONV,
                user_id=USER,
                context=context,
                follow_up_chips=False,
            )
        ]
    return events, detect_mock


class TestStreamDetectsForASessionPinnedCook:
    @pytest.mark.asyncio
    async def test_cooking_session_with_a_snapshot_pin_attaches_the_proposal(self) -> None:
        events, detect = await _stream(session_mode="cooking", session=_session())
        detect.assert_awaited_once()
        env = next(e for e in events if e["type"] == "envelope")["data"]
        assert env["proposal"]["proposal_type"] == "recipe_amendment"
        assert env["proposal"]["recipe_id"] == RECIPE_ID
        assert env["requires_review"] is True

    @pytest.mark.asyncio
    async def test_a_recipe_exploring_session_does_not_pay_for_detection(self) -> None:
        """A snapshot also exists while EXPLORING a suggestion the user isn't cooking."""
        events, detect = await _stream(
            session_mode="recipe_exploring", session=_session(mode=SessionMode.RECIPE_EXPLORING)
        )
        detect.assert_not_awaited()
        env = next(e for e in events if e["type"] == "envelope")["data"]
        assert env["proposal"] is None

    @pytest.mark.asyncio
    async def test_a_cooking_session_with_no_snapshot_stays_prose_only(self) -> None:
        # `_detect_amendment` itself returns None, with no model call, for an empty
        # pin; the router only has to hand that through as a plain reply.
        events, _ = await _stream(
            session_mode="cooking",
            session=_session(recipe_id=None),
            detect=AsyncMock(return_value=None),
        )
        env = next(e for e in events if e["type"] == "envelope")["data"]
        assert env["proposal"] is None

    @pytest.mark.asyncio
    async def test_non_cooking_help_intent_is_not_detected(self) -> None:
        _, detect = await _stream(
            session_mode="cooking", session=_session(), intent=Intent.GENERAL_CHAT.value
        )
        detect.assert_not_awaited()


# ===========================================================================
# 4. The amendment turn is stamped with its request_id, saved before the envelope
# ===========================================================================


def _amend_envelope() -> dict[str, Any]:
    return {
        "intent": "cooking_help",
        "request_id": REQ_ID,
        "proposal": _amendment_proposal(),
        "requires_review": True,
        "metadata": {"follow_ups_pending": False},
    }


def test_metadata_for_save_stamps_an_amendment_turn_with_its_request_id() -> None:
    from bubbly_chef.services.proposal_review import metadata_for_save

    saved = metadata_for_save(_amend_envelope())
    assert saved == {"follow_ups_pending": False, "request_id": REQ_ID}


def test_a_plain_cooking_help_turn_is_not_stamped() -> None:
    from bubbly_chef.services.proposal_review import metadata_for_save

    env = {**_amend_envelope(), "proposal": None}
    assert metadata_for_save(env) == {"follow_ups_pending": False}


@pytest.mark.asyncio
async def test_the_amendment_turn_is_saved_before_its_envelope_is_yielded(
    client: AsyncClient,
) -> None:
    log: list[Any] = []

    async def _stream_gen(**_kw: Any) -> AsyncIterator[str]:
        yield json.dumps({"type": "token", "content": "Sure, a roux works."})
        yield json.dumps({"type": "done"})
        yield json.dumps({"type": "envelope", "data": _amend_envelope()})
        log.append(("after_envelope",))

    repo = MagicMock()

    async def _save(**kw: Any) -> None:
        log.append(("save", kw["role"], kw.get("metadata")))

    repo.save_message = AsyncMock(side_effect=_save)
    repo.get_history = AsyncMock(return_value=[])

    with (
        patch("bubbly_chef.workflows.router.run_chat_workflow_streaming", _stream_gen),
        patch(
            "bubbly_chef.api.routes.chat.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ),
    ):
        resp = await client.post(
            "/v1/chat/stream", json={"message": "no cream, use a roux", "conversation_id": CONV}
        )
    assert resp.status_code == 200
    saves = [e for e in log if e[0] == "save" and e[1] == "assistant"]
    assert len(saves) == 1
    assert saves[0][2]["request_id"] == REQ_ID
    assert log.index(saves[0]) < log.index(("after_envelope",))
