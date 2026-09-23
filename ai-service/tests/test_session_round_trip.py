"""Round-trip serialization tests for typed SessionContext + PendingProposalMemory.

Verifies acceptance criterion from issue #414: a ConversationSession with a
populated SessionContext and pending_proposal must survive

    model_dump(mode="json") -> model_validate(...)

with all typed fields intact — not silently coerced to plain dicts.

Also covers the REAL reload seam in SupabaseRepository.get_or_create_session
(the ``raw_metadata or {}`` / ``isinstance(raw_pending, dict)`` guards) so that
stale prod rows cannot cause a site-wide chat 500 on deploy.
"""

from __future__ import annotations

from typing import Any

import pytest

from bubbly_chef.models.recipe import Ingredient, RecipeCard, RecipeConstraints
from bubbly_chef.models.session import (
    ConversationSession,
    CookingRecipeSnapshot,
    PendingProposalMemory,
    SessionContext,
    SessionMode,
)
from bubbly_chef.repository.supabase_repo import SupabaseRepository


# ---------------------------------------------------------------------------
# Minimal fake Supabase client — mirrors the pattern in
# test_pantry_deduction.py and test_issue_182_estimated_expiry.py.
#
# get_or_create_session uses:
#   .table("conversation_sessions").select("*").eq(...).eq(...).execute()
# and on the new-row path:
#   .table("conversation_sessions").insert({...}).execute()
# ---------------------------------------------------------------------------


class _FakeSessionQuery:
    """Fluent query stub that returns canned rows and swallows inserts."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    # --- fluent builder methods ---

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeSessionQuery:
        return self

    def insert(self, _payload: Any) -> _FakeSessionQuery:
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> _FakeSessionQuery:
        return self

    def execute(self) -> Any:
        return type("Result", (), {"data": self._rows})()


class _FakeSessionClient:
    """Single-table fake client wired to return a fixed row list."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def table(self, _name: str) -> _FakeSessionQuery:
        return _FakeSessionQuery(self._rows)


def _repo_with_rows(rows: list[dict[str, Any]]) -> SupabaseRepository:
    """Return a SupabaseRepository backed by a fake client, no __init__ called."""
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _FakeSessionClient(rows)  # type: ignore[assignment]
    return repo


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _full_session() -> ConversationSession:
    """Build a ConversationSession with every typed sub-model populated."""
    return ConversationSession(
        conversation_id="conv-rt-1",
        active_mode=SessionMode.COOKING,
        pinned_recipe_id="recipe-42",
        pending_proposal=PendingProposalMemory(
            item_names=["eggs", "milk"],
            unclear_terms=["veggies"],
            suggestions={"veggies": ["broccoli", "spinach", "carrot"]},
        ),
        metadata=SessionContext(
            cooking_recipe=CookingRecipeSnapshot(
                id="recipe-42",
                title="Scrambled Eggs",
                ingredients=["3 eggs", "1 tbsp butter", "salt"],
            ),
            brainstorm_ideas=["Pasta Primavera", "Stir Fry", "Omelette"],
            recipe_constraints=RecipeConstraints(
                cuisine="Italian",
                max_time_minutes=30,
                dietary=["vegetarian"],
            ),
            last_recipe_title="Pasta Primavera",
        ),
    )


# ---------------------------------------------------------------------------
# Round-trip tests
# ---------------------------------------------------------------------------


