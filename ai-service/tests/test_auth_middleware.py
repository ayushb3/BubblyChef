"""Tests for JWT auth middleware."""

import time
from unittest.mock import patch

import jwt as pyjwt
import pytest
from fastapi import HTTPException

from bubbly_chef.api.auth import get_current_user_id

TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests"
TEST_USER_ID = "6bac818e-b787-47f5-9ab0-b8667c7af959"


def _make_token(
    sub: str = TEST_USER_ID,
    aud: str = "authenticated",
    exp_offset: int = 3600,
    secret: str = TEST_JWT_SECRET,
) -> str:
    """Create a HS256 JWT for testing."""
    payload = {
        "sub": sub,
        "aud": aud,
        "iat": int(time.time()),
        "exp": int(time.time()) + exp_offset,
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


class _FakeRequest:
    """Minimal Request-like object for unit testing get_current_user_id."""

    def __init__(self, authorization: str | None = None) -> None:
        self.headers: dict[str, str] = {}
        if authorization is not None:
            self.headers["authorization"] = authorization


@pytest.fixture(autouse=True)
def _patch_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the auth middleware at our test JWT secret and disable JWKS."""
    from bubbly_chef import config

    monkeypatch.setattr(config.settings, "supabase_jwt_secret", TEST_JWT_SECRET)
    monkeypatch.setattr(config.settings, "supabase_url", "http://localhost:0")


@pytest.mark.asyncio
async def test_valid_jwt_extracts_user_id() -> None:
    """A valid Supabase-style JWT returns the correct user_id."""
    token = _make_token()
    user_id = await get_current_user_id(_FakeRequest(f"Bearer {token}"))  # type: ignore[arg-type]
    assert user_id == TEST_USER_ID


@pytest.mark.asyncio
async def test_expired_jwt_returns_401() -> None:
    """An expired JWT raises 401."""
    token = _make_token(exp_offset=-3600)  # expired 1 hour ago
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user_id(_FakeRequest(f"Bearer {token}"))  # type: ignore[arg-type]
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_missing_header_returns_401() -> None:
    """No Authorization header raises 401 (not 422)."""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user_id(_FakeRequest())  # type: ignore[arg-type]
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_missing_bearer_returns_401() -> None:
    """An authorization header without 'Bearer ' prefix raises 401."""
    token = _make_token()
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user_id(_FakeRequest(f"Token {token}"))  # type: ignore[arg-type]
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_invalid_token_returns_401() -> None:
    """A garbage token raises 401."""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user_id(_FakeRequest("Bearer not-a-valid-jwt"))  # type: ignore[arg-type]
    assert exc_info.value.status_code == 401
