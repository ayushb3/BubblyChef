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

from bubbly_chef.models.recipe import RecipeConstraints
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
