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
context for about 5 further turns, then let them decay, rather than living
forever or vanishing the instant the next turn also resolves cleanly.

Orchestrator review on PR #600 found the first version of this fix wrong in
three ways, all addressed here:

1. The continuity note fired on *every* ordinary add turn (not just a turn
   that actually needs to resolve against earlier items), with an
   ever-growing item list merged across every clean turn. Fixed: the note
   stays silent unless the current turn itself has its own
   ``generic_pantry_terms`` to resolve, and a clean turn's carried
   ``item_names`` is a snapshot of that turn only, not an accumulating
   merge.
2. The 5-turn decay could never actually elapse, because every PANTRY_UPDATE
   clean turn immediately re-armed the TTL back to 5 and every review turn
   set it to ``None``. Fixed: the TTL now ticks down once per turn
   (including non-pantry turns) unless that turn just refreshed it.
3. The old expiry test drove ``update_session_node`` with
   ``requires_review=False, actions=[]`` in a loop — a state combination
   ``review_gate`` never produces (it forces ``requires_review=True``
   whenever there are no actions). Fixed: tests below run turns through
   ``review_gate`` first, exactly as the real graph does, and use
   non-pantry turns (general_chat) to advance the decay, since a real
   PANTRY_UPDATE turn with items always refreshes the TTL.
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
from bubbly_chef.workflows.pantry.nodes import review_gate
from bubbly_chef.workflows.router import (
    _CLEAN_TURN_ITEM_CONTINUITY_TURNS,
    update_session_node,
)

_CONTINUITY_NOTE_SNIPPET = "you already added"
_STILL_PENDING_SNIPPET = "from earlier in this chat"


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
    # confidence=0.95 clears both review_gate's item_clarification_threshold
    # (0.6) and the default auto_apply_confidence_threshold (0.8), so a
    # clean list of these actions genuinely comes back requires_review=False
    # from review_gate — not asserted by hand.
    return PantryUpsertAction(
        action_type=ActionType.ADD,
        item=_fake_item(name),
        confidence=0.95,
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


async def _run_pantry_turn(
    session: ConversationSession,
    item_names: list[str],
    generic_pantry_terms: list[str] | None = None,
) -> tuple[str, ConversationSession]:
    """Run one PANTRY_UPDATE turn the way the real graph does: review_gate
    first (deriving requires_review and the assistant_message, including
    any continuity note, from the actual node logic — not asserted by
    hand), then update_session_node (which persists the result).

    Returns (assistant_message, saved_session).
    """
    actions = [_fake_action(name) for name in item_names]
    dumped_session = session.model_dump(mode="json")

    rg_result = review_gate(
        {
            "actions": actions,
            "confidence": 0.95,
            "errors": [],
            "generic_pantry_terms": generic_pantry_terms or [],
            "session": dumped_session,
        }
    )

    state = _state(
        intent=Intent.PANTRY_UPDATE.value,
        requires_review=rg_result["requires_review"],
        actions=actions,
        generic_pantry_terms=generic_pantry_terms or [],
        clarification_suggestions=[],
        session=dumped_session,
    )
    saved = await _run(state, session)
    return rg_result["assistant_message"], saved


async def _run_non_pantry_turn(session: ConversationSession) -> ConversationSession:
    """Advance one general_chat turn. Never touches pending_proposal
    directly (that only happens on the PANTRY_UPDATE branch), but still
    counts as a turn for item-continuity decay purposes — update_session_node
    ticks the TTL down for every intent, which is exactly the behaviour
    under test here."""
    state = _state(
        intent=Intent.GENERAL_CHAT.value,
        requires_review=False,
        actions=[],
        generic_pantry_terms=[],
    )
    return await _run(state, session)


class TestCleanTurnKeepsItemContinuity:
    """The core #370 reproduction: a clean turn must not wipe item_names,
    and the carried names must actually help resolve a later vague turn."""

    @pytest.mark.asyncio
    async def test_clean_turn_does_not_wipe_pending_proposal_to_none(self) -> None:
        """Turn 1: 'I have apples and eggs' -- clean add, nothing unclear.
        Before the fix this set pending_proposal = None outright."""
        _, saved = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])

        assert saved.pending_proposal is not None, (
            "a clean turn must not wipe pending_proposal to None when it "
            "just added items -- that erases the continuity the very next "
            "vague turn needs"
        )
        names_lower = [n.lower() for n in saved.pending_proposal.continuity_item_names]
        assert "apples" in names_lower
        assert "eggs" in names_lower

    @pytest.mark.asyncio
    async def test_next_vague_turn_sees_items_from_the_clean_turn_before_it(self) -> None:
        """End-to-end reproduction of the issue's two-turn scenario: turn 1's
        clean add must still be visible to turn 2's vague-term continuity,
        including in the actual assistant_message review_gate produces."""
        _, after_turn1 = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])

        message, after_turn2 = await _run_pantry_turn(
            after_turn1, [], generic_pantry_terms=["dairy products"]
        )

        assert _CONTINUITY_NOTE_SNIPPET in message, (
            "a turn that itself has an unclear term must surface the "
            "earlier clean turn's items as context -- this IS the case "
            "issue #370 asks for"
        )
        assert "apples" in message.lower() or "eggs" in message.lower()

        assert after_turn2.pending_proposal is not None
        names_lower = [
            n.lower() for n in after_turn2.pending_proposal.continuity_item_names
        ]
        assert "apples" in names_lower
        assert "eggs" in names_lower
        assert "dairy products" in [
            t.lower() for t in after_turn2.pending_proposal.unclear_terms
        ]

    @pytest.mark.asyncio
    async def test_ordinary_add_after_continuity_established_stays_silent(self) -> None:
        """Orchestrator review on PR #600, finding 1: an ordinary add turn
        (no generic_pantry_terms of its own) must NOT prepend "(still with
        apples, eggs from earlier in this chat.)" just because an earlier
        clean turn is still within its retention window. Those items were
        already added -- there's nothing here for this turn to resolve
        against them."""
        _, after_turn1 = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])

        message, after_turn2 = await _run_pantry_turn(after_turn1, ["milk"])

        assert _CONTINUITY_NOTE_SNIPPET not in message, (
            f"an ordinary clean add must stay silent about earlier items, got: {message!r}"
        )

    @pytest.mark.asyncio
    async def test_clean_turn_item_names_are_not_merged_across_turns(self) -> None:
        """Orchestrator review on PR #600, finding 1: a clean turn's carried
        item_names must be a snapshot of THAT turn only, not an
        accumulating list -- otherwise it grows without bound across a long
        conversation of successive clean adds."""
        _, after_turn1 = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])
        _, after_turn2 = await _run_pantry_turn(after_turn1, ["milk"])

        assert after_turn2.pending_proposal is not None
        names_lower = [
            n.lower() for n in after_turn2.pending_proposal.continuity_item_names
        ]
        assert names_lower == ["milk"], (
            f"expected only the latest turn's items, got {names_lower!r}"
        )


