"""User profile-related Pydantic models."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, EmailStr, Field


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
    avatar_url: str | None = Field(default=None, description="URL to user avatar image")
    dietary_preferences: list[str] = Field(
        default_factory=list,
        description="Dietary preferences (e.g., vegetarian, gluten-free, vegan)",
    )
    allergies: list[str] = Field(
        default_factory=list,
        description=(
            "Allergies (e.g. peanut, shellfish): a hard 'never suggest' (issue #500). "
            "Never overridden by a message; enforced by a post-generation guard."
        ),
    )
    disliked_ingredients: list[str] = Field(
        default_factory=list,
        description="Ingredients to leave out of suggestions unless a message asks for one (#500)",
    )
    expiry_priority: Literal["off", "gentle", "aggressive"] = Field(
        default="gentle",
        description="How hard to push expiring food into suggestions (issue #502)",
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    model_config = ConfigDict(json_schema_extra={
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
    })


class CreateUserProfileRequest(BaseModel):
    """Request model for creating a new user profile."""

    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    display_name: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = None
    dietary_preferences: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    disliked_ingredients: list[str] = Field(default_factory=list)
    expiry_priority: Literal["off", "gentle", "aggressive"] = "gentle"


class UpdateUserProfileRequest(BaseModel):
    """Request model for updating an existing user profile."""

    username: str | None = Field(default=None, min_length=3, max_length=50)
    email: EmailStr | None = None
    display_name: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = None
    dietary_preferences: list[str] | None = None
    allergies: list[str] | None = None
    disliked_ingredients: list[str] | None = None
    expiry_priority: Literal["off", "gentle", "aggressive"] | None = None
