"""Issue #384 — cooking-help conversation history window (10 turns) is too
short for real multi-step cooking.

Two stacked bugs made long cooking conversations forget early context:

1. ``format_history_context`` / ``_format_history_context`` only kept the
   last 10 *messages* (~5 exchanges) of whatever history was handed to them,
   so a detail established at turn 1 (a marinade ratio, an agreed
   substitution) was gone by turn 6.
2. ``SupabaseRepository.get_history`` ordered ascending and applied
   ``.limit()`` in the same query — PostgREST applies limit after order, so
   that returns the *oldest* rows, not the most recent ones. For any
   conversation longer than the limit, the model could never see anything
   newer than the fetch window, no matter how high the formatter's cap was
   raised.

Both tests below reproduce their bug directly (fail before the fix, pass
after) rather than asserting on the new constant.
"""

from __future__ import annotations

from typing import Any

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.workflows.chat.nodes import format_history_context
from bubbly_chef.workflows.recipe.nodes import _format_history_context
from bubbly_chef.workflows.state import WorkflowState


def _turn_history(num_turns: int) -> list[dict[str, str]]:
    """Build `num_turns` user/assistant exchanges, turn 1 carrying a marker
    ("marinade ratio 3:1") that a later turn needs to still be able to see."""
    history: list[dict[str, str]] = []
    for i in range(1, num_turns + 1):
        if i == 1:
            user_content = "I'm marinating chicken, using a 3:1 oil to acid ratio."
        else:
            user_content = f"Turn {i}: what's next?"
        history.append({"role": "user", "content": user_content})
        history.append({"role": "assistant", "content": f"Turn {i} reply."})
    return history


class TestFormatHistoryContextWindow:
    """Reproduces + fixes the formatter-level 10-message cap."""

    def test_chat_formatter_keeps_early_context_by_turn_12(self) -> None:
        """By turn 12, format_history_context must still surface the
        marinade ratio established at turn 1. With the old max_turns=10
        (10 *messages*, ~5 exchanges), turn 1 falls out of the window."""
        state: WorkflowState = {
            "conversation_history": _turn_history(11),  # turns 1-11 precede turn 12
        }

        context = format_history_context(state)

        assert "3:1 oil to acid ratio" in context

    def test_recipe_formatter_keeps_early_context_by_turn_12(self) -> None:
        """Same reproduction against the recipe-mode formatter (#384 scope
        explicitly covers both the chat and recipe history formatters)."""
        state: WorkflowState = {
            "conversation_history": _turn_history(11),
        }

        context = _format_history_context(state)

        assert "3:1 oil to acid ratio" in context


# ---------------------------------------------------------------------------
# get_history recency fix — fake Supabase client that actually threads
# order/limit through so the ascending-order-then-limit bug is visible.
# ---------------------------------------------------------------------------


class _OrderedHistoryQuery:
    """Fluent query stub that mimics PostgREST: order() then limit() applies
    the limit to whatever order the rows are currently in — i.e. it does NOT
    know to return the "most recent" rows unless the caller ordered descending
    first, exactly like real PostgREST."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self._desc = False
        self._limit: int | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_OrderedHistoryQuery":
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> "_OrderedHistoryQuery":
        return self

    def order(self, _column: str, desc: bool = False) -> "_OrderedHistoryQuery":
        self._desc = desc
        return self

    def limit(self, n: int) -> "_OrderedHistoryQuery":
        self._limit = n
        return self

    def execute(self) -> Any:
        rows = list(reversed(self._rows)) if self._desc else list(self._rows)
        if self._limit is not None:
            rows = rows[: self._limit]
        return type("Result", (), {"data": rows})()


class _OrderedHistoryClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def table(self, _name: str) -> _OrderedHistoryQuery:
        return _OrderedHistoryQuery(self._rows)


def _repo_with_rows(rows: list[dict[str, Any]]) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _OrderedHistoryClient(rows)  # type: ignore[assignment]
    return repo


@pytest.mark.asyncio
class TestGetHistoryRecency:
    async def test_returns_most_recent_messages_not_oldest(self) -> None:
        """A conversation with more messages than the requested limit must
        return the tail (most recent) messages, in ascending order — not the
        oldest ones. Simulates 12 turns (24 messages) with limit=10."""
        rows = [
            {
                "role": "user" if i % 2 == 0 else "assistant",
                "content": f"message {i}",
                "created_at": f"2026-01-01T00:{i:02d}:00Z",
            }
            for i in range(24)
        ]
        repo = _repo_with_rows(rows)

        history = await repo.get_history(user_id="u1", conversation_id="c1", limit=10)

        assert len(history) == 10
        # Must be the most recent 10 (messages 14-23), oldest-first.
        assert [row["content"] for row in history] == [f"message {i}" for i in range(14, 24)]

    async def test_default_limit_covers_a_real_multi_step_conversation(self) -> None:
        """22 messages (11 turns) preceding turn 12 must all survive the
        default fetch — turn 1's content must still be present."""
        rows = [
            {"role": "user", "content": "I'm marinating chicken, 3:1 oil to acid ratio."},
            {"role": "assistant", "content": "Got it."},
        ] + [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"}
            for i in range(2, 22)
        ]
        repo = _repo_with_rows(rows)

        history = await repo.get_history(user_id="u1", conversation_id="c1")

        contents = [row["content"] for row in history]
        assert "I'm marinating chicken, 3:1 oil to acid ratio." in contents
