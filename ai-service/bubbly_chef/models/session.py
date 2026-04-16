"""Conversation session model for stateful routing."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class SessionMode(StrEnum):
    """Active conversation modes."""

    DEFAULT = "default"
    COOKING = "cooking"
    RECIPE_EXPLORING = "recipe_exploring"
    INGESTING = "ingesting"
    PANTRY_EDITING = "pantry_editing"


class ConversationSession(BaseModel):
    """Persistent session state for a conversation."""

    conversation_id: str
    active_mode: SessionMode = SessionMode.DEFAULT
    pinned_recipe_id: str | None = None
    pending_proposal: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
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
                "metadata": {},
                "updated_at": datetime.now(UTC),
            }
        )
