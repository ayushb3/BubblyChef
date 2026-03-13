"""User profile-related Pydantic models."""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, EmailStr, Field


class UserProfile(BaseModel):
    """Represents a user profile."""

    id: UUID = Field(default_factory=uuid4, description="Unique user identifier")
    username: str = Field(min_length=3, max_length=50, description="Unique username")
    email: EmailStr = Field(description="User email address")
    display_name: str | None = Field(
        default=None,
        max_length=100,
        description="Display name shown in UI (optional)",
    )
    avatar_url: str | None = Field(
        default=None, description="URL to user avatar image"
    )
    dietary_preferences: list[str] = Field(
        default_factory=list,
        description="Dietary preferences (e.g., vegetarian, gluten-free, vegan)",
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic model configuration."""

        json_schema_extra = {
            "example": {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "username": "foodie123",
                "email": "foodie@example.com",
                "display_name": "Chef Foodie",
                "avatar_url": "https://example.com/avatar.jpg",
                "dietary_preferences": ["vegetarian", "gluten-free"],
                "created_at": "2026-03-10T12:00:00Z",
                "updated_at": "2026-03-10T12:00:00Z",
            }
        }


class CreateUserProfileRequest(BaseModel):
    """Request model for creating a new user profile."""

    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    display_name: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = None
    dietary_preferences: list[str] = Field(default_factory=list)


class UpdateUserProfileRequest(BaseModel):
    """Request model for updating an existing user profile."""

    username: str | None = Field(default=None, min_length=3, max_length=50)
    email: EmailStr | None = None
    display_name: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = None
    dietary_preferences: list[str] | None = None
