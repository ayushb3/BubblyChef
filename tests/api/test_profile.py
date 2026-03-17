"""Tests for user profile API endpoints."""

import pytest
from httpx import AsyncClient


class TestProfileEndpoints:
    """Tests for user profile CRUD endpoints."""

    @pytest.mark.asyncio
    async def test_create_profile(self, client: AsyncClient):
        """Test creating a user profile."""
        response = await client.post(
            "/profile",
            json={
                "username": "testuser",
                "email": "test@example.com",
                "display_name": "Test User",
                "dietary_preferences": ["vegetarian"],
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["profile"]["username"] == "testuser"
        assert data["profile"]["email"] == "test@example.com"
        assert data["profile"]["display_name"] == "Test User"
        assert data["profile"]["dietary_preferences"] == ["vegetarian"]
        assert "id" in data["profile"]
        assert "created_at" in data["profile"]
        assert "updated_at" in data["profile"]

    @pytest.mark.asyncio
    async def test_create_profile_minimal(self, client: AsyncClient):
        """Test creating a profile with minimal required fields."""
        response = await client.post(
            "/profile",
            json={
                "username": "minimaluser",
                "email": "minimal@example.com",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["profile"]["username"] == "minimaluser"
        assert data["profile"]["email"] == "minimal@example.com"
        assert data["profile"]["display_name"] is None
        assert data["profile"]["avatar_url"] is None
        assert data["profile"]["dietary_preferences"] == []

    @pytest.mark.asyncio
    async def test_create_profile_invalid_email(self, client: AsyncClient):
        """Test creating a profile with invalid email."""
        response = await client.post(
            "/profile",
            json={
                "username": "testuser2",
                "email": "not-an-email",
            },
        )
        assert response.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async def test_create_profile_duplicate_username(self, client: AsyncClient):
        """Test creating a profile with duplicate username."""
        # Create first profile
        await client.post(
            "/profile",
            json={
                "username": "duplicate",
                "email": "first@example.com",
            },
        )

        # Try to create with same username
        response = await client.post(
            "/profile",
            json={
                "username": "duplicate",
                "email": "second@example.com",
            },
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_create_profile_duplicate_email(self, client: AsyncClient):
        """Test creating a profile with duplicate email."""
        # Create first profile
        await client.post(
            "/profile",
            json={
                "username": "user1",
                "email": "same@example.com",
            },
        )

        # Try to create with same email
        response = await client.post(
            "/profile",
            json={
                "username": "user2",
                "email": "same@example.com",
            },
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_get_profile_by_id(self, client: AsyncClient):
        """Test getting a profile by ID."""
        # Create profile first
        create_response = await client.post(
            "/profile",
            json={
                "username": "getuser",
                "email": "get@example.com",
            },
        )
        profile_id = create_response.json()["profile"]["id"]

        # Get profile by ID
        response = await client.get(f"/profile/{profile_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["id"] == profile_id
        assert data["profile"]["username"] == "getuser"

    @pytest.mark.asyncio
    async def test_get_profile_not_found(self, client: AsyncClient):
        """Test getting a non-existent profile."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = await client.get(f"/profile/{fake_id}")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_profile_by_email(self, client: AsyncClient):
        """Test getting a profile by email."""
        # Create profile first
        await client.post(
            "/profile",
            json={
                "username": "emailuser",
                "email": "findbyme@example.com",
            },
        )

        # Get profile by email
        response = await client.get("/profile/email/findbyme@example.com")
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["email"] == "findbyme@example.com"

    @pytest.mark.asyncio
    async def test_get_profile_by_username(self, client: AsyncClient):
        """Test getting a profile by username."""
        # Create profile first
        await client.post(
            "/profile",
            json={
                "username": "findme",
                "email": "findme@example.com",
            },
        )

        # Get profile by username
        response = await client.get("/profile/username/findme")
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["username"] == "findme"

    @pytest.mark.asyncio
    async def test_update_profile(self, client: AsyncClient):
        """Test updating a profile."""
        # Create profile first
        create_response = await client.post(
            "/profile",
            json={
                "username": "updateme",
                "email": "update@example.com",
            },
        )
        profile_id = create_response.json()["profile"]["id"]

        # Update profile
        response = await client.put(
            f"/profile/{profile_id}",
            json={
                "display_name": "Updated Name",
                "dietary_preferences": ["vegan", "gluten-free"],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["display_name"] == "Updated Name"
        assert "vegan" in data["profile"]["dietary_preferences"]
        assert "gluten-free" in data["profile"]["dietary_preferences"]

    @pytest.mark.asyncio
    async def test_update_profile_username(self, client: AsyncClient):
        """Test updating username."""
        # Create profile first
        create_response = await client.post(
            "/profile",
            json={
                "username": "oldname",
                "email": "changename@example.com",
            },
        )
        profile_id = create_response.json()["profile"]["id"]

        # Update username
        response = await client.put(
            f"/profile/{profile_id}",
            json={"username": "newname"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["username"] == "newname"

    @pytest.mark.asyncio
    async def test_update_profile_not_found(self, client: AsyncClient):
        """Test updating a non-existent profile."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = await client.put(
            f"/profile/{fake_id}",
            json={"display_name": "Test"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_profile_empty_body(self, client: AsyncClient):
        """Test updating with empty request body returns unchanged profile."""
        # Create profile first
        create_response = await client.post(
            "/profile",
            json={
                "username": "nochanges",
                "email": "nochanges@example.com",
                "display_name": "Original Name",
            },
        )
        profile_id = create_response.json()["profile"]["id"]

        # Update with empty body
        response = await client.put(f"/profile/{profile_id}", json={})
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["display_name"] == "Original Name"

    @pytest.mark.asyncio
    async def test_delete_profile(self, client: AsyncClient):
        """Test deleting a profile."""
        # Create profile first
        create_response = await client.post(
            "/profile",
            json={
                "username": "deleteme",
                "email": "delete@example.com",
            },
        )
        profile_id = create_response.json()["profile"]["id"]

        # Delete profile
        response = await client.delete(f"/profile/{profile_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["deleted_id"] == profile_id

        # Verify profile is gone
        get_response = await client.get(f"/profile/{profile_id}")
        assert get_response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_profile_not_found(self, client: AsyncClient):
        """Test deleting a non-existent profile."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = await client.delete(f"/profile/{fake_id}")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_profile_dietary_preferences_array(self, client: AsyncClient):
        """Test that dietary preferences are properly stored as an array."""
        response = await client.post(
            "/profile",
            json={
                "username": "foodie",
                "email": "foodie@example.com",
                "dietary_preferences": ["vegan", "gluten-free", "nut-free"],
            },
        )
        assert response.status_code == 201
        data = response.json()
        prefs = data["profile"]["dietary_preferences"]
        assert isinstance(prefs, list)
        assert len(prefs) == 3
        assert "vegan" in prefs
        assert "gluten-free" in prefs
        assert "nut-free" in prefs
