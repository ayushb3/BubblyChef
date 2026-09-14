"""Round-trip serialization tests for typed SessionContext + PendingProposalMemory.

Verifies acceptance criterion from issue #414: a ConversationSession with a
populated SessionContext and pending_proposal must survive

    model_dump(mode="json") -> model_validate(...)

with all typed fields intact — not silently coerced to plain dicts.
"""

from __future__ import annotations

import pytest

from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.models.session import (
    ConversationSession,
    CookingRecipeSnapshot,
    PendingProposalMemory,
    SessionContext,
    SessionMode,
)


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
