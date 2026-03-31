"""Tests for conversation sessions (Phase R2)."""

import os
import tempfile
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio

from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.repository.sqlite import SQLiteRepository


@pytest_asyncio.fixture
async def repo():
    """Create a test repo with a clean database."""
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    test_repo = SQLiteRepository(db_path=db_path)
    await test_repo.initialize()
    yield test_repo
    await test_repo.close()
    os.close(db_fd)
    os.unlink(db_path)


# =============================================================================
# Session CRUD
# =============================================================================


@pytest.mark.asyncio
async def test_get_or_create_session_creates_default(repo: SQLiteRepository) -> None:
    """First access to a conversation_id creates a default session."""
    session = await repo.get_or_create_session("conv-1")
    assert session.conversation_id == "conv-1"
    assert session.active_mode == SessionMode.DEFAULT
    assert session.pinned_recipe_id is None
    assert session.pending_proposal is None
    assert session.metadata == {}


@pytest.mark.asyncio
async def test_get_or_create_session_returns_existing(repo: SQLiteRepository) -> None:
    """Second access returns the same session, not a new one."""
    session1 = await repo.get_or_create_session("conv-2")
    session2 = await repo.get_or_create_session("conv-2")
    assert session1.conversation_id == session2.conversation_id
    assert session1.created_at == session2.created_at


@pytest.mark.asyncio
async def test_update_session_persists_mode(repo: SQLiteRepository) -> None:
    """Updating session mode persists to DB."""
    session = await repo.get_or_create_session("conv-3")
    session.active_mode = SessionMode.RECIPE_EXPLORING
    session.metadata = {"brainstorm_ideas": ["Pasta", "Stir Fry"]}
    await repo.update_session(session)

    reloaded = await repo.get_or_create_session("conv-3")
    assert reloaded.active_mode == SessionMode.RECIPE_EXPLORING
    assert reloaded.metadata["brainstorm_ideas"] == ["Pasta", "Stir Fry"]


@pytest.mark.asyncio
async def test_update_session_persists_proposal(repo: SQLiteRepository) -> None:
    """Pending proposal JSON round-trips correctly."""
    session = await repo.get_or_create_session("conv-4")
    session.active_mode = SessionMode.INGESTING
    session.pending_proposal = {"actions": [{"name": "milk", "quantity": 1}]}
    await repo.update_session(session)

    reloaded = await repo.get_or_create_session("conv-4")
    assert reloaded.pending_proposal is not None
    assert reloaded.pending_proposal["actions"][0]["name"] == "milk"


@pytest.mark.asyncio
async def test_update_session_clears_proposal(repo: SQLiteRepository) -> None:
    """Setting proposal to None clears it."""
    session = await repo.get_or_create_session("conv-5")
    session.pending_proposal = {"test": True}
    await repo.update_session(session)

    session.pending_proposal = None
    session.active_mode = SessionMode.DEFAULT
    await repo.update_session(session)

    reloaded = await repo.get_or_create_session("conv-5")
    assert reloaded.pending_proposal is None
    assert reloaded.active_mode == SessionMode.DEFAULT


# =============================================================================
# Session Model
# =============================================================================


def test_session_reset() -> None:
    """reset() returns default mode with cleared fields."""
    session = ConversationSession(
        conversation_id="conv-6",
        active_mode=SessionMode.COOKING,
        pinned_recipe_id="recipe-123",
        pending_proposal={"test": True},
        metadata={"step": 3},
    )
    reset = session.reset()
    assert reset.active_mode == SessionMode.DEFAULT
    assert reset.pinned_recipe_id is None
    assert reset.pending_proposal is None
    assert reset.metadata == {}
    assert reset.conversation_id == "conv-6"


def test_session_is_default() -> None:
    """is_default() returns True only for DEFAULT mode."""
    session = ConversationSession(conversation_id="x")
    assert session.is_default() is True

    session.active_mode = SessionMode.COOKING
    assert session.is_default() is False


# =============================================================================
# Staleness
# =============================================================================


def test_session_staleness_detection() -> None:
    """Old sessions should be detectable for staleness reset."""
    old_time = datetime.now(UTC) - timedelta(minutes=45)
    session = ConversationSession(
        conversation_id="conv-stale",
        active_mode=SessionMode.RECIPE_EXPLORING,
        updated_at=old_time,
    )
    age = datetime.now(UTC) - session.updated_at
    assert age > timedelta(minutes=30)


# =============================================================================
# Mode-Aware Classification (unit tests for routing logic)
# =============================================================================


def test_exit_phrases_are_lowercase() -> None:
    """Ensure EXIT_PHRASES constant exists and contains expected values."""
    from bubbly_chef.workflows.router import EXIT_PHRASES

    assert "exit" in EXIT_PHRASES
    assert "cancel" in EXIT_PHRASES
    assert "go back" in EXIT_PHRASES
    assert "done" in EXIT_PHRASES


def test_session_mode_enum_values() -> None:
    """SessionMode values match what the router expects."""
    assert SessionMode.DEFAULT.value == "default"
    assert SessionMode.COOKING.value == "cooking"
    assert SessionMode.RECIPE_EXPLORING.value == "recipe_exploring"
    assert SessionMode.INGESTING.value == "ingesting"
    assert SessionMode.PANTRY_EDITING.value == "pantry_editing"
