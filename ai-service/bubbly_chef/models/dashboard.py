"""Pydantic models for GET /v1/dashboard/daily (#225, #168).

Two distinct schemas live here:
- `DashboardDailyResponse` (+ nested `DashboardTip` / `DashboardSuggestion`) is the
  wire contract returned to the client.
- `DashboardCopyResult` is the *internal* structured-output schema the single
  `AIManager.complete()` call fills in. The LLM only ever produces copy — it
  never picks the recipe, so it has no `recipe_id` field to hallucinate into.
"""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Why a recipe won, so the UI can vary emphasis and a test can assert on the
# ranking without asserting on LLM prose.
DashboardSuggestionReason = Literal["expiring", "pantry_match", "meal_time", "fallback"]


class DashboardTip(BaseModel):
    """A single AI-generated (or fallback) cooking tip."""

    text: str = Field(description="The tip shown to the user")
    category: str = Field(description="Loose grouping, e.g. technique | ingredient | pantry")


class DashboardSuggestion(BaseModel):
    """A recipe suggestion. Always one of the user's saved recipes — never invented."""

    model_config = {"populate_by_name": True}

    recipe_id: UUID
    title: str
    total_time_minutes: int | None = None
    # Field name is `copy_`, not `copy` — `copy` is a BaseModel method name, and
    # shadowing it trips a pydantic warning (and a mypy assignment error) at class
    # definition time. `alias="copy"` keeps the wire contract in
    # docs/plans/2026-09-04-dashboard-daily-endpoint.md unchanged: FastAPI's
    # default `response_model_by_alias=True` serializes this field as "copy".
    copy_: str = Field(
        alias="copy", description="Short AI-written (or templated) line explaining the pick"
    )
    reason: DashboardSuggestionReason


class DashboardDailyResponse(BaseModel):
    """Response body for GET /v1/dashboard/daily."""

    tip: DashboardTip
    suggestion: DashboardSuggestion | None = Field(
        default=None, description="Null when the user has no saved recipes"
    )
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    source: Literal["ai", "fallback"]


class DashboardCopyResult(BaseModel):
    """Structured LLM output: copy only, never a recipe choice.

    `suggestion_copy` is only meaningful when the caller passed a chosen
    recipe into the prompt; it is left null when there is nothing to write
    copy for (no saved recipes).
    """

    tip_text: str = Field(description="A short, useful cooking tip, one or two sentences")
    tip_category: str = Field(description="One or two words, e.g. technique, ingredient, pantry")
    suggestion_copy: str | None = Field(
        default=None,
        description=(
            "One short, appealing sentence about why the chosen recipe makes sense "
            "right now, grounded in the pantry items and dietary preferences given. "
            "Null if no recipe was provided."
        ),
    )
