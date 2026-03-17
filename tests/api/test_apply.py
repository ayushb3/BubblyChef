"""Tests for the apply endpoint."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from bubbly_chef.api.routes.apply import parse_pantry_item
from bubbly_chef.models.pantry import FoodCategory, StorageLocation


# ---------------------------------------------------------------------------
# Unit tests for parse_pantry_item
# ---------------------------------------------------------------------------

class TestParsePantryItem:
    def test_parse_with_string_id(self):
        uid = str(uuid4())
        item = parse_pantry_item({"id": uid, "name": "milk"})
        assert str(item.id) == uid
        assert item.name == "milk"

    def test_parse_generates_id_when_missing(self):
        item = parse_pantry_item({"name": "eggs"})
        assert item.id is not None

    def test_parse_invalid_category_falls_back(self):
        item = parse_pantry_item({"name": "x", "category": "invalid_cat"})
        assert item.category == FoodCategory.OTHER

    def test_parse_valid_category(self):
        item = parse_pantry_item({"name": "x", "category": "dairy"})
        assert item.category == FoodCategory.DAIRY

    def test_parse_invalid_storage_falls_back(self):
        item = parse_pantry_item({"name": "x", "storage_location": "rooftop"})
        assert item.storage_location == StorageLocation.PANTRY

    def test_parse_valid_storage(self):
        item = parse_pantry_item({"name": "x", "storage_location": "fridge"})
        assert item.storage_location == StorageLocation.FRIDGE

    def test_parse_dates(self):
        item = parse_pantry_item({
            "name": "milk",
            "purchase_date": "2026-03-01",
            "expiry_date": "2026-03-15",
        })
        assert str(item.purchase_date) == "2026-03-01"
        assert str(item.expiry_date) == "2026-03-15"

    def test_parse_defaults(self):
        item = parse_pantry_item({})
        assert item.name == "unknown"
        assert item.quantity == 1.0
        assert item.unit == "item"
        assert item.estimated_expiry is True


# ---------------------------------------------------------------------------
# Integration tests for /apply endpoint (using conftest async client)
# ---------------------------------------------------------------------------

class TestApplyEndpoint:
    @pytest.mark.asyncio
    async def test_apply_add_new_item(self, client):
        req_id = str(uuid4())
        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = None
        mock_repo.add_pantry_item.return_value = None

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "add",
                        "item": {"name": "milk", "quantity": 1, "unit": "gallon", "category": "dairy"},
                    }]
                },
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["applied_count"] == 1
        mock_repo.add_pantry_item.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_add_dedup_existing(self, client):
        req_id = str(uuid4())
        existing = MagicMock()
        existing.id = uuid4()
        existing.quantity = 1.0

        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = existing

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "add",
                        "item": {"name": "milk", "quantity": 2, "unit": "gallon"},
                    }]
                },
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["applied_count"] == 1
        assert existing.quantity == 3.0  # 1 + 2
        mock_repo.update_pantry_item.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_update_by_id(self, client):
        req_id = str(uuid4())
        match_id = uuid4()
        existing = MagicMock()
        existing.id = match_id

        mock_repo = AsyncMock()
        mock_repo.get_pantry_item.return_value = existing

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "update",
                        "match_existing_id": str(match_id),
                        "item": {"name": "milk", "quantity": 3},
                    }]
                },
            })
        assert resp.status_code == 200
        assert resp.json()["applied_count"] == 1

    @pytest.mark.asyncio
    async def test_apply_update_not_found(self, client):
        req_id = str(uuid4())
        match_id = uuid4()
        mock_repo = AsyncMock()
        mock_repo.get_pantry_item.return_value = None

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "update",
                        "match_existing_id": str(match_id),
                        "item": {"name": "milk"},
                    }]
                },
            })
        data = resp.json()
        assert data["failed_count"] == 1
        assert len(data["errors"]) == 1

    @pytest.mark.asyncio
    async def test_apply_update_by_name(self, client):
        req_id = str(uuid4())
        existing = MagicMock()
        existing.id = uuid4()

        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = existing

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "update",
                        "item": {"name": "milk", "quantity": 5},
                    }]
                },
            })
        assert resp.json()["applied_count"] == 1

    @pytest.mark.asyncio
    async def test_apply_update_by_name_not_found(self, client):
        req_id = str(uuid4())
        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = None

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "update",
                        "item": {"name": "unicorn milk"},
                    }]
                },
            })
        assert resp.json()["failed_count"] == 1

    @pytest.mark.asyncio
    async def test_apply_remove_by_id(self, client):
        req_id = str(uuid4())
        match_id = uuid4()
        mock_repo = AsyncMock()
        mock_repo.delete_pantry_item.return_value = True

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "remove",
                        "match_existing_id": str(match_id),
                        "item": {"name": "milk"},
                    }]
                },
            })
        assert resp.json()["applied_count"] == 1

    @pytest.mark.asyncio
    async def test_apply_remove_not_found(self, client):
        req_id = str(uuid4())
        match_id = uuid4()
        mock_repo = AsyncMock()
        mock_repo.delete_pantry_item.return_value = False

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "remove",
                        "match_existing_id": str(match_id),
                        "item": {"name": "milk"},
                    }]
                },
            })
        assert resp.json()["failed_count"] == 1

    @pytest.mark.asyncio
    async def test_apply_remove_by_name(self, client):
        req_id = str(uuid4())
        existing = MagicMock()
        existing.id = uuid4()
        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = existing
        mock_repo.delete_pantry_item.return_value = True

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "remove",
                        "item": {"name": "milk"},
                    }]
                },
            })
        assert resp.json()["applied_count"] == 1

    @pytest.mark.asyncio
    async def test_apply_use_reduces_quantity(self, client):
        req_id = str(uuid4())
        existing = MagicMock()
        existing.id = uuid4()
        existing.quantity = 5.0
        existing.name = "eggs"

        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = existing

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "use",
                        "item": {"name": "eggs", "quantity": 3},
                    }]
                },
            })
        assert resp.json()["applied_count"] == 1
        assert existing.quantity == 2.0  # 5 - 3
        mock_repo.update_pantry_item.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_use_depletes_item(self, client):
        req_id = str(uuid4())
        existing = MagicMock()
        existing.id = uuid4()
        existing.quantity = 2.0
        existing.name = "eggs"

        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = existing

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "use",
                        "item": {"name": "eggs", "quantity": 5},
                    }]
                },
            })
        assert resp.json()["applied_count"] == 1
        mock_repo.delete_pantry_item.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_use_not_found(self, client):
        req_id = str(uuid4())
        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = None

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "use",
                        "item": {"name": "unicorn milk", "quantity": 1},
                    }]
                },
            })
        assert resp.json()["failed_count"] == 1

    @pytest.mark.asyncio
    async def test_apply_invalid_action_type_defaults_to_add(self, client):
        req_id = str(uuid4())
        mock_repo = AsyncMock()
        mock_repo.find_similar_item.return_value = None

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {
                    "actions": [{
                        "action_type": "bogus",
                        "item": {"name": "milk"},
                    }]
                },
            })
        assert resp.status_code == 200
        mock_repo.add_pantry_item.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_recipe(self, client):
        req_id = str(uuid4())
        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = None
        mock_repo.add_recipe.return_value = None

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "recipe_card",
                "proposal": {
                    "recipe": {
                        "title": "Pasta Carbonara",
                        "instructions": ["Boil pasta", "Mix eggs and cheese"],
                        "ingredients": [
                            {"name": "pasta", "quantity": 1, "unit": "lb"},
                            {"name": "eggs", "quantity": 3},
                        ],
                    }
                },
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["applied_count"] == 1
        mock_repo.add_recipe.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_recipe_update_existing(self, client):
        req_id = str(uuid4())
        recipe_id = uuid4()
        existing_recipe = MagicMock()
        existing_recipe.created_at = "2026-01-01"

        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = existing_recipe

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "recipe_card",
                "proposal": {
                    "recipe": {
                        "id": str(recipe_id),
                        "title": "Updated Recipe",
                        "instructions": ["Step 1"],
                    }
                },
            })
        assert resp.json()["applied_count"] == 1
        mock_repo.update_recipe.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_empty_pantry_proposal(self, client):
        req_id = str(uuid4())
        mock_repo = AsyncMock()

        with patch("bubbly_chef.api.routes.apply.get_repository", return_value=mock_repo):
            resp = await client.post("/apply", json={
                "request_id": req_id,
                "intent": "pantry_update",
                "proposal": {},
            })
        # No actions → success=False but no crash
        assert resp.status_code == 200
        assert resp.json()["applied_count"] == 0