def test_session_round_trip_preserves_typed_fields() -> None:
    """model_dump -> model_validate must return equivalent typed session."""
    original = _full_session()
    dumped = original.model_dump(mode="json")
    restored = ConversationSession.model_validate(dumped)

    # Top-level fields
    assert restored.conversation_id == original.conversation_id
    assert restored.active_mode == SessionMode.COOKING
    assert restored.pinned_recipe_id == "recipe-42"

    # pending_proposal is a PendingProposalMemory, not a plain dict
    assert isinstance(restored.pending_proposal, PendingProposalMemory)
    assert restored.pending_proposal is not None
    pp = restored.pending_proposal
    assert pp.item_names == ["eggs", "milk"]
    assert pp.unclear_terms == ["veggies"]
    assert pp.suggestions == {"veggies": ["broccoli", "spinach", "carrot"]}

    # metadata is a SessionContext, not a plain dict
    assert isinstance(restored.metadata, SessionContext)
    ctx = restored.metadata

    # cooking_recipe is a CookingRecipeSnapshot, not a dict
    assert isinstance(ctx.cooking_recipe, CookingRecipeSnapshot)
    assert ctx.cooking_recipe is not None
    assert ctx.cooking_recipe.id == "recipe-42"
    assert ctx.cooking_recipe.title == "Scrambled Eggs"
    assert ctx.cooking_recipe.ingredients == ["3 eggs", "1 tbsp butter", "salt"]

    # brainstorm_ideas preserved as list[str]
    assert ctx.brainstorm_ideas == ["Pasta Primavera", "Stir Fry", "Omelette"]

    # recipe_constraints is a RecipeConstraints, not a dict
    assert isinstance(ctx.recipe_constraints, RecipeConstraints)
    assert ctx.recipe_constraints is not None
    assert ctx.recipe_constraints.cuisine == "Italian"
    assert ctx.recipe_constraints.max_time_minutes == 30
    assert ctx.recipe_constraints.dietary == ["vegetarian"]

    # last_recipe_title preserved
    assert ctx.last_recipe_title == "Pasta Primavera"


def test_empty_session_round_trips_to_defaults() -> None:
    """A bare ConversationSession must survive round-trip with correct defaults."""
    original = ConversationSession(conversation_id="conv-rt-empty")
    dumped = original.model_dump(mode="json")
    restored = ConversationSession.model_validate(dumped)

    assert restored.active_mode == SessionMode.DEFAULT
    assert restored.pending_proposal is None
    assert isinstance(restored.metadata, SessionContext)
    assert restored.metadata.cooking_recipe is None
    assert restored.metadata.brainstorm_ideas == []
    assert restored.metadata.recipe_constraints is None
    assert restored.metadata.last_recipe_title is None


def test_metadata_json_key_is_metadata() -> None:
    """The DB column name 'metadata' must be the serialized key (no alias drift)."""
    session = ConversationSession(
        conversation_id="conv-rt-key",
        metadata=SessionContext(last_recipe_title="My Dish"),
    )
    dumped = session.model_dump(mode="json")
    # DB column and WorkflowState both use "metadata"
    assert "metadata" in dumped
    assert dumped["metadata"]["last_recipe_title"] == "My Dish"
    assert "context" not in dumped


def test_pending_proposal_none_round_trips() -> None:
    """None pending_proposal serializes to None, not an empty dict."""
    session = ConversationSession(conversation_id="conv-rt-none-pp")
    dumped = session.model_dump(mode="json")
    assert dumped["pending_proposal"] is None
    restored = ConversationSession.model_validate(dumped)
    assert restored.pending_proposal is None


def test_stale_db_row_with_unknown_metadata_key_validates_to_default() -> None:
    """A row from a DB that has an unrecognised metadata key must not raise.

    SessionContext is a strict Pydantic model by default — unknown keys are
    ignored, and missing fields default.  This ensures old DB rows can be
    read after a field is renamed/removed without crashing.
    """
    raw_row: dict = {
        "conversation_id": "conv-rt-stale",
        "active_mode": "default",
        "pending_proposal": None,
        "metadata": {
            "unknown_field": "some_value",
            "last_recipe_title": "Old Dish",
        },
    }
    # Should not raise
    session = ConversationSession.model_validate(raw_row)
    assert session.metadata.last_recipe_title == "Old Dish"
    assert session.metadata.cooking_recipe is None


