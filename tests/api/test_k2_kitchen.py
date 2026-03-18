"""Tests for K2 Phase: slot_index endpoint + decorations routes + milestone unlock."""

import pytest
from httpx import AsyncClient


class TestPantrySlotEndpoint:
    """Tests for PATCH /pantry/{id}/slot."""

    @pytest.mark.asyncio
    async def test_update_slot_index(self, client: AsyncClient):
        """Setting slot_index persists on the item."""
        create_resp = await client.post(
            "/pantry",
            json={"name": "Apple", "category": "produce"},
        )
        assert create_resp.status_code == 201
        item_id = create_resp.json()["id"]

        patch_resp = await client.patch(f"/pantry/{item_id}/slot?slot_index=3")
        assert patch_resp.status_code == 200
        data = patch_resp.json()
        assert data["slot_index"] == 3

    @pytest.mark.asyncio
    async def test_update_slot_index_null(self, client: AsyncClient):
        """Passing no slot_index clears the slot."""
        create_resp = await client.post(
            "/pantry",
            json={"name": "Banana", "category": "produce"},
        )
        assert create_resp.status_code == 201
        item_id = create_resp.json()["id"]

        # First set a slot
        await client.patch(f"/pantry/{item_id}/slot?slot_index=5")

        # Then clear it
        patch_resp = await client.patch(f"/pantry/{item_id}/slot")
        assert patch_resp.status_code == 200
        data = patch_resp.json()
        assert data["slot_index"] is None

    @pytest.mark.asyncio
    async def test_update_slot_index_not_found(self, client: AsyncClient):
        """Returns 404 for non-existent item."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        resp = await client.patch(f"/pantry/{fake_id}/slot?slot_index=1")
        assert resp.status_code == 404


class TestDecorationsEndpoints:
    """Tests for GET/POST /decorations."""

    @pytest.mark.asyncio
    async def test_list_decorations_empty(self, client: AsyncClient):
        """Returns empty list when no decorations exist."""
        resp = await client.get("/decorations")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0

    @pytest.mark.asyncio
    async def test_unlock_decoration(self, client: AsyncClient):
        """POST /decorations/{name}/unlock creates and unlocks the decoration."""
        resp = await client.post("/decorations/flower_pot/unlock")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "flower_pot"
        assert data["newly_unlocked"] is True

    @pytest.mark.asyncio
    async def test_unlock_decoration_idempotent(self, client: AsyncClient):
        """Unlocking an already-unlocked decoration returns newly_unlocked=False."""
        await client.post("/decorations/cactus/unlock")
        resp = await client.post("/decorations/cactus/unlock")
        assert resp.status_code == 200
        data = resp.json()
        assert data["newly_unlocked"] is False

    @pytest.mark.asyncio
    async def test_list_decorations_after_unlock(self, client: AsyncClient):
        """Unlocked decoration appears in list with unlocked=True."""
        await client.post("/decorations/herb_garden/unlock")
        resp = await client.get("/decorations")
        assert resp.status_code == 200
        data = resp.json()
        assert any(d["name"] == "herb_garden" and d["unlocked"] for d in data)


class TestMilestoneUnlock:
    """Tests for auto milestone unlock when pantry items are added."""

    @pytest.mark.asyncio
    async def test_milestone_check_no_items(self, client: AsyncClient):
        """Milestone check with 0 items unlocks nothing."""
        resp = await client.get("/decorations/milestone-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["pantry_count"] == 0
        assert data["newly_unlocked"] == []

    @pytest.mark.asyncio
    async def test_milestone_unlocks_flower_pot_at_5(self, client: AsyncClient):
        """Adding 5 pantry items auto-unlocks flower_pot decoration."""
        items = ["Apple", "Milk", "Bread", "Cheese", "Eggs"]
        for name in items:
            resp = await client.post("/pantry", json={"name": name, "category": "produce"})
            assert resp.status_code == 201

        # After 5th item, flower_pot should be unlocked
        decorations_resp = await client.get("/decorations")
        decos = decorations_resp.json()
        flower_pot = next((d for d in decos if d["name"] == "flower_pot"), None)
        assert flower_pot is not None, "flower_pot decoration should exist after 5 items"
        assert flower_pot["unlocked"] is True

    @pytest.mark.asyncio
    async def test_milestone_check_endpoint_fires_unlock(self, client: AsyncClient):
        """GET /decorations/milestone-check unlocks decorations when threshold reached."""
        import bubbly_chef.repository.sqlite as sqlite_mod
        from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
        from bubbly_chef.repository.sqlite import SQLiteRepository

        repo: SQLiteRepository = sqlite_mod._repository  # type: ignore[assignment]
        for i in range(5):
            item = PantryItem(
                name=f"TestItem{i}",
                category=FoodCategory.PRODUCE,
                storage_location=StorageLocation.PANTRY,
            )
            await repo.add_pantry_item(item)

        resp = await client.get("/decorations/milestone-check")
        assert resp.status_code == 200
        data = resp.json()
        assert data["pantry_count"] == 5
        assert "flower_pot" in data["newly_unlocked"]
