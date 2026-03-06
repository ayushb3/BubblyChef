"""Tests for pantry API endpoints."""

import pytest
import pytest_asyncio
from httpx import AsyncClient


class TestHealthEndpoints:
    """Tests for health check endpoints."""

    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """Test basic health check."""
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data

    @pytest.mark.asyncio
    async def test_ai_health_check(self, client: AsyncClient):
        """Test AI health check."""
        response = await client.get("/health/ai")
        assert response.status_code == 200
        data = response.json()
        assert "healthy" in data
        assert "providers" in data
        assert isinstance(data["providers"], list)


class TestPantryEndpoints:
    """Tests for pantry CRUD endpoints."""

    @pytest.mark.asyncio
    async def test_list_empty_pantry(self, client: AsyncClient):
        """Test listing empty pantry."""
        response = await client.get("/api/pantry")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total_count"] == 0

    @pytest.mark.asyncio
    async def test_create_item(self, client: AsyncClient):
        """Test creating a pantry item."""
        response = await client.post(
            "/api/pantry",
            json={"name": "Milk", "quantity": 1, "unit": "gallon"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Milk"
        assert data["name_normalized"] == "milk"
        assert data["category"] == "dairy"  # Auto-detected
        assert data["location"] == "fridge"  # Default for dairy
        assert data["quantity"] == 1
        assert data["unit"] == "gallon"
        assert "id" in data
        assert "expiry_date" in data  # Auto-estimated

    @pytest.mark.asyncio
    async def test_create_item_auto_category(self, client: AsyncClient):
        """Test that category is auto-detected."""
        response = await client.post(
            "/api/pantry",
            json={"name": "Chicken breast", "quantity": 2, "unit": "lb"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["category"] == "meat"
        assert data["location"] == "fridge"

    @pytest.mark.asyncio
    async def test_create_item_with_explicit_category(self, client: AsyncClient):
        """Test creating with explicit category."""
        response = await client.post(
            "/api/pantry",
            json={
                "name": "Mystery item",
                "quantity": 1,
                "unit": "item",
                "category": "snacks",
                "location": "pantry",
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
            "/api/pantry",
            json={"name": "Eggs", "quantity": 12, "unit": "count"},
        )
        item_id = create_response.json()["id"]

        # Get item
        response = await client.get(f"/api/pantry/{item_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == item_id
        assert data["name"] == "Eggs"

    @pytest.mark.asyncio
    async def test_get_nonexistent_item(self, client: AsyncClient):
        """Test getting item that doesn't exist."""
        response = await client.get("/api/pantry/nonexistent-id")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_item(self, client: AsyncClient):
        """Test updating a pantry item."""
        # Create item
        create_response = await client.post(
            "/api/pantry",
            json={"name": "Milk", "quantity": 1, "unit": "gallon"},
        )
        item_id = create_response.json()["id"]

        # Update item
        response = await client.put(
            f"/api/pantry/{item_id}",
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
            "/api/pantry",
            json={"name": "Butter", "quantity": 1, "unit": "stick"},
        )
        item_id = create_response.json()["id"]

        # Delete item
        response = await client.delete(f"/api/pantry/{item_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        # Verify deleted
        get_response = await client.get(f"/api/pantry/{item_id}")
        assert get_response.status_code == 404

    @pytest.mark.asyncio
    async def test_list_with_filter(self, client: AsyncClient):
        """Test listing with category filter."""
        # Create items
        await client.post("/api/pantry", json={"name": "Milk"})
        await client.post("/api/pantry", json={"name": "Chicken"})
        await client.post("/api/pantry", json={"name": "Eggs"})

        # Filter by dairy
        response = await client.get("/api/pantry?category=dairy")
        assert response.status_code == 200
        data = response.json()
        # Milk and Eggs are dairy
        assert all(item["category"] == "dairy" for item in data["items"])

    @pytest.mark.asyncio
    async def test_search(self, client: AsyncClient):
        """Test searching by name."""
        # Create items
        await client.post("/api/pantry", json={"name": "Whole Milk"})
        await client.post("/api/pantry", json={"name": "Almond Milk"})
        await client.post("/api/pantry", json={"name": "Eggs"})

        # Search for milk
        response = await client.get("/api/pantry?search=milk")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert all("milk" in item["name"].lower() for item in data["items"])

    @pytest.mark.asyncio
    async def test_expiring_items(self, client: AsyncClient):
        """Test getting expiring items."""
        # Create items (they'll have auto-estimated expiry)
        await client.post("/api/pantry", json={"name": "Chicken"})  # 2 days
        await client.post("/api/pantry", json={"name": "Rice"})  # 365 days

        # Get items expiring in 7 days
        response = await client.get("/api/pantry/expiring?days=7")
        assert response.status_code == 200
        data = response.json()
        # Only chicken should be expiring soon
        assert len(data) >= 1
        assert any(item["name"] == "Chicken" for item in data)
