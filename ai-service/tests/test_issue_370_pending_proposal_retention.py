"""Tests for issue #370 — a cleanly-resolved pantry-add turn wipes item
continuity for the next turn.

Reproduction (from the issue):

1. User: "I have apples and eggs" — clean add, nothing left unclear
   (``requires_review = False``). The old code did
   ``session.pending_proposal = None`` unconditionally here, discarding the
   only place item-name continuity across turns is tracked.
2. User (next turn): "some dairy" — a vague term, ``requires_review = True``.
   ``review_gate`` reads ``session.pending_proposal`` for the "(still with
   ... from earlier in this chat)" context note, but turn 1 wiped it, so the
   note has no memory that apples and eggs were just added.

Triage decision (2026-09-23, Ayush): keep a clean turn's item names as
context for about 5 further pantry-update turns, then let them decay,
rather than living forever or vanishing the instant the next turn also
resolves cleanly.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryUpsertAction,
    StorageLocation,
)
from bubbly_chef.models.session import (
    ConversationSession,
    PendingProposalMemory,
    SessionMode,
)
from bubbly_chef.workflows.router import (
    _CLEAN_TURN_ITEM_CONTINUITY_TURNS,
    update_session_node,
)


def _fake_item(name: str) -> PantryItem:
    return PantryItem(
        id=uuid4(),
        client_item_key=f"produce:{name}",
        name=name,
        category=FoodCategory.PRODUCE,
        storage_location=StorageLocation.PANTRY,
        quantity=1.0,
        unit="item",
        expiry_date=date(2026, 12, 31),
    )


def _fake_action(name: str) -> PantryUpsertAction:
    return PantryUpsertAction(
        action_type=ActionType.ADD,
        item=_fake_item(name),
        confidence=0.9,
    )


def _session(pending: PendingProposalMemory | None = None) -> ConversationSession:
    return ConversationSession(
        conversation_id="conv-1",
        active_mode=SessionMode.DEFAULT,
        pending_proposal=pending,
    )


def _repo(session: ConversationSession) -> MagicMock:
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    return repo


def _patch_repo(repo: MagicMock):
    return patch(
        "bubbly_chef.workflows.router.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    )


def _state(**kwargs) -> dict:
    base: dict = {
        "conversation_id": "conv-1",
        "user_id": "user-1",
        "intent": Intent.PANTRY_UPDATE.value,
        "requires_review": False,
        "actions": [],
        "generic_pantry_terms": [],
        "clarification_suggestions": [],
        "context": None,
        "warnings": [],
        "errors": [],
        "session": None,
        "session_mode": None,
        "_exit_mode": False,
    }
    base.update(kwargs)
    return base


async def _run(state: dict, session: ConversationSession) -> ConversationSession:
    """Run update_session_node and return the saved session."""
    repo = _repo(session)
    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]
    repo.update_session.assert_awaited_once()
    return repo.update_session.await_args.args[1]


class TestCleanTurnKeepsItemContinuity:
    """The core #370 reproduction: a clean turn must not wipe item_names."""

    @pytest.mark.asyncio
    async def test_clean_turn_does_not_wipe_pending_proposal_to_none(self) -> None:
        """Turn 1: 'I have apples and eggs' -- clean add, nothing unclear.
        Before the fix this set pending_proposal = None outright."""
        state = _state(
            requires_review=False,
            actions=[_fake_action("apples"), _fake_action("eggs")],
        )

        saved = await _run(state, _session(pending=None))

        assert saved.pending_proposal is not None, (
            "a clean turn must not wipe pending_proposal to None when it "
            "just added items -- that erases the continuity the very next "
            "vague turn needs"
        )
        names_lower = [n.lower() for n in saved.pending_proposal.item_names]
        assert "apples" in names_lower
        assert "eggs" in names_lower

    @pytest.mark.asyncio
    async def test_next_vague_turn_sees_items_from_the_clean_turn_before_it(self) -> None:
        """End-to-end reproduction of the issue's two-turn scenario: turn 1's
        clean add must still be visible to turn 2's vague-term continuity."""
        turn1_state = _state(
            requires_review=False,
            actions=[_fake_action("apples"), _fake_action("eggs")],
        )
        after_turn1 = await _run(turn1_state, _session(pending=None))

        turn2_state = _state(
            requires_review=True,
            actions=[],
            generic_pantry_terms=["dairy products"],
        )
        after_turn2 = await _run(turn2_state, after_turn1)

        assert after_turn2.pending_proposal is not None
        names_lower = [n.lower() for n in after_turn2.pending_proposal.item_names]
        assert "apples" in names_lower
        assert "eggs" in names_lower
        assert "dairy products" in [
            t.lower() for t in after_turn2.pending_proposal.unclear_terms
        ]


class TestCleanTurnContinuityDecays:
    """Ayush's call: keep for about 5 turns, not forever."""

    @pytest.mark.asyncio
    async def test_item_continuity_survives_within_the_window(self) -> None:
        """A vague turn arriving within the retention window still sees the
        earlier clean turn's items."""
        session = _session(
            pending=PendingProposalMemory(
                item_names=["apples", "eggs"],
                item_continuity_ttl=_CLEAN_TURN_ITEM_CONTINUITY_TURNS,
            )
        )
        state = _state(
            requires_review=True,
            actions=[],
            generic_pantry_terms=["dairy products"],
        )

        saved = await _run(state, session)

        names_lower = [n.lower() for n in saved.pending_proposal.item_names]
        assert "apples" in names_lower
        assert "eggs" in names_lower

    @pytest.mark.asyncio
    async def test_item_continuity_expires_after_the_window(self) -> None:
        """After _CLEAN_TURN_ITEM_CONTINUITY_TURNS further pantry-update
        turns with nothing new recognized, the old clean turn's items must
        no longer be surfaced -- the retention window is ~5 turns, not
        forever."""
        session = _session(
            pending=PendingProposalMemory(
                item_names=["apples", "eggs"],
                item_continuity_ttl=_CLEAN_TURN_ITEM_CONTINUITY_TURNS,
            )
        )

        # Advance _CLEAN_TURN_ITEM_CONTINUITY_TURNS clean turns with nothing
        # recognized -- each one ticks the TTL down by one.
        for _ in range(_CLEAN_TURN_ITEM_CONTINUITY_TURNS):
            state = _state(requires_review=False, actions=[])
            session = await _run(state, session)

        # One more vague turn: the decayed memory must be gone.
        final_state = _state(
            requires_review=True,
            actions=[],
            generic_pantry_terms=["dairy products"],
        )
        saved = await _run(final_state, session)

        item_names = saved.pending_proposal.item_names if saved.pending_proposal else []
        assert "apples" not in [n.lower() for n in item_names]
        assert "eggs" not in [n.lower() for n in item_names]
