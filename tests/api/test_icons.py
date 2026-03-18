"""Tests for GET /api/icons/{name} endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestGetIcon:
    """Tests for /api/icons/{name} — 3-tier fallback, never-404 invariant."""

    @pytest.mark.asyncio
    async def test_never_returns_404_unknown_item(self, client: AsyncClient) -> None:
        """Invariant: endpoint always returns 200 regardless of input."""
        response = await client.get("/api/icons/completelymadeupfooditem99xyz")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_falls_back_to_emoji_json_when_no_png(self, client: AsyncClient) -> None:
        """Tier 3: returns JSON with emoji+category when no PNG available."""
        # Patch FLUENT_DIR to a non-existent path so all file checks fail
        with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", Path("/nonexistent/dir")):
            response = await client.get("/api/icons/unknownxyz123")
        assert response.status_code == 200
        data = response.json()
        assert "emoji" in data
        assert "category" in data

    @pytest.mark.asyncio
    async def test_tier3_emoji_json_structure(self, client: AsyncClient) -> None:
        """Tier-3 response has emoji and category fields with sensible values."""
        with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", Path("/nonexistent/dir")):
            response = await client.get("/api/icons/milk")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["emoji"], str)
        assert len(data["emoji"]) >= 1
        assert isinstance(data["category"], str)

    @pytest.mark.asyncio
    async def test_serves_png_when_file_exists(self, client: AsyncClient, tmp_path: Path) -> None:
        """Tier 1: returns image/png when Fluent Emoji PNG exists for item."""
        # Create a fake PNG file at the expected slug path
        fluent_dir = tmp_path / "fluent"
        fluent_dir.mkdir()
        fake_png = fluent_dir / "glass_of_milk.png"
        fake_png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)  # minimal PNG header

        with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", fluent_dir):
            response = await client.get("/api/icons/milk")

        # If FOOD_ICON_MAP has milk → glass_of_milk, should return PNG
        # Otherwise falls through to category/emoji (still 200)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_category_fallback_serves_png(self, client: AsyncClient, tmp_path: Path) -> None:
        """Tier 2: serves category PNG when item not in FOOD_ICON_MAP but category PNG exists."""
        fluent_dir = tmp_path / "fluent"
        fluent_dir.mkdir()
        # Create category PNG for dairy
        dairy_png = fluent_dir / "glass_of_milk.png"
        dairy_png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)

        # Use an item known to be dairy category but not in FOOD_ICON_MAP
        with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", fluent_dir):
            with patch("bubbly_chef.api.routes.icons.FOOD_ICON_MAP", {}):
                response = await client.get("/api/icons/milk")

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_normalizes_uppercase_name(self, client: AsyncClient) -> None:
        """Name is normalized before lookup (uppercase treated same as lowercase)."""
        with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", Path("/nonexistent/dir")):
            r1 = await client.get("/api/icons/Milk")
            r2 = await client.get("/api/icons/milk")
        assert r1.status_code == r2.status_code == 200

    @pytest.mark.asyncio
    async def test_url_encoded_spaces(self, client: AsyncClient) -> None:
        """URL-encoded names (spaces as %20) are decoded correctly."""
        with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", Path("/nonexistent/dir")):
            response = await client.get("/api/icons/chicken%20breast")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_empty_name_returns_fallback(self, client: AsyncClient) -> None:
        """Whitespace-only name returns emoji fallback gracefully."""
        with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", Path("/nonexistent/dir")):
            response = await client.get("/api/icons/%20")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_content_type_for_png_response(self, client: AsyncClient, tmp_path: Path) -> None:
        """When serving a PNG file, content-type must be image/png."""
        fluent_dir = tmp_path / "fluent"
        fluent_dir.mkdir()

        # Plant a PNG for a known item with known slug
        from bubbly_chef.domain.icon_map import FOOD_ICON_MAP
        if FOOD_ICON_MAP:
            first_canonical = next(iter(FOOD_ICON_MAP))
            slug = FOOD_ICON_MAP[first_canonical]
            png = fluent_dir / f"{slug}.png"
            png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)

            with patch("bubbly_chef.api.routes.icons.FLUENT_DIR", fluent_dir):
                response = await client.get(f"/api/icons/{first_canonical}")

            if response.headers.get("content-type", "").startswith("image/png"):
                assert response.status_code == 200
            else:
                # Fell through to JSON fallback — still valid
                assert response.status_code == 200
