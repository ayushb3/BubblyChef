"""Tests for classify_intent in router.py.

Tests verify routing behavior through the classify_intent public interface.
AI manager is mocked via patch so tests don't require a live provider.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.workflows.chat.nodes import (
    _flatten_ingredient,
    format_cooking_recipe_context,
    normalize_cooking_recipe,
)
from bubbly_chef.workflows.router import classify_intent, update_session_node
from bubbly_chef.workflows.state import LLMIntentResult


def _state(**kwargs):
    """Minimal WorkflowState for classify_intent tests."""
    base = {
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


def _llm_result(intent: str, confidence: float = 0.9) -> LLMIntentResult:
    return LLMIntentResult(intent=intent, confidence=confidence, reasoning="test", entities=[])


def _mock_ai(intent: str, confidence: float = 0.9):
    """Return a context manager patch that makes get_ai_manager return a mock completing with given intent."""
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_llm_result(intent, confidence))
    manager = MagicMock(return_value=ai)
    return patch("bubbly_chef.workflows.router.get_ai_manager", manager)


# ---------------------------------------------------------------------------
# Shortcuts (no LLM)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_input_returns_general_chat():
    result = await classify_intent(_state(input_text=""))
    assert result["intent"] == Intent.GENERAL_CHAT.value


@pytest.mark.asyncio
async def test_whitespace_only_returns_general_chat():
    result = await classify_intent(_state(input_text="   \n  "))
    assert result["intent"] == Intent.GENERAL_CHAT.value


@pytest.mark.asyncio
async def test_https_url_routes_to_recipe_ingest_without_llm():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="https://example.com/pasta"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_INGEST.value


@pytest.mark.asyncio
async def test_http_url_routes_to_recipe_ingest_without_llm():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="http://recipes.com/soup"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_INGEST.value


@pytest.mark.asyncio
async def test_dotcom_url_routes_to_recipe_ingest_without_llm():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="save recipe from allrecipes.com/pasta"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_INGEST.value


# ---------------------------------------------------------------------------
# Session mode override (unchanged behavior)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_cooking_mode_routes_to_cooking_help():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(
            _state(input_text="how long should I boil eggs?",
                   session_mode=SessionMode.COOKING.value)
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_session_ingesting_mode_routes_to_pantry_update():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(
            _state(input_text="milk, eggs, butter",
                   session_mode=SessionMode.INGESTING.value)
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.PANTRY_UPDATE.value


@pytest.mark.asyncio
async def test_exit_phrase_breaks_out_of_session_mode():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(
            _state(input_text="exit", session_mode=SessionMode.COOKING.value)
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert result.get("_exit_mode") is True


# ---------------------------------------------------------------------------
# LLM path — intents that previously had keyword blocks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_receipt_intent_routes_to_receipt_ingest():
    with _mock_ai("receipt_ingest_request"):
        result = await classify_intent(_state(input_text="I just scanned a receipt"))
    assert result["intent"] == Intent.RECEIPT_INGEST.value


@pytest.mark.asyncio
async def test_llm_product_intent_routes_to_product_ingest():
    with _mock_ai("product_ingest_request"):
        result = await classify_intent(_state(input_text="scan this barcode for me"))
    assert result["intent"] == Intent.PRODUCT_INGEST.value


@pytest.mark.asyncio
async def test_llm_pantry_update_intent():
    with _mock_ai("pantry_update"):
        result = await classify_intent(_state(input_text="I bought some eggs today"))
    assert result["intent"] == Intent.PANTRY_UPDATE.value


@pytest.mark.asyncio
async def test_llm_recipe_generation_intent():
    with _mock_ai("recipe_generation"):
        result = await classify_intent(_state(input_text="give me a dinner idea"))
    assert result["intent"] == Intent.RECIPE_GENERATION.value


@pytest.mark.asyncio
async def test_llm_cooking_help_intent():
    with _mock_ai("cooking_help"):
        result = await classify_intent(_state(input_text="how do I caramelize onions?"))
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_llm_recipe_brainstorm_intent():
    with _mock_ai("recipe_brainstorm"):
        result = await classify_intent(_state(input_text="what can I make tonight?"))
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value


@pytest.mark.asyncio
async def test_llm_recipe_card_intent():
    with _mock_ai("recipe_card"):
        result = await classify_intent(_state(input_text="make me that pasta"))
    assert result["intent"] == Intent.RECIPE_CARD.value


@pytest.mark.asyncio
async def test_unknown_llm_intent_falls_back_to_general_chat():
    with _mock_ai("totally_unknown_intent"):
        result = await classify_intent(_state(input_text="something weird"))
    assert result["intent"] == Intent.GENERAL_CHAT.value


@pytest.mark.asyncio
async def test_llm_confidence_stored_on_state():
    with _mock_ai("cooking_help", confidence=0.75):
        result = await classify_intent(_state(input_text="what temperature for chicken?"))
    assert result["intent_confidence"] == pytest.approx(0.75)


# ---------------------------------------------------------------------------
# LLM is NOT called for URL / empty shortcuts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_not_called_for_empty_input():
    with _mock_ai("pantry_update") as mock_mgr:
        await classify_intent(_state(input_text=""))
    mock_mgr.return_value.complete.assert_not_called()


# ---------------------------------------------------------------------------
# Cook handoff — session pinning via request context (issue #122)
# ---------------------------------------------------------------------------


def _cooking_context(recipe_id: str = "recipe-42") -> dict:
    return {
        "cooking_recipe": {
            "id": recipe_id,
            "title": "Lemon Garlic Pasta",
            "ingredients": ["spaghetti", "lemon", "garlic"],
        }
    }


def _session_repo(mode: SessionMode = SessionMode.DEFAULT) -> MagicMock:
    """Mock repository whose session starts in `mode`.

    `get_recipe` returns a fake DB row (object-shaped ingredients, as stored in
    the `recipes` JSONB column) so the id-only cook-handoff path can resolve
    server-side. Legacy full-dict tests never call it.
    """
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(
        return_value=ConversationSession(conversation_id="conv-1", active_mode=mode)
    )
    repo.update_session = AsyncMock(return_value=None)
    repo.get_recipe = AsyncMock(return_value=_fake_recipe_row())
    return repo


def _fake_recipe_row(recipe_id: str = "recipe-42") -> dict:
    """A raw `recipes` row as `get_recipe` returns it (ingredients are objects)."""
    return {
        "id": recipe_id,
        "title": "Lemon Garlic Pasta",
        "ingredients": [
            {"name": "spaghetti", "quantity": 200, "unit": "g"},
            {"name": "lemon", "quantity": 1, "unit": None},
            {"name": "garlic", "quantity": 3, "unit": "cloves"},
        ],
    }


def _patch_repo(repo: MagicMock):
    return patch(
        "bubbly_chef.workflows.router.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    )


@pytest.mark.asyncio
async def test_cooking_context_sets_cooking_mode_and_pins_recipe():
    repo = _session_repo()
    state = _state(
        input_text="how do I julienne the carrots?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context=_cooking_context(),
    )

    with _patch_repo(repo):
        await update_session_node(state)

    repo.update_session.assert_awaited_once()
    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.COOKING
    assert saved.pinned_recipe_id == "recipe-42"
    assert saved.metadata["cooking_recipe"]["title"] == "Lemon Garlic Pasta"
    assert saved.metadata["cooking_recipe"]["ingredients"] == [
        "spaghetti",
        "lemon",
        "garlic",
    ]


@pytest.mark.asyncio
async def test_cooking_context_repins_when_user_cooks_another_recipe():
    """A second cook handoff replaces the pinned recipe rather than keeping the first."""
    repo = _session_repo(SessionMode.COOKING)
    repo.get_or_create_session = AsyncMock(
        return_value=ConversationSession(
            conversation_id="conv-1",
            active_mode=SessionMode.COOKING,
            pinned_recipe_id="recipe-1",
            metadata={"cooking_recipe": {"id": "recipe-1", "title": "Old Dish"}},
        )
    )
    state = _state(
        input_text="how hot should the pan be?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context=_cooking_context("recipe-99"),
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.pinned_recipe_id == "recipe-99"
    assert saved.metadata["cooking_recipe"]["title"] == "Lemon Garlic Pasta"


@pytest.mark.asyncio
async def test_exit_phrase_clears_cooking_mode_even_with_context():
    """Exit handling wins over a resent cook context — mode resets to default."""
    repo = _session_repo(SessionMode.COOKING)
    state = _state(
        input_text="stop",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.GENERAL_CHAT.value,
        context=_cooking_context(),
        _exit_mode=True,
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.DEFAULT
    assert saved.pinned_recipe_id is None
    assert saved.metadata == {}


@pytest.mark.asyncio
async def test_no_context_leaves_session_mode_alone():
    """Plain cooking_help turns without context don't force COOKING mode."""
    repo = _session_repo()
    state = _state(
        input_text="how long do I boil eggs?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.DEFAULT
    assert saved.pinned_recipe_id is None


# ---------------------------------------------------------------------------
# Cook handoff — server-side recipe resolution from id (issue #155)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cooking_recipe_id_resolves_server_side_and_pins():
    """The id-only payload resolves the recipe via the repo and pins it.

    No title/ingredients are sent by the client — proving the pin no longer
    depends on a client-side fetch winning a race (#155).
    """
    repo = _session_repo()
    state = _state(
        input_text="what temperature for the pasta water?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context={"cooking_recipe_id": "recipe-42"},
    )

    with _patch_repo(repo):
        await update_session_node(state)

    repo.get_recipe.assert_awaited_once_with("user-1", "recipe-42")
    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.COOKING
    assert saved.pinned_recipe_id == "recipe-42"
    assert saved.metadata["cooking_recipe"]["title"] == "Lemon Garlic Pasta"
    # DB rows store ingredient objects; they must arrive flattened to strings.
    assert saved.metadata["cooking_recipe"]["ingredients"] == [
        "200 g spaghetti",
        "1 lemon",
        "3 cloves garlic",
    ]


@pytest.mark.asyncio
async def test_thin_cooking_recipe_dict_resolves_server_side():
    """A `cooking_recipe` dict carrying only an id is resolved like the id-only form."""
    repo = _session_repo()
    state = _state(
        input_text="how long do I cook it?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context={"cooking_recipe": {"id": "recipe-42"}},
    )

    with _patch_repo(repo):
        await update_session_node(state)

    repo.get_recipe.assert_awaited_once_with("user-1", "recipe-42")
    saved = repo.update_session.await_args.args[1]
    assert saved.pinned_recipe_id == "recipe-42"
    assert saved.metadata["cooking_recipe"]["title"] == "Lemon Garlic Pasta"


@pytest.mark.asyncio
async def test_cooking_recipe_id_missing_recipe_leaves_session_unpinned():
    """A deleted/unauthorised recipe id resolves to None — no pin, no crash."""
    repo = _session_repo()
    repo.get_recipe = AsyncMock(return_value=None)
    state = _state(
        input_text="what temp?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context={"cooking_recipe_id": "recipe-gone"},
    )

    with _patch_repo(repo):
        await update_session_node(state)

    repo.get_recipe.assert_awaited_once_with("user-1", "recipe-gone")
    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.DEFAULT
    assert saved.pinned_recipe_id is None


@pytest.mark.asyncio
async def test_legacy_full_dict_does_not_call_get_recipe():
    """The legacy full `cooking_recipe` dict is used as-is — no server resolve."""
    repo = _session_repo()
    state = _state(
        input_text="how do I julienne the carrots?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context=_cooking_context(),
    )

    with _patch_repo(repo):
        await update_session_node(state)

    repo.get_recipe.assert_not_awaited()
    saved = repo.update_session.await_args.args[1]
    assert saved.pinned_recipe_id == "recipe-42"
    assert saved.metadata["cooking_recipe"]["ingredients"] == [
        "spaghetti",
        "lemon",
        "garlic",
    ]


# ---------------------------------------------------------------------------
# Ingredient flattening (str passthrough + object flatten)
# ---------------------------------------------------------------------------


def test_flatten_ingredient_passes_strings_through():
    assert _flatten_ingredient("2 cups flour") == "2 cups flour"
    assert _flatten_ingredient("  salt  ") == "salt"


def test_flatten_ingredient_joins_object_parts():
    assert (
        _flatten_ingredient({"name": "spaghetti", "quantity": 200, "unit": "g"})
        == "200 g spaghetti"
    )
    # Missing/None parts are skipped, not rendered as "None".
    assert _flatten_ingredient({"name": "lemon", "quantity": 1, "unit": None}) == "1 lemon"
    assert _flatten_ingredient({"name": "salt"}) == "salt"


def test_normalize_cooking_recipe_handles_object_ingredients():
    normalized = normalize_cooking_recipe(
        {
            "id": "r1",
            "title": "Test",
            "ingredients": [{"name": "egg", "quantity": 2, "unit": None}, "salt"],
        }
    )
    assert normalized["ingredients"] == ["2 egg", "salt"]


# ---------------------------------------------------------------------------
# Cook handoff — prompt injection
# ---------------------------------------------------------------------------


def test_cooking_recipe_context_reads_request_context():
    block = format_cooking_recipe_context(_state(context=_cooking_context()))
    assert "Lemon Garlic Pasta" in block
    assert "spaghetti" in block


def test_cooking_recipe_context_falls_back_to_session_metadata():
    """Later turns get the recipe from the session, since the client sends it once."""
    block = format_cooking_recipe_context(
        _state(session={"metadata": _cooking_context()})
    )
    assert "Lemon Garlic Pasta" in block


def test_cooking_recipe_context_empty_without_recipe():
    assert format_cooking_recipe_context(_state()) == ""
    assert format_cooking_recipe_context(_state(context={"other": 1})) == ""


# ---------------------------------------------------------------------------
# build_handoff_recipe — URL present → proposal; no URL → handoff prompt (#214)
# ---------------------------------------------------------------------------


def _mock_ingestor(recipe_card):
    from unittest.mock import AsyncMock, patch
    return patch(
        "bubbly_chef.workflows.router.ingest_recipe_from_url",
        new=AsyncMock(return_value=recipe_card),
    )


def _make_recipe_card(title: str = "Crispy Fried Chicken"):
    from bubbly_chef.models.recipe import RecipeCard
    return RecipeCard(title=title)


@pytest.mark.asyncio
async def test_build_handoff_recipe_with_url_returns_proposal():
    """A message containing a URL skips the handoff and returns a RecipeCardProposal."""
    from bubbly_chef.models.recipe import RecipeCardProposal
    from bubbly_chef.workflows.router import build_handoff_recipe

    card = _make_recipe_card("Crispy Fried Chicken")
    state = _state(
        input_text="can you help make this? https://www.allrecipes.com/recipe/8805/crispy-fried-chicken/",
        intent="recipe_ingest",
    )

    with _mock_ingestor(card):
        result = await build_handoff_recipe(state)

    from bubbly_chef.models.recipe import RecipeCardProposal
    assert isinstance(result["proposal"], RecipeCardProposal)
    assert result["proposal"].recipe.title == "Crispy Fried Chicken"
    assert result["proposal"].source_url == "https://www.allrecipes.com/recipe/8805/crispy-fried-chicken/"
    assert result.get("workflow_status") != "awaiting_input"


@pytest.mark.asyncio
async def test_build_handoff_recipe_without_url_returns_handoff():
    """A message with no URL still returns the handoff prompt asking for a URL."""
    from bubbly_chef.workflows.router import build_handoff_recipe

    state = _state(input_text="can you help me save a recipe?", intent="recipe_ingest")
    result = await build_handoff_recipe(state)

    assert result.get("proposal") is None
    assert result.get("workflow_status") == "awaiting_input"
    msg = result.get("assistant_message", "")
    assert "recipe" in msg.lower()


@pytest.mark.asyncio
async def test_build_handoff_recipe_url_extraction_failure_returns_error_handoff():
    """If the ingestor raises, the node returns an error handoff — no crash, no loop."""
    from unittest.mock import AsyncMock, patch
    from bubbly_chef.workflows.router import build_handoff_recipe

    state = _state(
        input_text="save https://broken.example.com/recipe",
        intent="recipe_ingest",
        errors=[],
    )

    with patch(
        "bubbly_chef.workflows.router.ingest_recipe_from_url",
        new=AsyncMock(side_effect=RuntimeError("fetch failed")),
    ):
        result = await build_handoff_recipe(state)

    assert result.get("proposal") is None
    assert result.get("workflow_status") == "awaiting_input"
    assert any("URL extraction failed" in e for e in result.get("errors", []))



# ---------------------------------------------------------------------------
# Cook-flow redesign (issue #242) — brainstorm trapdoor fix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cooking_mode_with_brainstorm_ideas_stays_cooking():
    """A COOKING session that produces brainstorm_ideas must NOT flip to RECIPE_EXPLORING.

    This is the regression test for the trapdoor: brainstorm_ideas appearing in
    state while the session is COOKING meant a brainstorm-flavoured cooking question
    (e.g. "what else could I add to this?") would silently unpin the recipe.
    """
    repo = _session_repo(mode=SessionMode.COOKING)
    # Simulate the session already pinned to a recipe.
    session = await repo.get_or_create_session("", "")
    session.pinned_recipe_id = "recipe-42"
    repo.get_or_create_session = AsyncMock(return_value=session)

    state = _state(
        input_text="what else could I add to this?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        session_mode=SessionMode.COOKING.value,
        brainstorm_ideas=["idea-a", "idea-b"],
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.COOKING, (
        f"Expected COOKING but got {saved.active_mode}"
    )
    assert saved.pinned_recipe_id == "recipe-42", "pinned_recipe_id must survive"


@pytest.mark.asyncio
async def test_non_cooking_mode_with_brainstorm_ideas_transitions_to_exploring():
    """Outside COOKING, the brainstorm fallback still triggers as before."""
    repo = _session_repo(mode=SessionMode.DEFAULT)

    state = _state(
        input_text="what can I cook tonight?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        session_mode=SessionMode.DEFAULT.value,
        brainstorm_ideas=["pasta", "stir-fry"],
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.RECIPE_EXPLORING


@pytest.mark.asyncio
async def test_exit_phrase_still_exits_cooking_mode():
    """The explicit exit phrase must still break COOKING mode — not blocked by the fix."""
    with _mock_ai("general_chat"):
        result = await classify_intent(
            _state(
                input_text="exit",
                session_mode=SessionMode.COOKING.value,
            )
        )
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert result.get("_exit_mode") is True
