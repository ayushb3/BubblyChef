"""Tests for the URL extractor and its integration with the dispatcher.

Behaviors covered:
1. detect_modality: URL string → IngestModality.URL  (dispatcher unit test)
2. url_extractor: calls ingest_recipe_from_url and returns RecipeCardProposal envelope
3. url_extractor: uses payload.url when set
4. url_extractor: falls back to payload.text when payload.url is None
5. url_extractor: raises ValueError when neither url nor text is set
6. url_extractor: propagates RuntimeError from ingest_recipe_from_url
7. dispatcher singleton: URL modality is routed to url_extractor after module import
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Behavior 1: detect_modality still identifies URL strings correctly
# ---------------------------------------------------------------------------


def test_detect_modality_url():
    """detect_modality returns URL for http/https strings (regression guard)."""
    from bubbly_chef.api.ingest_dispatcher import IngestModality, ModalityDispatcher

    assert (
        ModalityDispatcher.detect_modality(text="https://www.allrecipes.com/recipe/123/pasta/")
        is IngestModality.URL
    )
    assert (
        ModalityDispatcher.detect_modality(text="http://myblog.example.com/soup")
        is IngestModality.URL
    )


# ---------------------------------------------------------------------------
# Behaviors 2–6: url_extractor unit tests (no HTTP, mock ingest_recipe_from_url)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_url_extractor_returns_recipe_card_proposal_envelope():
    """url_extractor wraps RecipeCard in RecipeCardProposal and envelope."""
    from bubbly_chef.models.recipe import Ingredient, RecipeCard
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    fake_recipe = RecipeCard(
        title="Pasta Carbonara",
        ingredients=[Ingredient(name="spaghetti"), Ingredient(name="pancetta")],
        instructions=["Boil pasta", "Mix with sauce"],
        source_type="url",
        source_url="https://example.com/pasta",
    )

    with patch(
        "bubbly_chef.services.url_extractor.ingest_recipe_from_url",
        new_callable=AsyncMock,
        return_value=fake_recipe,
    ):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://example.com/pasta",
        )
        envelope = await url_extractor(payload)

    # Envelope shape
    assert envelope.intent.value == "recipe_card"
    assert envelope.proposal is not None
    assert envelope.proposal.recipe.title == "Pasta Carbonara"
    assert envelope.proposal.source_url == "https://example.com/pasta"
    assert len(envelope.proposal.recipe.ingredients) == 2


@pytest.mark.asyncio
async def test_url_extractor_uses_payload_url():
    """url_extractor reads the URL from payload.url when set."""
    from bubbly_chef.models.recipe import RecipeCard
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    fake_recipe = RecipeCard(
        title="Tiramisu",
        source_type="url",
        source_url="https://example.com/tiramisu",
    )

    mock_ingest = AsyncMock(return_value=fake_recipe)
    with patch("bubbly_chef.services.url_extractor.ingest_recipe_from_url", mock_ingest):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://example.com/tiramisu",
        )
        await url_extractor(payload)

    mock_ingest.assert_awaited_once_with("https://example.com/tiramisu")


@pytest.mark.asyncio
async def test_url_extractor_falls_back_to_payload_text():
    """url_extractor uses payload.text when payload.url is None."""
    from bubbly_chef.models.recipe import RecipeCard
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    fake_recipe = RecipeCard(
        title="Risotto",
        source_type="url",
        source_url="https://example.com/risotto",
    )

    mock_ingest = AsyncMock(return_value=fake_recipe)
    with patch("bubbly_chef.services.url_extractor.ingest_recipe_from_url", mock_ingest):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url=None,
            text="https://example.com/risotto",
        )
        await url_extractor(payload)

    mock_ingest.assert_awaited_once_with("https://example.com/risotto")


@pytest.mark.asyncio
async def test_url_extractor_raises_value_error_when_no_url():
    """url_extractor raises ValueError when neither url nor text is provided."""
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    payload = IngestPayload(modality=IngestModality.URL, url=None, text=None)

    with pytest.raises(ValueError, match="requires a URL"):
        await url_extractor(payload)


@pytest.mark.asyncio
async def test_url_extractor_propagates_runtime_error():
    """url_extractor lets RuntimeError from ingest_recipe_from_url bubble up."""
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    with patch(
        "bubbly_chef.services.url_extractor.ingest_recipe_from_url",
        new_callable=AsyncMock,
        side_effect=RuntimeError("All extraction tiers failed"),
    ):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://broken.example.com/recipe",
        )
        with pytest.raises(RuntimeError, match="All extraction tiers failed"):
            await url_extractor(payload)


# ---------------------------------------------------------------------------
# Behavior 7: dispatcher singleton routes URL to url_extractor after import
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_global_dispatcher_routes_url_to_extractor():
    """After importing url_extractor, the global dispatcher handles URL payloads."""
    import bubbly_chef.services.url_extractor  # noqa: F401  — triggers registration

    from bubbly_chef.api.ingest_dispatcher import (
        IngestModality,
        IngestPayload,
        dispatcher,
    )
    from bubbly_chef.models.recipe import RecipeCard

    fake_recipe = RecipeCard(
        title="Global Dispatch Test",
        source_type="url",
        source_url="https://example.com/global",
    )

    with patch(
        "bubbly_chef.services.url_extractor.ingest_recipe_from_url",
        new_callable=AsyncMock,
        return_value=fake_recipe,
    ):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://example.com/global",
        )
        envelope = await dispatcher.dispatch(payload)

    assert envelope.proposal.recipe.title == "Global Dispatch Test"  # type: ignore[union-attr]
