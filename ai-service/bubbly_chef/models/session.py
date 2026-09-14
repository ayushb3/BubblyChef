"""Conversation session model for stateful routing."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from bubbly_chef.models.recipe import RecipeConstraints


class SessionMode(StrEnum):
    """Active conversation modes."""

    DEFAULT = "default"
    COOKING = "cooking"
    RECIPE_EXPLORING = "recipe_exploring"
    INGESTING = "ingesting"
    PANTRY_EDITING = "pantry_editing"


class CookingRecipeSnapshot(BaseModel):
    """Minimal recipe data pinned when the user starts cooking.

    Produced by ``normalize_cooking_recipe()`` and stored in
    ``SessionContext.cooking_recipe``.  Only the fields prompts and sessions
    actually need -- not the full RecipeCard.
    """

    id: str | None = None
    title: str = ""
    ingredients: list[str] = Field(default_factory=list)


class PendingProposalMemory(BaseModel):
    """Shape of ``ConversationSession.pending_proposal`` for pantry-update turns.

    Written by ``update_session_node`` (router.py), read back by ``review_gate``
    (workflows/pantry/nodes.py) to surface unresolved items/terms from earlier
    turns.

    ``suggestions`` maps each unclear term (lowercased) to the concrete items the
    LLM suggested -- e.g. ``{"vegetables": ["onion", "broccoli", "carrot"]}``.
    A term is only resolved when one of its OWN suggestions appears in the
    current turn's actions (issue #342).
    """

    item_names: list[str] = Field(default_factory=list)
    unclear_terms: list[str] = Field(default_factory=list)
    suggestions: dict[str, list[str]] = Field(
        default_factory=dict,
        description="term.lower() -> concrete suggestion list",
    )


class SessionContext(BaseModel):
    """Typed replacement for the ``metadata`` JSON column on conversation sessions.

    All four magic-string keys previously accessed as ``session.metadata["key"]``
    are now typed fields.  A missing key defaults rather than silently returning
    None; a wrong-typed value raises at the model boundary.
    """

    cooking_recipe: CookingRecipeSnapshot | None = None
    brainstorm_ideas: list[str] = Field(default_factory=list)
    recipe_constraints: RecipeConstraints | None = None
    last_recipe_title: str | None = None


class ConversationSession(BaseModel):
    """Persistent session state for a conversation."""

    conversation_id: str
    active_mode: SessionMode = SessionMode.DEFAULT
    pinned_recipe_id: str | None = None
    pending_proposal: PendingProposalMemory | None = None
    # Field serialises/deserialises under the DB column name "metadata" so the
    # existing JSON column round-trips without a migration.
    metadata: SessionContext = Field(default_factory=SessionContext)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def is_default(self) -> bool:
        """Check if session is in default mode."""
        return self.active_mode == SessionMode.DEFAULT

    def reset(self) -> ConversationSession:
        """Return a copy reset to default mode."""
        return self.model_copy(
            update={
                "active_mode": SessionMode.DEFAULT,
                "pinned_recipe_id": None,
                "pending_proposal": None,
                "metadata": SessionContext(),
                "updated_at": datetime.now(UTC),
            }
        )
