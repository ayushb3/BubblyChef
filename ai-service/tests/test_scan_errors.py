"""Unit tests for bubbly_chef.services.scan_errors.classify_scan_error (issue #396)."""

from __future__ import annotations

import httpx
import pytest

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.services.scan_errors import (
    GENERIC,
    TIMEOUT,
    UNREADABLE_IMAGE,
    VISION_UNAVAILABLE,
    classify_scan_error,
)


def test_value_error_maps_to_unreadable_image() -> None:
    exc = ValueError("Failed to preprocess image: cannot identify image file")
    assert classify_scan_error(exc) is UNREADABLE_IMAGE


def test_no_provider_available_maps_to_vision_unavailable() -> None:
    exc = NoProviderAvailableError(
        "No vision-capable provider available. Errors: "
        "['gemini/gemini-2.5-flash: Gemini [gemini-2.5-flash] vision API error 429: quota']"
    )
    assert classify_scan_error(exc) is VISION_UNAVAILABLE


def test_no_provider_available_with_timeout_text_maps_to_timeout() -> None:
    exc = NoProviderAvailableError(
        "No vision-capable provider available. Errors: "
        "['gemini/gemini-2.5-flash: Gemini [gemini-2.5-flash] vision connection "
        "error: ReadTimeout: ']"
    )
    assert classify_scan_error(exc) is TIMEOUT


def test_httpx_timeout_exception_maps_to_timeout() -> None:
    exc = httpx.ReadTimeout("timed out")
    assert classify_scan_error(exc) is TIMEOUT


def test_builtin_timeout_error_maps_to_timeout() -> None:
    exc = TimeoutError("deadline exceeded")
    assert classify_scan_error(exc) is TIMEOUT


def test_unrelated_exception_maps_to_generic() -> None:
    exc = RuntimeError("something unexpected exploded deep in the ai manager")
    assert classify_scan_error(exc) is GENERIC


@pytest.mark.parametrize("info", [VISION_UNAVAILABLE, TIMEOUT, UNREADABLE_IMAGE, GENERIC])
def test_every_error_info_is_free_of_internal_terms(info: object) -> None:
    """Sanity guard: the fixed messages themselves never name a provider/model."""
    text = f"{info.code} {info.message}".lower()  # type: ignore[attr-defined]
    for banned in ("gemini", "ollama", "anthropic", "traceback", "exception"):
        assert banned not in text
