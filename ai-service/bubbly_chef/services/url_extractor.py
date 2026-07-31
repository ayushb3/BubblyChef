"""URL extractor for the unified /ingest dispatcher.

Adapts ``recipe_url_ingestor.ingest_recipe_from_url`` to the dispatcher's
``ExtractorFn`` interface.

Design note — recipe proposals, not pantry proposals
------------------------------------------------------
URL ingest produces a ``RecipeCard``.  That is fundamentally different from
receipt/barcode ingest, which produce pantry *actions* and flow through the
``build_actions_from_normalized`` → ``PantryProposal`` spine.  Forcing a recipe
through the pantry spine would be wrong (a RecipeCard is not a list of pantry
actions).  Instead, the extractor wraps the card in ``RecipeCardProposal`` and
returns a ``ProposalEnvelope[RecipeCardProposal]`` via ``create_recipe_envelope``.

This is exactly the divergence called out in the ticket: recipe ingest
legitimately splits from the pantry tail at this point.

Registration
------------
This module registers the extractor into the global ``dispatcher`` singleton at
import time (mirroring how ``ingest_dispatcher.py`` registers the receipt
extractor).  ``main.py`` imports this module at startup to trigger registration.
"""

from __future__ import annotations

import logging

from bubbly_chef.api.ingest_dispatcher import IngestPayload, dispatcher
from bubbly_chef.models.recipe import RecipeCardProposal
from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.workflows.state import create_recipe_envelope

logger = logging.getLogger(__name__)


async def url_extractor(payload: IngestPayload) -> ProposalEnvelope[RecipeCardProposal]:
    """Extract a recipe from a URL and return a recipe-proposal envelope.

    Pulls the URL from ``payload.url`` (preferred) or ``payload.text`` as a
    fallback (the dispatcher populates ``text`` when the input arrives via the
    ``/ingest`` text field and the modality was auto-detected as URL).

    Args:
        payload: Dispatcher-normalised ingest payload with ``modality=URL``.

    Returns:
        ``ProposalEnvelope[RecipeCardProposal]`` ready to be serialised and
        returned to the caller.

    Raises:
        ValueError: No URL could be found in the payload.
        RuntimeError: Extraction failed at all tiers (scraper + AI fallback).
    """
    from bubbly_chef.services.recipe_url_ingestor import ingest_recipe_from_url

    url = payload.url or payload.text
    if not url:
        raise ValueError("URL extractor requires a URL in payload.url or payload.text")

    url = url.strip()
    logger.info("URL extractor: extracting recipe from %s", url)

    recipe = await ingest_recipe_from_url(url)

    proposal = RecipeCardProposal(
        recipe=recipe,
        source_url=url,
    )

    envelope = create_recipe_envelope(
        proposal=proposal,
        confidence=0.9,
        field_confidences={},
        warnings=[],
        errors=[],
        assistant_message=f"I've extracted the recipe: {recipe.title}. Please review.",
    )

    logger.info("URL extractor: recipe extracted: title=%r", recipe.title)
    return envelope


# ---------------------------------------------------------------------------
# Register into the global dispatcher singleton at module-load time.
# main.py imports this module during startup so the registration always runs
# before any request is served.
# ---------------------------------------------------------------------------

dispatcher.register_url_extractor(url_extractor)