# ---------------------------------------------------------------------------
# Reload-seam tests (#414 regression): stale/legacy DB rows routed through
# the ACTUAL SupabaseRepository.get_or_create_session deserialization path
# (the ``raw_metadata or {}`` / ``isinstance(raw_pending, dict)`` guards).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGetOrCreateSessionLegacyRows:
    """Stale production rows must survive the real repo reload path without crash."""

    async def test_unknown_metadata_key_dropped_valid_key_preserved(self) -> None:
        """metadata with an unknown/removed key alongside a valid one.

        Unknown key must be dropped (extra='ignore'), valid typed field must
        survive — reproduces the scenario where a field is renamed in code
        but old rows in the DB still carry the old key.
        """
        repo = _repo_with_rows(
            [
                {
                    "conversation_id": "conv-legacy-1",
                    "active_mode": "default",
                    "pending_proposal": None,
                    "metadata": {
                        "legacy_key": "some_stale_value",
                        "last_recipe_title": "Old Dish",
                    },
                }
            ]
        )

        session = await repo.get_or_create_session("u1", "conv-legacy-1")

        assert isinstance(session.metadata, SessionContext)
        assert session.metadata.last_recipe_title == "Old Dish"
        # Unknown key must be silently dropped, not raise and not appear
        assert not hasattr(session.metadata, "legacy_key")
        assert session.metadata.cooking_recipe is None
        assert session.metadata.brainstorm_ideas == []
        assert session.pending_proposal is None

    async def test_null_metadata_column_loads_to_all_defaults(self) -> None:
        """metadata is NULL in the DB row → all SessionContext fields default."""
        for null_value in (None, {}):
            repo = _repo_with_rows(
                [
                    {
                        "conversation_id": "conv-legacy-2",
                        "active_mode": "default",
                        "pending_proposal": None,
                        "metadata": null_value,
                    }
                ]
            )

            session = await repo.get_or_create_session("u1", "conv-legacy-2")

            assert isinstance(session.metadata, SessionContext)
            assert session.metadata.cooking_recipe is None
            assert session.metadata.brainstorm_ideas == []
            assert session.metadata.recipe_constraints is None
            assert session.metadata.last_recipe_title is None

    async def test_missing_metadata_key_entirely_loads_to_defaults(self) -> None:
        """metadata key absent from row dict entirely → defaults (row.get returns None)."""
        repo = _repo_with_rows(
            [
                {
                    "conversation_id": "conv-legacy-3",
                    "active_mode": "default",
                    "pending_proposal": None,
                    # "metadata" key intentionally absent
                }
            ]
        )

        session = await repo.get_or_create_session("u1", "conv-legacy-3")

        assert isinstance(session.metadata, SessionContext)
        assert session.metadata.last_recipe_title is None

    async def test_stale_pending_proposal_dict_with_unknown_key_coerces(self) -> None:
        """pending_proposal dict with an unknown key → loads without crashing.

        PendingProposalMemory uses extra='ignore' so stale keys are dropped.
        Known fields must be preserved.
        """
        repo = _repo_with_rows(
            [
                {
                    "conversation_id": "conv-legacy-4",
                    "active_mode": "default",
                    "pending_proposal": {
                        "item_names": ["eggs"],
                        "unclear_terms": [],
                        "suggestions": {},
                        "removed_in_v2": "stale_value",
                    },
                    "metadata": {},
                }
            ]
        )

        session = await repo.get_or_create_session("u1", "conv-legacy-4")

        assert isinstance(session.pending_proposal, PendingProposalMemory)
        assert session.pending_proposal.item_names == ["eggs"]
        assert session.pending_proposal.unclear_terms == []
        assert not hasattr(session.pending_proposal, "removed_in_v2")

    async def test_non_dict_pending_proposal_becomes_none(self) -> None:
        """pending_proposal that is a non-dict (string, int, list) → becomes None.

        The isinstance(raw_pending, dict) guard must absorb any non-dict value
        from a corrupt or legacy row without crashing.
        """
        for bad_value in ("stale_string", 42, ["list", "value"]):
            repo = _repo_with_rows(
                [
                    {
                        "conversation_id": "conv-legacy-5",
                        "active_mode": "default",
                        "pending_proposal": bad_value,
                        "metadata": {},
                    }
                ]
            )

            session = await repo.get_or_create_session("u1", "conv-legacy-5")

            assert session.pending_proposal is None, (
                f"expected None for pending_proposal={bad_value!r}, "
                f"got {session.pending_proposal!r}"
            )

    async def test_null_pending_proposal_becomes_none(self) -> None:
        """NULL pending_proposal in DB row → session.pending_proposal is None."""
        repo = _repo_with_rows(
            [
                {
                    "conversation_id": "conv-legacy-6",
                    "active_mode": "default",
                    "pending_proposal": None,
                    "metadata": {},
                }
            ]
        )

        session = await repo.get_or_create_session("u1", "conv-legacy-6")

        assert session.pending_proposal is None

    async def test_metadata_with_extra_field_in_cooking_recipe_sub_dict(self) -> None:
        """A nested cooking_recipe or recipe_constraints sub-dict with an extra
        field must be dropped by extra='ignore', not crash.

        Exercises the nested model deserialization inside SessionContext.model_validate.
        """
        repo = _repo_with_rows(
            [
                {
                    "conversation_id": "conv-legacy-7",
                    "active_mode": "cooking",
                    "pending_proposal": None,
                    "metadata": {
                        "cooking_recipe": {
                            "id": "r-1",
                            "title": "Pasta",
                            "ingredients": ["pasta", "tomato"],
                            "removed_nested_field": "stale",
                        },
                        "recipe_constraints": {
                            "cuisine": "Italian",
                            "max_time_minutes": 20,
                            "dietary": [],
                            "old_constraint_key": "dropped",
                        },
                    },
                }
            ]
        )

        session = await repo.get_or_create_session("u1", "conv-legacy-7")

        assert isinstance(session.metadata, SessionContext)
        assert isinstance(session.metadata.cooking_recipe, CookingRecipeSnapshot)
        assert session.metadata.cooking_recipe.title == "Pasta"
        assert session.metadata.cooking_recipe.ingredients == ["pasta", "tomato"]
        assert isinstance(session.metadata.recipe_constraints, RecipeConstraints)
        assert session.metadata.recipe_constraints.cuisine == "Italian"
        assert session.metadata.recipe_constraints.max_time_minutes == 20


