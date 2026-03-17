"""Tests for the logging middleware."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.middleware import LoggingMiddleware


@pytest.fixture
def app_with_middleware():
    """Create a minimal FastAPI app with the logging middleware."""
    app = FastAPI()
    app.add_middleware(LoggingMiddleware)

    @app.get("/test")
    async def test_endpoint():
        return {"status": "ok"}

    @app.get("/error")
    async def error_endpoint():
        raise ValueError("boom")

    return app


class TestLoggingMiddleware:
    @pytest.mark.asyncio
    async def test_logs_request_and_response(self, app_with_middleware):
        transport = ASGITransport(app=app_with_middleware)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/test")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_logs_query_params(self, app_with_middleware):
        transport = ASGITransport(app=app_with_middleware)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/test?foo=bar")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_handles_nonexistent_route(self, app_with_middleware):
        transport = ASGITransport(app=app_with_middleware)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/nonexistent")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_skip_when_disabled(self):
        app = FastAPI()
        app.add_middleware(LoggingMiddleware)

        @app.get("/test")
        async def test_endpoint():
            return {"ok": True}

        with patch("bubbly_chef.api.middleware.settings") as mock_settings:
            mock_settings.log_requests = False
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/test")
            assert resp.status_code == 200
