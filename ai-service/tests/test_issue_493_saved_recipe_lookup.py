"""Issue #493: SAVED_RECIPE_LOOKUP intent — classifier disambiguation, the
deterministic handler node, envelope metadata, and the session pin.

LLM output for the classifier itself isn't deterministically testable (see
the `test_issue_336`-style pattern of asserting on the rendered prompt
instead), so:
  - the classifier's disambiguation is checked by asserting the required
    example strings are present in `INTENT_CLASSIFICATION_SYSTEM_PROMPT`,
    plus a table-driven mock of `ai_manager.complete` (the `test_chat_router`
    pattern) covering >=8 lookup phrasings and >=8 generation/brainstorm
    phrasings that must NOT route to saved_recipe_lookup;
  - the handler node and session-pin behavior are fully deterministic
    (no LLM call) and asserted directly.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.prompts.router import INTENT_CLASSIFICATION_SYSTEM_PROMPT
from bubbly_chef.workflows.chat.nodes import saved_recipe_lookup_response
from bubbly_chef.workflows.router import classify_intent, update_session_node
from bubbly_chef.workflows.state import LLMIntentResult


def _state(**kwargs: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "input_text": "",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
    }
    base.update(kwargs)
    return base


def _mock_ai(intent: str, confidence: float = 0.9) -> Any:
    llm_result = LLMIntentResult(intent=intent, confidence=confidence, reasoning="t", entities=[])
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


# ---------------------------------------------------------------------------
# Prompt carries the required disambiguation examples
# ---------------------------------------------------------------------------


class TestPromptDisambiguation:
    def test_saved_recipe_lookup_bullet_present(self) -> None:
        assert "saved_recipe_lookup" in INTENT_CLASSIFICATION_SYSTEM_PROMPT

    def test_lookup_examples_present(self) -> None:
        assert "make that butter chicken I saved" in INTENT_CLASSIFICATION_SYSTEM_PROMPT
        assert "show me my saved butter chicken" in INTENT_CLASSIFICATION_SYSTEM_PROMPT
        assert "the pasta I made last week" in INTENT_CLASSIFICATION_SYSTEM_PROMPT

    def test_memory_and_history_examples_present(self) -> None:
        """Asking the assistant to recall a past recipe ("do you remember…",
        "look in my history…") is a lookup, not a request for a new one."""
        for phrase in MEMORY_PHRASINGS:
            assert phrase in INTENT_CLASSIFICATION_SYSTEM_PROMPT, phrase

    def test_generation_examples_unchanged(self) -> None:
        assert "make me a butter chicken" in INTENT_CLASSIFICATION_SYSTEM_PROMPT
        assert "give me a pasta recipe" in INTENT_CLASSIFICATION_SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# Classifier routing — table-driven, mocked LLM
# ---------------------------------------------------------------------------

MEMORY_PHRASINGS = [
    "do you remember that curry recipe?",
    "search your memory for the soup we made",
    "look in my history for that pasta",
    "what was that recipe from last time?",
    "find the one we made before",
]

LOOKUP_PHRASINGS = [
    *MEMORY_PHRASINGS,
    "make that butter chicken I saved",
    "show me my saved butter chicken",
    "the pasta I made last week",
    "show me my saved recipes",
    "find the lasagna I saved",
    "pull up the chicken curry I saved",
    "I want the pasta recipe I saved last month",
    "can you show me my saved chicken tikka",
]

GENERATION_OR_BRAINSTORM_PHRASINGS = [
    ("make me a butter chicken", "recipe_generation"),
    ("give me a pasta recipe", "recipe_generation"),
    ("what can I make tonight?", "recipe_brainstorm"),
    ("recipe for chicken tikka masala", "recipe_generation"),
    ("dinner ideas for tonight", "recipe_brainstorm"),
    ("suggest a meal with chicken", "recipe_generation"),
    ("what should I cook with what I have?", "recipe_brainstorm"),
    ("quick easy meal under 30 minutes", "recipe_generation"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", LOOKUP_PHRASINGS)
async def test_lookup_phrasings_route_to_saved_recipe_lookup(text: str) -> None:
    with _mock_ai("saved_recipe_lookup"):
        result = await classify_intent(_state(input_text=text))
    assert result["intent"] == Intent.SAVED_RECIPE_LOOKUP.value


@pytest.mark.asyncio
@pytest.mark.parametrize("text,intent", GENERATION_OR_BRAINSTORM_PHRASINGS)
async def test_generation_phrasings_do_not_route_to_saved_recipe_lookup(
    text: str, intent: str
) -> None:
    with _mock_ai(intent):
        result = await classify_intent(_state(input_text=text))
    assert result["intent"] != Intent.SAVED_RECIPE_LOOKUP.value
    assert result["intent"] == intent


# ---------------------------------------------------------------------------
# Handler node — deterministic, no LLM
# ---------------------------------------------------------------------------


def _patch_repo(matches: list[dict[str, Any]], recent: list[dict[str, Any]] | None = None) -> Any:
    repo = MagicMock()
    repo.search_saved_recipes = AsyncMock(return_value=matches)
    repo.get_user_recipes = AsyncMock(return_value=recent or [])
    return patch(
        "bubbly_chef.workflows.chat.nodes.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    ), repo


@pytest.mark.asyncio
async def test_zero_matches_offers_to_generate() -> None:
    patcher, _repo = _patch_repo([])
    with patcher:
        result = await saved_recipe_lookup_response(
            _state(input_text="show me my saved poutine", user_id="u1")
        )

    assert "couldn't find" in result["assistant_message"].lower()
    assert "generate a new one instead" in result["assistant_message"].lower()
    assert result["saved_recipe_matches"] == []
    assert result["requires_review"] is False
    assert result["proposal"] is None


@pytest.mark.asyncio
async def test_single_match_names_recipe_without_a_question() -> None:
    matches = [{"id": "r1", "title": "Butter Chicken"}]
    patcher, _repo = _patch_repo(matches)
    with patcher:
        result = await saved_recipe_lookup_response(
            _state(input_text="show me my saved butter chicken", user_id="u1")
        )

    message = result["assistant_message"]
    assert "Butter Chicken" in message
    assert not message.strip().endswith("?")
    assert [m["id"] for m in result["saved_recipe_matches"]] == [m["id"] for m in matches]


@pytest.mark.asyncio
async def test_many_matches_lists_ranked_and_asks_which_one() -> None:
    matches = [
        {"id": "r1", "title": "Butter Chicken"},
        {"id": "r2", "title": "Chicken Tikka Masala"},
    ]
    patcher, _repo = _patch_repo(matches)
    with patcher:
        result = await saved_recipe_lookup_response(
            _state(input_text="show me my saved chicken", user_id="u1")
        )

    message = result["assistant_message"]
    assert "Butter Chicken" in message
    assert "Chicken Tikka Masala" in message
    assert message.strip().endswith("?")
    assert [m["id"] for m in result["saved_recipe_matches"]] == [m["id"] for m in matches]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "show me my saved recipes",
        "what recipes do I have saved",
        "find the one we made before",
        "what was that recipe from last time?",
    ],
)
async def test_request_naming_no_dish_lists_recent_saves(text: str) -> None:
    """Review finding on PR #536: every word of "show me my saved recipes" is a
    stopword, so searching it matched nothing and told a user with a full
    library that no saved recipe existed. With no dish named, browse instead."""
    recent = [
        {"id": "r1", "title": "Butter Chicken"},
        {"id": "r2", "title": "Victoria Sponge"},
    ]
    patcher, repo = _patch_repo([], recent=recent)
    with patcher:
        result = await saved_recipe_lookup_response(_state(input_text=text, user_id="u1"))

    repo.search_saved_recipes.assert_not_awaited()
    repo.get_user_recipes.assert_awaited_once_with("u1", limit=5)
    message = result["assistant_message"]
    assert "couldn't find" not in message.lower()
    assert "Butter Chicken" in message
    assert "Victoria Sponge" in message
    assert [m["id"] for m in result["saved_recipe_matches"]] == ["r1", "r2"]


@pytest.mark.asyncio
async def test_browse_with_empty_library_says_nothing_saved_yet() -> None:
    patcher, _repo = _patch_repo([], recent=[])
    with patcher:
        result = await saved_recipe_lookup_response(
            _state(input_text="show me my saved recipes", user_id="u1")
        )

    message = result["assistant_message"].lower()
    assert "haven't saved any recipes" in message
    assert "generate a new one instead" not in message
    assert result["saved_recipe_matches"] == []


@pytest.mark.asyncio
async def test_lookup_failure_is_not_reported_as_no_match() -> None:
    """Review finding on PR #536: an infra failure used to fall through to the
    zero-match reply and offer to generate a duplicate of a saved recipe."""
    repo = MagicMock()
    repo.search_saved_recipes = AsyncMock(side_effect=RuntimeError("supabase down"))
    with patch(
        "bubbly_chef.workflows.chat.nodes.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    ):
        result = await saved_recipe_lookup_response(
            _state(input_text="show me my saved butter chicken", user_id="u1")
        )

    message = result["assistant_message"].lower()
    assert "couldn't find" not in message
    assert "generate" not in message
    assert "try again" in message
    assert result["saved_recipe_matches"] == []
    assert any("supabase down" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_matches_carry_only_the_contract_fields() -> None:
    """Review finding on PR #536: whole DB rows (user_id, ingredients,
    instructions, timestamps) went into chat metadata. Issue #493 specifies
    [{id, title, description?, cuisine?}]."""
    row = {
        "id": "r1",
        "user_id": "u1",
        "title": "Butter Chicken",
        "description": "Creamy and mild",
        "cuisine": "Indian",
        "ingredients": [{"name": "chicken"}],
        "instructions": ["cook it"],
        "created_at": "2026-09-01T00:00:00Z",
    }
    patcher, _repo = _patch_repo([row])
    with patcher:
        result = await saved_recipe_lookup_response(
            _state(input_text="show me my saved butter chicken", user_id="u1")
        )

    assert result["saved_recipe_matches"] == [
        {
            "id": "r1",
            "title": "Butter Chicken",
            "description": "Creamy and mild",
            "cuisine": "Indian",
        }
    ]


@pytest.mark.asyncio
async def test_handler_sets_completed_status_and_no_review() -> None:
    patcher, _repo = _patch_repo([])
    with patcher:
        result = await saved_recipe_lookup_response(_state(input_text="x", user_id="u1"))

    assert result["intent"] == Intent.SAVED_RECIPE_LOOKUP.value
    assert result["confidence"] == 1.0
    assert result["requires_review"] is False


# ---------------------------------------------------------------------------
# Session pin — only on an unambiguous single match
# ---------------------------------------------------------------------------


def _session_repo() -> MagicMock:
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(
        return_value=ConversationSession(conversation_id="conv-1", active_mode=SessionMode.DEFAULT)
    )
    repo.update_session = AsyncMock(return_value=None)
    return repo


def _patch_router_repo(repo: MagicMock) -> Any:
    return patch(
        "bubbly_chef.workflows.router.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    )


@pytest.mark.asyncio
async def test_single_match_pins_recipe_id_and_title() -> None:
    repo = _session_repo()
    state = _state(
        input_text="show me my saved butter chicken",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.SAVED_RECIPE_LOOKUP.value,
        saved_recipe_matches=[{"id": "db-recipe-1", "title": "Butter Chicken"}],
    )

    with _patch_router_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.pinned_recipe_id == "db-recipe-1"
    assert saved.metadata.last_recipe_title == "Butter Chicken"


@pytest.mark.asyncio
async def test_zero_matches_leaves_session_unpinned() -> None:
    repo = _session_repo()
    state = _state(
        input_text="show me my saved poutine",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.SAVED_RECIPE_LOOKUP.value,
        saved_recipe_matches=[],
    )

    with _patch_router_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.pinned_recipe_id is None


@pytest.mark.asyncio
async def test_many_matches_leaves_session_unpinned() -> None:
    repo = _session_repo()
    state = _state(
        input_text="show me my saved chicken",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.SAVED_RECIPE_LOOKUP.value,
        saved_recipe_matches=[
            {"id": "r1", "title": "Butter Chicken"},
            {"id": "r2", "title": "Chicken Tikka Masala"},
        ],
    )

    with _patch_router_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.pinned_recipe_id is None


# ---------------------------------------------------------------------------
# Envelope metadata contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_chat_workflow_surfaces_saved_recipe_matches_metadata() -> None:
    from bubbly_chef.workflows import router as router_module

    matches = [{"id": "r1", "title": "Butter Chicken"}]

    async def fake_ainvoke(_initial_state: dict[str, Any]) -> dict[str, Any]:
        return {
            "intent": Intent.SAVED_RECIPE_LOOKUP.value,
            "assistant_message": "Found it — your saved Butter Chicken!",
            "saved_recipe_matches": matches,
            "request_id": "11111111-1111-1111-1111-111111111111",
            "workflow_id": "22222222-2222-2222-2222-222222222222",
            "conversation_id": None,
        }

    fake_graph = MagicMock()
    fake_graph.ainvoke = AsyncMock(side_effect=fake_ainvoke)

    with patch.object(router_module, "get_chat_router_graph", return_value=fake_graph):
        envelope = await router_module.run_chat_workflow(message="show me my saved butter chicken")

    assert envelope.metadata["saved_recipe_matches"] == matches