# ---------------------------------------------------------------------------
# #415 pin round-trip: the RECIPE_CARD ephemeral id + snapshot survive seam #2
# (model_dump -> model_validate, the same seam as the existing round-trip suite)
# ---------------------------------------------------------------------------


def test_recipe_exploring_pin_round_trips() -> None:
    """A session pinned to a RECIPE_EXPLORING recipe card survives model_dump -> model_validate.

    This is seam #2 from issue #415 AC: the ephemeral RecipeCard id and the
    typed CookingRecipeSnapshot both survive the serialization round-trip.

    The id here is a session-local uuid (not a DB row id) — per the #415
    design decision — but it must round-trip faithfully within the session.
    """
    from uuid import uuid4

    ephemeral_id = str(uuid4())
    session = ConversationSession(
        conversation_id="conv-rt-recipe-pick",
        active_mode=SessionMode.RECIPE_EXPLORING,
        pinned_recipe_id=ephemeral_id,
        metadata=SessionContext(
            cooking_recipe=CookingRecipeSnapshot(
                id=ephemeral_id,
                title="Spaghetti Aglio e Olio",
                ingredients=["200 g spaghetti", "4 garlic", "olive oil"],
            ),
            last_recipe_title="Spaghetti Aglio e Olio",
        ),
    )

    dumped = session.model_dump(mode="json")
    restored = ConversationSession.model_validate(dumped)

    # Top-level pin survives
    assert restored.pinned_recipe_id == ephemeral_id
    assert restored.active_mode == SessionMode.RECIPE_EXPLORING

    # Typed snapshot survives (not coerced to a plain dict)
    snap = restored.metadata.cooking_recipe
    assert snap is not None
    assert isinstance(snap, CookingRecipeSnapshot)
    assert snap.id == ephemeral_id
    assert snap.title == "Spaghetti Aglio e Olio"
    assert snap.ingredients == ["200 g spaghetti", "4 garlic", "olive oil"]

    # last_recipe_title survives
    assert restored.metadata.last_recipe_title == "Spaghetti Aglio e Olio"


