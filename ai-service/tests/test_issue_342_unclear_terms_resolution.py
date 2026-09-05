"""Tests for issue #342 — update_session_node clears resolved unclear_terms.

The backend fix: after a pill-tap turn (user picks a concrete item from a
term's suggestion list), remove that term from
session.pending_proposal.unclear_terms. The check is suggestion-overlap:
a term is only resolved when one of ITS OWN suggestions appears in this
turn's actions. A term the user never addressed must survive, even if the
user added other items this turn.

When unclear_terms empties out, clear pending_proposal entirely so
review_gate stops prepending the "(still don't know...)" context note.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from datetime import date

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryUpsertAction,
    StorageLocation,
)
from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.workflows.router import update_session_node


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


def _session_with_pending(
    item_names: list[str],
    unclear_terms: list[str],
    suggestions: dict[str, list[str]] | None = None,
    mode: SessionMode = SessionMode.INGESTING,
) -> ConversationSession:
    return ConversationSession(
        conversation_id="conv-1",
        active_mode=mode,
        pending_proposal={
            "item_names": item_names,
            "unclear_terms": unclear_terms,
            "suggestions": suggestions or {},
        },
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
        "requires_review": True,
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


# ---------------------------------------------------------------------------
# Pill-tap resolves only the term whose suggestions were picked (#342)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pill_tap_resolves_term_whose_suggestions_were_picked() -> None:
    """
    Session has unclear_terms=[vegetables, dairy products] with stored
    suggestions. This turn picks onion + broccoli (both are vegetables
    suggestions). "vegetables" is resolved and dropped; "dairy products"
    has no matching action and SURVIVES.
    """
    session = _session_with_pending(
        item_names=["eggs", "apples"],
        unclear_terms=["vegetables", "dairy products"],
        suggestions={
            "vegetables": ["onion", "broccoli", "carrot", "spinach"],
            "dairy products": ["milk", "yogurt", "butter", "cheese"],
        },
    )
    repo = _repo(session)

    state = _state(
        actions=[_fake_action("onion"), _fake_action("broccoli")],
        generic_pantry_terms=[],
    )

    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]

    repo.update_session.assert_awaited_once()
    saved: ConversationSession = repo.update_session.await_args.args[1]
    pending = saved.pending_proposal or {}
    remaining = [t.lower() for t in pending.get("unclear_terms", [])]
    assert "vegetables" not in remaining, (
        "vegetables should be resolved: onion/broccoli are its suggestions"
    )
    assert "dairy products" in remaining, (
        "dairy products must survive: no dairy suggestion was picked this turn"
    )


@pytest.mark.asyncio
async def test_unrelated_action_does_not_resolve_unclear_term() -> None:
    """
    The regression case: session has unclear_terms=["vegetables"] with
    suggestions [onion, broccoli, carrot]. User adds "eggs" — unrelated
    to vegetables. "vegetables" must SURVIVE and pending_proposal must NOT
    be cleared.
    """
    session = _session_with_pending(
        item_names=["apples"],
        unclear_terms=["vegetables"],
        suggestions={"vegetables": ["onion", "broccoli", "carrot"]},
    )
    repo = _repo(session)

    state = _state(
        actions=[_fake_action("eggs")],   # eggs is NOT a vegetable suggestion
        generic_pantry_terms=[],
    )

    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]

    saved: ConversationSession = repo.update_session.await_args.args[1]
    pending = saved.pending_proposal or {}
    remaining = [t.lower() for t in pending.get("unclear_terms", [])]
    assert "vegetables" in remaining, (
        "vegetables must survive: 'eggs' is not one of its suggestions"
    )
    assert saved.pending_proposal is not None, (
        "pending_proposal must not be cleared while unclear_terms remain"
    )


# ---------------------------------------------------------------------------
# Clearing pending_proposal when ALL terms are resolved
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pending_proposal_cleared_when_all_unclear_terms_resolved() -> None:
    """
    Session has pending_proposal with item_names and unclear_terms=["vegetables"].
    This pill-tap turn picks onion (a vegetables suggestion).
    After resolution unclear_terms becomes empty → pending_proposal is None.
    """
    session = _session_with_pending(
        item_names=["eggs", "apples"],
        unclear_terms=["vegetables"],
        suggestions={"vegetables": ["onion", "broccoli", "carrot"]},
    )
    repo = _repo(session)

    state = _state(
        actions=[_fake_action("onion"), _fake_action("broccoli")],
        generic_pantry_terms=[],
    )

    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]

    saved: ConversationSession = repo.update_session.await_args.args[1]
    assert saved.pending_proposal is None, (
        "pending_proposal must be cleared when all unclear_terms are resolved"
    )


@pytest.mark.asyncio
async def test_pending_proposal_not_cleared_while_unclear_terms_remain() -> None:
    """
    Session has two unclear terms; this turn resolves one (vegetables via
    onion), but dairy products has no matching action. pending_proposal must
    stay set.
    """
    session = _session_with_pending(
        item_names=["eggs"],
        unclear_terms=["vegetables", "dairy products"],
        suggestions={
            "vegetables": ["onion", "broccoli", "carrot"],
            "dairy products": ["milk", "yogurt", "butter"],
        },
    )
    repo = _repo(session)

    state = _state(
        actions=[_fake_action("onion")],
        generic_pantry_terms=[],
    )

    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]

    saved: ConversationSession = repo.update_session.await_args.args[1]
    assert saved.pending_proposal is not None, (
        "pending_proposal must not be cleared while some unclear_terms remain"
    )
    pending = saved.pending_proposal or {}
    assert "dairy products" in [t.lower() for t in pending.get("unclear_terms", [])]


# ---------------------------------------------------------------------------
# Suggestions map is written to pending_proposal for future turns
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_suggestions_written_to_pending_proposal() -> None:
    """
    When a turn produces clarification_suggestions from suggest_specifics,
    the suggestions map is persisted in pending_proposal so the resolution
    filter has the data it needs next turn.
    """
    session = _session_with_pending(item_names=[], unclear_terms=[])
    repo = _repo(session)

    state = _state(
        actions=[],
        generic_pantry_terms=["vegetables"],
        clarification_suggestions=[
            {"term": "vegetables", "suggestions": ["onion", "broccoli", "carrot"]},
        ],
    )

    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]

    saved: ConversationSession = repo.update_session.await_args.args[1]
    pending = saved.pending_proposal or {}
    stored_suggestions = pending.get("suggestions", {})
    assert "vegetables" in stored_suggestions, (
        "suggestions for 'vegetables' must be persisted for next-turn resolution"
    )
    assert "onion" in stored_suggestions["vegetables"]


# ---------------------------------------------------------------------------
# Zero-action turns do not resolve terms
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_zero_action_turn_does_not_resolve_unclear_terms() -> None:
    """
    A vague-only turn (no actions) with a suggestion-match impossible
    anyway. The existing unclear term must survive untouched.
    """
    session = _session_with_pending(
        item_names=["eggs"],
        unclear_terms=["vegetables"],
        suggestions={"vegetables": ["onion", "broccoli", "carrot"]},
    )
    repo = _repo(session)

    state = _state(
        actions=[],
        generic_pantry_terms=["some stuff"],
    )

    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]

    saved: ConversationSession = repo.update_session.await_args.args[1]
    pending = saved.pending_proposal or {}
    assert "vegetables" in [t.lower() for t in pending.get("unclear_terms", [])]


# ---------------------------------------------------------------------------
# No unclear_terms — baseline stays stable
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_unclear_terms_leaves_pending_proposal_unchanged() -> None:
    """
    Session with only item_names and no unclear_terms — standard proposal.
    The resolution code path is a no-op: unclear_terms stays empty.
    """
    session = _session_with_pending(item_names=["eggs", "milk"], unclear_terms=[])
    repo = _repo(session)

    state = _state(
        actions=[_fake_action("butter")],
        generic_pantry_terms=[],
    )

    with _patch_repo(repo):
        await update_session_node(state)  # type: ignore[arg-type]

    saved: ConversationSession = repo.update_session.await_args.args[1]
    pending = saved.pending_proposal or {}
    assert pending.get("unclear_terms", []) == []
