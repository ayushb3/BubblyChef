"""Server-side modality dispatcher for the unified /ingest endpoint.

Decision B (spec): detection is server-side.  The dispatcher owns the
"what kind of input is this?" logic so there's a single source of truth and
no client/server split-brain.

Architecture
------------
``ModalityDispatcher`` holds a registry of ``ExtractorEntry`` objects.
Each entry:

- declares which ``IngestModality`` it handles
- provides an async ``extract`` callable
  ``(payload: IngestPayload) -> ProposalEnvelope[PantryProposal]``

Modalities implemented in this ticket
--------------------------------------
- ``IngestModality.RECEIPT`` — OCR text (or raw image bytes handed off to
  ``run_receipt_ingest``).  Receipt scanning migrated through this rail.

Extension seam for #205 (URL) and #206 (barcode/product)
----------------------------------------------------------
Register a new extractor with:

    from bubbly_chef.api.ingest_dispatcher import dispatcher, ExtractorEntry, IngestModality

    dispatcher.register(ExtractorEntry(
        modality=IngestModality.URL,
        extract=my_url_extractor,
    ))

Or call ``dispatcher.register_url_extractor(fn)`` / ``register_barcode_extractor(fn)``
for the convenience helpers.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Awaitable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.pantry import PantryProposal

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Modality enum
# ---------------------------------------------------------------------------


class IngestModality(StrEnum):
    """Supported ingest modalities."""

    RECEIPT = "receipt"
    URL = "url"  # #205 — recipe URL extractor
    BARCODE = "barcode"  # #206 — product/barcode extractor
    TEXT = "text"  # future: plain-text pantry update
    UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# Payload type — the normalized input handed to every extractor
# ---------------------------------------------------------------------------


@dataclass
class IngestPayload:
    """Normalized input passed to an extractor.

    Attributes:
        modality: Detected modality.
        ocr_text: OCR-extracted receipt text (modality=RECEIPT, text path).
        image_bytes: Raw image bytes (modality=RECEIPT, image path).
            Extractors are responsible for OCR if they receive raw bytes.
        url: Recipe/resource URL (modality=URL).
        barcode: EAN/UPC barcode string (modality=BARCODE).
        text: Arbitrary plain text (modality=TEXT).
        raw: Original untyped payload for extensibility.
    """

    modality: IngestModality
    ocr_text: str | None = None
    image_bytes: bytes | None = None
    url: str | None = None
    barcode: str | None = None
    text: str | None = None
    raw: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Extractor entry
# ---------------------------------------------------------------------------

ExtractorFn = Callable[[IngestPayload], Awaitable[ProposalEnvelope[PantryProposal]]]


@dataclass
class ExtractorEntry:
    """An extractor registered for a given modality.

    Args:
        modality: The modality this extractor handles.
        extract: Async callable that accepts an ``IngestPayload`` and returns
            a ``ProposalEnvelope[PantryProposal]``.
    """

    modality: IngestModality
    extract: ExtractorFn


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

# URL pattern — matches http/https with a hostname
_URL_RE = re.compile(r"^https?://[^\s/$.?#].[^\s]*$", re.IGNORECASE)

# Barcode pattern — 8–14 digit strings (EAN-8, UPC-A, EAN-13, EAN-14)
_BARCODE_RE = re.compile(r"^\d{8,14}$")


@dataclass
class ModalityDispatcher:
    """Registry of modality extractors + modality detection.

    Usage::

        from bubbly_chef.api.ingest_dispatcher import dispatcher, IngestPayload

        payload = IngestPayload(modality=IngestModality.RECEIPT, ocr_text=text)
        envelope = await dispatcher.dispatch(payload)

    Extending (e.g. #205 URL extractor)::

        dispatcher.register(ExtractorEntry(
            modality=IngestModality.URL,
            extract=my_url_extractor,
        ))
    """

    _registry: dict[IngestModality, ExtractorEntry] = field(default_factory=dict)

    def register(self, entry: ExtractorEntry) -> None:
        """Register an extractor for a modality (idempotent — last wins)."""
        self._registry[entry.modality] = entry
        logger.info("Registered extractor for modality: %s", entry.modality)

    # ------------------------------------------------------------------
    # Convenience helpers for #205 / #206 to plug in their extractors
    # ------------------------------------------------------------------

    def register_url_extractor(self, fn: ExtractorFn) -> None:
        """Convenience: register a URL extractor (#205)."""
        self.register(ExtractorEntry(modality=IngestModality.URL, extract=fn))

    def register_barcode_extractor(self, fn: ExtractorFn) -> None:
        """Convenience: register a barcode/product extractor (#206)."""
        self.register(ExtractorEntry(modality=IngestModality.BARCODE, extract=fn))

    # ------------------------------------------------------------------
    # Modality detection
    # ------------------------------------------------------------------

    @staticmethod
    def detect_modality(
        *,
        image_bytes: bytes | None = None,
        text: str | None = None,
    ) -> IngestModality:
        """Detect modality from raw inputs (server-side, Decision B).

        Priority:
        1. Image bytes → RECEIPT (only image ingest path in v1)
        2. Text that looks like a URL → URL
        3. Text that looks like a barcode number → BARCODE
        4. Non-empty text → RECEIPT (OCR text path)
        5. Else → UNKNOWN
        """
        if image_bytes:
            return IngestModality.RECEIPT

        if text:
            stripped = text.strip()
            if _URL_RE.match(stripped):
                return IngestModality.URL
            if _BARCODE_RE.match(stripped):
                return IngestModality.BARCODE
            # Non-empty, non-URL, non-barcode text → treat as receipt OCR
            return IngestModality.RECEIPT

        return IngestModality.UNKNOWN

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    async def dispatch(self, payload: IngestPayload) -> ProposalEnvelope[PantryProposal]:
        """Detect modality (if not already set) and call the registered extractor.

        Args:
            payload: Pre-built ``IngestPayload``.  If ``payload.modality`` is
                ``UNKNOWN``, detection runs automatically from
                ``image_bytes`` / ``ocr_text`` / ``url`` / ``barcode`` / ``text``.

        Returns:
            ``ProposalEnvelope[PantryProposal]`` from the extractor.

        Raises:
            NotImplementedError: No extractor registered for the detected modality.
            ValueError: Modality could not be detected (no usable input).
        """
        modality = payload.modality

        # Auto-detect if caller left modality as UNKNOWN
        if modality is IngestModality.UNKNOWN:
            modality = self.detect_modality(
                image_bytes=payload.image_bytes,
                text=payload.ocr_text or payload.url or payload.barcode or payload.text,
            )
            payload = IngestPayload(
                modality=modality,
                ocr_text=payload.ocr_text,
                image_bytes=payload.image_bytes,
                url=payload.url,
                barcode=payload.barcode,
                text=payload.text,
                raw=payload.raw,
            )

        if modality is IngestModality.UNKNOWN:
            raise ValueError("Could not detect ingest modality — no usable input provided")

        entry = self._registry.get(modality)
        if entry is None:
            # TODO stubs for future extractors
            if modality is IngestModality.URL:
                raise NotImplementedError("URL extractor not yet registered — see ticket #205")
            if modality is IngestModality.BARCODE:
                raise NotImplementedError(
                    "Barcode/product extractor not yet registered — see ticket #206"
                )
            raise NotImplementedError(f"No extractor registered for modality: {modality!r}")

        logger.info("Dispatching to %s extractor", modality)
        return await entry.extract(payload)


# ---------------------------------------------------------------------------
# Singleton dispatcher — import and use this everywhere
# ---------------------------------------------------------------------------

dispatcher = ModalityDispatcher()


# ---------------------------------------------------------------------------
# Built-in receipt extractor (v1, this ticket)
# ---------------------------------------------------------------------------


async def _receipt_extractor(payload: IngestPayload) -> ProposalEnvelope[PantryProposal]:
    """Receipt extractor: accepts OCR text or raw image bytes.

    For image bytes the caller is expected to have already run OCR before
    reaching this point (scan.py handles OCR then calls run_receipt_ingest
    with the text, or passes pre-extracted ocr_text).  If only image_bytes
    are supplied and no ocr_text, we raise to signal that OCR is needed
    upstream.
    """
    from bubbly_chef.workflows.receipt_ingest import run_receipt_ingest

    ocr_text = payload.ocr_text
    if not ocr_text and payload.image_bytes:
        # OCR not yet performed; signal that the caller must OCR first.
        # scan.py already does OCR before calling the dispatcher, so this
        # path is only hit if someone constructs the payload incorrectly.
        raise ValueError(
            "Receipt extractor received raw image bytes without OCR text. "
            "Run OCR first and supply ocr_text."
        )

    if not ocr_text:
        raise ValueError("Receipt extractor requires ocr_text")

    return await run_receipt_ingest(ocr_text=ocr_text)


# Register the receipt extractor on module load
dispatcher.register(ExtractorEntry(modality=IngestModality.RECEIPT, extract=_receipt_extractor))