# ---------------------------------------------------------------------------
# #416 AC1: picked_recipe (full RecipeCard) survives the ACTUAL persistence
# seam -- model_dump(mode="json") -> json.dumps -> json.loads ->
# model_validate. picked_recipe carries a uuid4 id plus nested Ingredient
# models; either failing to round-trip would break refine-in-place on the
# SECOND turn in production (after a reload from the metadata JSON column)
# even though every in-memory node test still passes.
# ---------------------------------------------------------------------------


def test_picked_recipe_survives_json_round_trip_through_the_db_seam() -> None:
    """picked_recipe must survive the real persistence path: model_dump(mode="json")
    -> json.dumps -> json.loads -> model_validate -- not just an in-memory
    model_dump -> model_validate round-trip."""
    import json

    picked = RecipeCard(
        title="Creamy Garlic Spaghetti",
        description="A rich garlic pasta.",
        ingredients=[
            Ingredient(name="spaghetti", quantity=200, unit="g"),
            Ingredient(name="garlic", quantity=3, unit="cloves", preparation="minced"),
        ],
        instructions=["Boil pasta.", "Saute garlic.", "Toss together."],
        servings=2,
        cuisine="Italian",
    )
    session = ConversationSession(
        conversation_id="conv-rt-picked-recipe",
        active_mode=SessionMode.RECIPE_EXPLORING,
        pinned_recipe_id=str(picked.id),
        metadata=SessionContext(picked_recipe=picked),
    )

    # The actual persistence seam: JSON column round-trip, not just Python
    # dict round-trip -- model_dump(mode="json") produces JSON-safe values
    # (str id, str datetimes), but json.dumps/json.loads is the step that
    # would surface anything model_dump silently left non-JSON-serializable.
    dumped = session.model_dump(mode="json")
    as_json_text = json.dumps(dumped)
    reloaded = json.loads(as_json_text)
    restored = ConversationSession.model_validate(reloaded)

    assert isinstance(restored.metadata.picked_recipe, RecipeCard)
    rp = restored.metadata.picked_recipe
    assert rp is not None
    assert rp.id == picked.id
    assert rp.title == "Creamy Garlic Spaghetti"
    assert rp.description == "A rich garlic pasta."
    assert rp.servings == 2
    assert rp.cuisine == "Italian"

    # Nested Ingredient models survive as typed models, not plain dicts,
    # with quantities and units intact.
    assert len(rp.ingredients) == 2
    assert isinstance(rp.ingredients[0], Ingredient)
    assert rp.ingredients[0].name == "spaghetti"
    assert rp.ingredients[0].quantity == 200
    assert rp.ingredients[0].unit == "g"
    assert rp.ingredients[1].preparation == "minced"

    assert rp.instructions == ["Boil pasta.", "Saute garlic.", "Toss together."]


def test_picked_recipe_none_round_trips_through_the_db_seam() -> None:
    """No pinned recipe yet -- picked_recipe stays None through the same
    JSON-column seam, not coerced to an empty dict or missing key error."""
    import json

    session = ConversationSession(
        conversation_id="conv-rt-no-pick",
        metadata=SessionContext(),
    )
    dumped = session.model_dump(mode="json")
    restored = ConversationSession.model_validate(json.loads(json.dumps(dumped)))
    assert restored.metadata.picked_recipe is None


# ---------------------------------------------------------------------------
# save_message / get_history proposal round-trip (#floating-prancing-rain fix)
# Verifies that proposal + metadata written by save_message are returned
# verbatim by get_history (the select("*") path).
# ---------------------------------------------------------------------------


