"""User-safe error classification for the receipt scan endpoint.

Internal exceptions raised while scanning a receipt (OCR / vision provider
failures, image preprocessing failures, AI parsing failures) carry provider
names, model IDs, and raw exception text in their message — useful in logs,
unsafe to return to the browser (see issue #396).

``classify_scan_error`` maps an arbitrary exception raised anywhere in the
scan pipeline to one of a small, stable vocabulary of ``ScanErrorInfo``
entries: a machine-readable ``code`` the frontend can switch on, a
human-safe ``message``, and the HTTP status to respond with. The caller
(``api/routes/scan.py``) is responsible for logging the original exception
at error level *before* discarding it in favour of the sanitized info.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from bubbly_chef.ai.manager import NoProviderAvailableError


@dataclass(frozen=True)
class ScanErrorInfo:
    """A user-safe error to surface to the client for a failed scan."""

    code: str
    message: str
    status_code: int


VISION_UNAVAILABLE = ScanErrorInfo(
    code="vision_provider_unavailable",
    message=(
        "We couldn't reach our scanning service right now. Please try again in a moment."
    ),
    status_code=503,
)

TIMEOUT = ScanErrorInfo(
    code="scan_timeout",
    message="The scan took too long and timed out. Please try again.",
    status_code=504,
)

UNREADABLE_IMAGE = ScanErrorInfo(
    code="unreadable_image",
    message="We couldn't read that image. Try a clearer photo of the receipt.",
    status_code=422,
)

GENERIC = ScanErrorInfo(
    code="scan_failed",
    message="Something went wrong while scanning your receipt. Please try again.",
    status_code=500,
)

_TIMEOUT_MARKERS = ("timeout", "timed out")


def classify_scan_error(exc: Exception) -> ScanErrorInfo:
    """Map an internal exception raised during receipt scanning to a user-safe error.

    Never inspects/returns anything that could carry provider names, model
    IDs, or raw exception text — only picks one of the fixed ``ScanErrorInfo``
    constants above.
    """
    if isinstance(exc, ValueError):
        # bubbly_chef.services.image_preprocessor raises ValueError for
        # corrupt/undecodable images.
        return UNREADABLE_IMAGE

    if isinstance(exc, NoProviderAvailableError):
        # The message text is internal-only (provider names/model IDs) but we
        # can still sniff it server-side to distinguish timeout from generic
        # unavailability before discarding it.
        if any(marker in str(exc).lower() for marker in _TIMEOUT_MARKERS):
            return TIMEOUT
        return VISION_UNAVAILABLE

    if isinstance(exc, httpx.TimeoutException | TimeoutError):
        return TIMEOUT

    return GENERIC