class TestReviewTurnDoesNotLeakContinuityForward:
    """Orchestrator re-review on PR #600, inline comment on
    ``pantry/nodes.py:609``: the silence gate keys on
    ``item_continuity_ttl is not None``, but the PANTRY_UPDATE review branch
    used to rebuild ``PendingProposalMemory`` without that field, dropping
    it to ``None`` while the carried item names survived the merge -- so an
    ordinary add one turn *after* a review turn would resurrect the note
    about items that were already added."""

    @pytest.mark.asyncio
    async def test_clean_vague_clean_stays_silent_on_the_final_clean_turn(self) -> None:
        """The exact trace from the review comment: 'I have apples and
        eggs' (clean) -> 'some dairy' (vague, review) -> 'I bought milk'
        (clean). Turn 3 must not say '(still with Apples, Eggs from earlier
        in this chat)' -- those items were applied in turn 1, and turn 2
        already surfaced them as context once."""
        _, after_turn1 = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])

        _, after_turn2 = await _run_pantry_turn(
            after_turn1, [], generic_pantry_terms=["dairy products"]
        )

        message, after_turn3 = await _run_pantry_turn(after_turn2, ["milk"])

        assert _CONTINUITY_NOTE_SNIPPET not in message, (
            f"turn 3 is an ordinary add; it must not resurrect 'you already "
            f"added apples, eggs' about items already added two turns "
            f"earlier, got: {message!r}"
        )
        assert _STILL_PENDING_SNIPPET not in message, (
            f"turn 3 must not treat apples/eggs as still-unresolved "
            f"either, got: {message!r}"
        )

    @pytest.mark.asyncio
    async def test_clean_turn_between_two_vague_turns_does_not_resurrect_old_items_either(
        self,
    ) -> None:
        """Documents existing (pre-#370, out-of-scope) behaviour rather than
        changing it: an intervening ordinary clean turn resets
        unclear_terms just like it always has -- this PR only stops it
        from also resurrecting already-applied item names. A follow-up
        vague turn after that clean turn gets a fresh slate, not a
        reprint of apples/eggs."""
        _, after_turn1 = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])
        _, after_turn2 = await _run_pantry_turn(
            after_turn1, [], generic_pantry_terms=["dairy products"]
        )
        _, after_turn3 = await _run_pantry_turn(after_turn2, ["milk"])

        message, _after_turn4 = await _run_pantry_turn(
            after_turn3, [], generic_pantry_terms=["some snacks"]
        )

        assert "apples" not in message.lower() and "eggs" not in message.lower(), (
            f"the already-applied apples/eggs must not reappear even once "
            f"a fresh unclear term shows up, got: {message!r}"
        )

    @pytest.mark.asyncio
    async def test_genuinely_pending_review_items_still_carry_forward(self) -> None:
        """Guard against overcorrecting: when the existing memory is a real
        still-pending proposal (item_continuity_ttl is None because it came
        from a previous review turn, not a clean one), a further review
        turn must still merge its item_names forward -- only clean-turn
        continuity snapshots are excluded from the merge."""
        session = _session(
            pending=PendingProposalMemory(
                item_names=["Tofu"],
                unclear_terms=["some veggies"],
            )
        )

        _, after = await _run_pantry_turn(
            session, [], generic_pantry_terms=["more snacks"]
        )

        assert after.pending_proposal is not None
        names_lower = [n.lower() for n in after.pending_proposal.item_names]
        assert "tofu" in names_lower, (
            "a genuinely still-pending item must survive a further review "
            "turn's merge, not just clean-turn continuity items"
        )