class _FakeHistoryQuery:
    """Fluent query stub that records inserts and returns rows from a shared store."""

    def __init__(self, store: list[dict[str, Any]], client: "_FakeHistoryClient") -> None:
        self._store = store
        self._client = client
        self.inserted: dict[str, Any] | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeHistoryQuery":
        return self

    def insert(self, payload: dict[str, Any]) -> "_FakeHistoryQuery":
        self.inserted = payload
        self._store.append(payload)
        self._client.last_inserted = payload
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> "_FakeHistoryQuery":
        return self

    def order(self, *_args: Any, **_kwargs: Any) -> "_FakeHistoryQuery":
        return self

    def limit(self, *_args: Any, **_kwargs: Any) -> "_FakeHistoryQuery":
        return self

    def execute(self) -> Any:
        return type("Result", (), {"data": list(self._store)})()


class _FakeHistoryClient:
    def __init__(self) -> None:
        self._store: list[dict[str, Any]] = []
        self.last_inserted: dict[str, Any] | None = None

    def table(self, _name: str) -> _FakeHistoryQuery:
        return _FakeHistoryQuery(self._store, self)


def _history_repo() -> tuple[SupabaseRepository, _FakeHistoryClient]:
    """Return a SupabaseRepository + the client so tests can inspect inserts."""
    client = _FakeHistoryClient()
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = client  # type: ignore[assignment]
    return repo, client


@pytest.mark.asyncio
class TestSaveMessageProposalRoundTrip:
    """save_message persists proposal + metadata; get_history returns them."""

    async def test_recipe_card_proposal_round_trips(self) -> None:
        """An assistant message saved with a recipe_card proposal dict must be
        returned intact by get_history (both proposal and metadata fields)."""
        recipe_card_proposal = {
            "proposal_type": "recipe_card",
            "recipe": {
                "title": "Tomato Pasta",
                "ingredients": [{"name": "pasta", "quantity": 200.0, "unit": "g"}],
                "instructions": ["Boil pasta", "Add sauce"],
            },
            "pantry_match_score": 0.85,
        }
        meta = {"intent": "recipe_card", "workflow_id": "wf-abc123"}

        repo, client = _history_repo()

        await repo.save_message(
            user_id="u-test",
            conversation_id="conv-test",
            role="assistant",
            content="Here is a pasta recipe for you.",
            intent="recipe_card",
            proposal=recipe_card_proposal,
            metadata=meta,
        )

        # The insert payload must carry proposal + metadata
        assert client.last_inserted is not None
        inserted = client.last_inserted
        assert inserted["proposal"] == recipe_card_proposal
        assert inserted["metadata"] == meta
        assert inserted["role"] == "assistant"
        assert inserted["intent"] == "recipe_card"

        # get_history returns the same row (fake client returns what was inserted)
        history = await repo.get_history(
            user_id="u-test", conversation_id="conv-test"
        )
        assert len(history) == 1
        row = history[0]
        assert row["proposal"] == recipe_card_proposal
        assert row["metadata"] == meta
        assert row["role"] == "assistant"

    async def test_user_message_saves_without_proposal(self) -> None:
        """A user-turn save (no proposal/metadata args) must still work and
        leave proposal + metadata as None in the inserted row."""
        repo, client = _history_repo()

        await repo.save_message(
            user_id="u-test",
            conversation_id="conv-test",
            role="user",
            content="Make me a pasta recipe",
        )

        assert client.last_inserted is not None
        inserted = client.last_inserted
        assert inserted["proposal"] is None
        assert inserted["metadata"] is None
        assert inserted["role"] == "user"

    async def test_assistant_message_none_proposal_saves_cleanly(self) -> None:
        """Explicit None for proposal/metadata (plain-chat assistant turn) inserts None."""
        repo, client = _history_repo()

        await repo.save_message(
            user_id="u-test",
            conversation_id="conv-test",
            role="assistant",
            content="Sure, here are some tips.",
            intent="general_chat",
            proposal=None,
            metadata=None,
        )

        assert client.last_inserted is not None
        inserted = client.last_inserted
        assert inserted["proposal"] is None
        assert inserted["metadata"] is None
