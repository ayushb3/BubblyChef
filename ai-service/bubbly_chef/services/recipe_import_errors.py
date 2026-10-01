"""User-safe errors for recipe import from a link (issue #528).

``RecipeImportError`` carries a machine-readable ``reason`` the frontend
switches on (``RecipeImportModal``'s ``ERROR_MESSAGES``), a human-safe
``message``, and the HTTP status to answer with. ``classify_video_error`` maps
whatever went wrong while Gemini watched a video onto one of a fixed set of
these, so provider names, model IDs and raw exception text (useful in logs,
unsafe in a browser) never reach the client — same rule as the scan errors
(``services/scan_errors.py``, issue #396). The caller logs the original
exception before discarding it in favour of the sanitized one.
"""

from __future__ import annotations

import httpx

from bubbly_chef.ai.manager import NoProviderAvailableError

NOT_A_RECIPE = "not_a_recipe"
VIDEO_UNAVAILABLE = "video_unavailable"
VIDEO_TIMEOUT = "video_timeout"
VIDEO_FAILED = "video_failed"


class RecipeImportError(Exception):
    """A recipe import that failed in a way the user should be told about."""

    def __init__(self, reason: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.status_code = status_code


def not_a_recipe() -> RecipeImportError:
    return RecipeImportError(
        NOT_A_RECIPE,
        "We couldn't find a recipe in that video. Try one where the ingredients and steps "
        "are shown or said.",
        422,
    )


def video_unavailable() -> RecipeImportError:
    return RecipeImportError(
        VIDEO_UNAVAILABLE,
        "We couldn't open that video. It may be private, age-restricted or removed.",
        422,
    )


def video_timeout() -> RecipeImportError:
    return RecipeImportError(
        VIDEO_TIMEOUT,
        "Watching that video took too long. Please try again in a moment.",
        504,
    )


def video_failed() -> RecipeImportError:
    return RecipeImportError(
        VIDEO_FAILED,
        "We couldn't watch that video right now. Please try again in a moment.",
        503,
    )


def classify_video_error(exc: Exception) -> RecipeImportError:
    """Map an exception raised while importing a video to a sanitized error.

    Only ever returns one of the fixed errors above; nothing from ``exc`` is
    copied into the result.
    """
    if isinstance(exc, RecipeImportError):
        return exc
    if isinstance(exc, NoProviderAvailableError):
        # GeminiProvider reports an unreadable video (HTTP 400, or a 403 that is not a
        # key/project problem) as `bad_request`; real auth failures stay `auth`.
        if exc.kind == "bad_request":
            return video_unavailable()
        if exc.kind == "timeout":
            return video_timeout()
        return video_failed()
    if isinstance(exc, httpx.TimeoutException | TimeoutError):
        return video_timeout()
    return video_failed()