class TestCleanTurnContinuityDecays:
    """Ayush's call: keep for about 5 turns, not forever -- and the window
    must actually elapse in the real graph, not just in the TTL arithmetic."""

    @pytest.mark.asyncio
    async def test_item_continuity_survives_within_the_window(self) -> None:
        """A vague turn arriving within the retention window still sees the
        earlier clean turn's items, even after some intervening non-pantry
        turns. (The turn that actually *uses* the continuity is itself the
        last turn within the window -- it still counts for decay purposes,
        same as any other turn, so the persisted memory is consumed by the
        time this turn is saved. What matters here is that the message
        this turn produces got to see it.)"""
        _, session = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])

        # Fewer than the full window's worth of intervening turns.
        for _ in range(_CLEAN_TURN_ITEM_CONTINUITY_TURNS - 1):
            session = await _run_non_pantry_turn(session)

        message, _saved = await _run_pantry_turn(
            session, [], generic_pantry_terms=["dairy products"]
        )

        assert _CONTINUITY_NOTE_SNIPPET in message
        assert "apples" in message.lower() or "eggs" in message.lower()

    @pytest.mark.asyncio
    async def test_item_continuity_expires_after_the_window(self) -> None:
        """After _CLEAN_TURN_ITEM_CONTINUITY_TURNS further turns with
        nothing that refreshes it, the old clean turn's items must no
        longer be surfaced -- the retention window is ~5 turns, not
        forever. Uses non-pantry (general_chat) turns to advance the decay:
        a real PANTRY_UPDATE turn with items would refresh the TTL instead
        of ticking it down, which is exactly the bug the orchestrator's
        review caught in the first version of this fix."""
        _, session = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])

        for _ in range(_CLEAN_TURN_ITEM_CONTINUITY_TURNS):
            session = await _run_non_pantry_turn(session)

        message, saved = await _run_pantry_turn(
            session, [], generic_pantry_terms=["dairy products"]
        )

        assert _CONTINUITY_NOTE_SNIPPET not in message, (
            f"continuity should have expired by now, got: {message!r}"
        )
        continuity_names = (
            saved.pending_proposal.continuity_item_names if saved.pending_proposal else []
        )
        assert "apples" not in [n.lower() for n in continuity_names]
        assert "eggs" not in [n.lower() for n in continuity_names]

    @pytest.mark.asyncio
    async def test_a_review_turn_ticks_the_ttl_down_without_resetting_it(self) -> None:
        """A turn that itself resolves against the carried items (a review
        turn, requires_review=True) must not reset the decay clock back to
        the full window -- but it also must not drop the ttl marker
        entirely (orchestrator re-review on PR #600, inline comment on
        nodes.py:609): continuity_item_names / item_continuity_ttl are a
        separate field from the genuinely-still-pending item_names /
        unclear_terms this branch merges, and must pass through untouched
        (just ticking down like any other turn) rather than being folded
        into the never-expiring #307-followup memory."""
        _, session = await _run_pantry_turn(_session(pending=None), ["apples", "eggs"])
        assert session.pending_proposal is not None
        assert session.pending_proposal.item_continuity_ttl == _CLEAN_TURN_ITEM_CONTINUITY_TURNS

        _, session = await _run_pantry_turn(
            session, [], generic_pantry_terms=["dairy products"]
        )

        assert session.pending_proposal is not None
        assert session.pending_proposal.continuity_item_names, (
            "the review turn must not drop the earlier clean turn's "
            "continuity items"
        )
        assert (
            session.pending_proposal.item_continuity_ttl
            == _CLEAN_TURN_ITEM_CONTINUITY_TURNS - 1
        ), (
            "a review turn is still a turn for decay purposes -- it must "
            "tick the ttl down by exactly one, neither resetting it back "
            "to the full window nor dropping it to None"
        )
