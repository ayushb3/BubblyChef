"""Tests for pantry API endpoints."""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient


class TestHealthEndpoints:
    """Tests for health check endpoints."""

    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """Test basic health check."""
        mock_health = {
            "healthy": True,
            "providers": [],
        }
        with patch(
            "bubbly_chef.api.routes.health.get_ai_manager"
        ) as mock_get_manager:
            mock_manager = AsyncMock()
            mock_manager.health_check.return_value = mock_health
            mock_get_manager.return_value = mock_manager

            response = await client.get("/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
            assert "version" in data

    @pytest.mark.asyncio
    async def test_ai_health_check(self, client: AsyncClient):
        """Test AI health check."""
        mock_health = {
            "healthy": False,
            "providers": [
                {"name": "gemini", "available": False},
                {"name": "ollama", "available": False},
            ],
        }
        with patch(
            "bubbly_chef.api.routes.health.get_ai_manager"
        ) as mock_get_manager:
            mock_manager = AsyncMock()
            mock_manager.health_check.return_value = mock_health
            mock_get_manager.return_value = mock_manager

            response = await client.get("/health/ai")
            assert response.status_code == 200
            data = response.json()
            assert "ai_available" in data
            assert "ai_providers" in data
            assert isinstance(data["ai_providers"], list)


class TestPantryEndpoints:
    """Tests for pantry CRUD endpoints."""

    @pytest.mark.asyncio
    async def test_list_empty_pantry(self, client: AsyncClient):
        """Test listing empty pantry."""
        response = await client.get("/pantry")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total_count"] == 0

    @pytest.mark.asyncio
    async def test_create_item(self, client: AsyncClient):
        """Test creating a pantry item."""
        response = await client.post(
            "/pantry",
            json={"name": "Milk", "quantity": 1, "unit": "gallon"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Milk"
        assert data["name_normalized"] == "milk"
        assert data["quantity"] == 1
        assert data["unit"] == "gallon"
        assert "id" in data
        assert "location" in data
        assert "category" in data

    @pytest.mark.asyncio
    async def test_create_item_auto_category(self, client: AsyncClient):
        """Test creating item with default category."""
        response = await client.post(
            "/pantry",
            json={"name": "Chicken breast", "quantity": 2, "unit": "lb"},
        )
        assert response.status_code == 201
        data = response.json()
        assert "category" in data
        assert "location" in data

    @pytest.mark.asyncio
    async def test_create_item_with_explicit_category(self, client: AsyncClient):
        """Test creating with explicit category."""
        response = await client.post(
            "/pantry",
            json={
                "name": "Mystery item",
                "quantity": 1,
                "unit": "item",
                "category": "snacks",
                "storage_location": "pantry",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["category"] == "snacks"
        assert data["location"] == "pantry"

    @pytest.mark.asyncio
    async def test_get_item(self, client: AsyncClient):
        """Test getting a single item."""
        # Create item first
        create_response = await client.post(
            "/pantry",
            json={"name": "Eggs", "quantity": 12, "unit": "count"},
        )
        item_id = create_response.json()["id"]

        # Get item
        response = await client.get(f"/pantry/{item_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["item"]["id"] == item_id
        assert data["item"]["name"] == "Eggs"

    @pytest.mark.asyncio
    async def test_get_nonexistent_item(self, client: AsyncClient):
        """Test getting item that doesn't exist."""
        response = await client.get("/pantry/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_item(self, client: AsyncClient):
        """Test updating a pantry item."""
        # Create item
        create_response = await client.post(
            "/pantry",
            json={"name": "Milk", "quantity": 1, "unit": "gallon"},
        )
        item_id = create_response.json()["id"]

        # Update item
        response = await client.put(
            f"/pantry/{item_id}",
            json={"quantity": 0.5},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["quantity"] == 0.5
        assert data["name"] == "Milk"  # Unchanged

    @pytest.mark.asyncio
    async def test_delete_item(self, client: AsyncClient):
        """Test deleting a pantry item."""
        # Create item
        create_response = await client.post(
            "/pantry",
            json={"name": "Butter", "quantity": 1, "unit": "stick"},
        )
        item_id = create_response.json()["id"]

        # Delete item
        response = await client.delete(f"/pantry/{item_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify deleted
        get_response = await client.get(f"/pantry/{item_id}")
        assert get_response.status_code == 404

    @pytest.mark.asyncio
    async def test_list_with_filter(self, client: AsyncClient):
        """Test listing with category filter."""
        # Create items with explicit categories
        await client.post("/pantry", json={"name": "Milk", "category": "dairy"})
        await client.post("/pantry", json={"name": "Chicken", "category": "meat"})
        await client.post("/pantry", json={"name": "Eggs", "category": "dairy"})

        # Filter by dairy
        response = await client.get("/pantry?category=dairy")
        assert response.status_code == 200
        data = response.json()
        assert all(item["category"] == "dairy" for item in data["items"])

    @pytest.mark.asyncio
    async def test_search(self, client: AsyncClient):
        """Test searching by name."""
        # Create items
        await client.post("/pantry", json={"name": "Whole Milk"})
        await client.post("/pantry", json={"name": "Almond Milk"})
        await client.post("/pantry", json={"name": "Eggs"})

        # Search for milk
        response = await client.get("/pantry?search=milk")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert all("milk" in item["name"].lower() for item in data["items"])

    @pytest.mark.asyncio
    async def test_expiring_items(self, client: AsyncClient):
        """Test getting expiring items."""
        # Create items with explicit categories (expiry estimation uses category)
        await client.post(
            "/pantry",
            json={"name": "Chicken", "category": "meat"},
        )
        await client.post(
            "/pantry",
            json={"name": "Rice", "category": "dry_goods"},
        )

        # Get items expiring in 7 days
        response = await client.get("/pantry/expiring?days=7")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total_count" in data
