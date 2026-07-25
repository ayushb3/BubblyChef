"""JWT auth middleware for the AI microservice.

Validates Supabase JWTs and extracts user_id.
Supports both ES256 (JWKS) and HS256 (legacy secret) verification.
"""

import logging
import time
from typing import Any

import jwt
from jwt import PyJWKClient, PyJWKClientError

from fastapi import HTTPException, Request

from bubbly_chef.config import settings

logger = logging.getLogger(__name__)

# JWKS client with caching (re-fetches keys every 10 minutes)
_jwks_client: PyJWKClient | None = None
_jwks_client_init_time: float = 0


def _get_jwks_client() -> PyJWKClient:
    """Lazy-init JWKS client pointed at Supabase's well-known endpoint."""
    global _jwks_client, _jwks_client_init_time
    now = time.time()
    if _jwks_client is None or (now - _jwks_client_init_time) > 600:
        jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=600)
        _jwks_client_init_time = now
    return _jwks_client


def _decode_with_jwks(token: str) -> dict[str, Any]:
    """Decode JWT using Supabase JWKS (ES256)."""
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256"],
        audience="authenticated",
    )


def _decode_with_secret(token: str) -> dict[str, Any]:
    """Decode JWT using HS256 shared secret (legacy Supabase projects)."""
    return jwt.decode(
        token,
        settings.supabase_jwt_secret,
        algorithms=["HS256"],
        audience="authenticated",
    )


async def get_current_user_id(request: Request) -> str:
    """Extract user_id from Supabase JWT in Authorization header.

    The AI microservice receives the user's Supabase access_token
    forwarded by the Next.js frontend.

    Tries ES256 (JWKS) first, falls back to HS256 (shared secret).
    """
    authorization = request.headers.get("authorization")
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.removeprefix("Bearer ")

    # Try ES256 via JWKS first (modern Supabase projects)
    try:
        payload = _decode_with_jwks(token)
    except (jwt.PyJWTError, PyJWKClientError):
        # Fall back to HS256 shared secret
        if not settings.supabase_jwt_secret:
            logger.error("JWKS failed and BUBBLY_SUPABASE_JWT_SECRET not configured")
            raise HTTPException(status_code=500, detail="Auth not configured")
        try:
            payload = _decode_with_secret(token)
        except jwt.PyJWTError as e:
            logger.warning(f"JWT validation failed: {e}")
            raise HTTPException(status_code=401, detail="Invalid or expired token") from e

    user_id = payload.get("sub")
    if not user_id or not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Invalid token: no sub claim")
    return user_id
