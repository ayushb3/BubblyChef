"""User profile endpoints."""

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from bubbly_chef.models.user import (
    CreateUserProfileRequest,
    UpdateUserProfileRequest,
    UserProfile,
)
from bubbly_chef.repository.sqlite import get_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/profile", tags=["Profile"])


class ProfileResponse(BaseModel):
    """Response for single profile endpoint."""

    profile: UserProfile


@router.get(
    "/{profile_id}",
    response_model=ProfileResponse,
    summary="Get a user profile by ID",
)
async def get_profile(profile_id: UUID) -> ProfileResponse:
    """
    Get a user profile by ID.

    Returns the full profile information including dietary preferences.
    """
    repo = await get_repository()
    profile = await repo.get_profile_by_id(str(profile_id))

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    return ProfileResponse(profile=profile)


@router.get(
    "/email/{email}",
    response_model=ProfileResponse,
    summary="Get a user profile by email",
)
async def get_profile_by_email(email: str) -> ProfileResponse:
    """
    Get a user profile by email address.

    Useful for login flows or checking if an email is already registered.
    """
    repo = await get_repository()
    profile = await repo.get_profile_by_email(email)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    return ProfileResponse(profile=profile)


@router.get(
    "/username/{username}",
    response_model=ProfileResponse,
    summary="Get a user profile by username",
)
async def get_profile_by_username(username: str) -> ProfileResponse:
    """
    Get a user profile by username.

    Useful for profile lookups or checking username availability.
    """
    repo = await get_repository()
    profile = await repo.get_profile_by_username(username)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    return ProfileResponse(profile=profile)


@router.post(
    "",
    response_model=ProfileResponse,
    summary="Create a new user profile",
    status_code=201,
)
async def create_profile(request: CreateUserProfileRequest) -> ProfileResponse:
    """
    Create a new user profile.

    - **username**: Unique username (3-50 characters)
    - **email**: Unique email address
    - **display_name**: Optional display name
    - **avatar_url**: Optional avatar image URL
    - **dietary_preferences**: Optional list of dietary preferences

    Returns the created profile with generated ID and timestamps.
    """
    logger.info(f"Creating profile for user: {request.username}")

    repo = await get_repository()

    # Create profile model
    profile = UserProfile(
        username=request.username,
        email=request.email,
        display_name=request.display_name,
        avatar_url=request.avatar_url,
        dietary_preferences=request.dietary_preferences,
    )

    try:
        created_profile = await repo.create_profile(profile)
        logger.info(f"Profile created: {created_profile.id}")
        return ProfileResponse(profile=created_profile)
    except ValueError as e:
        # Handle duplicate username/email
        logger.error(f"Failed to create profile: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.put(
    "/{profile_id}",
    response_model=ProfileResponse,
    summary="Update a user profile",
)
async def update_profile(
    profile_id: UUID, request: UpdateUserProfileRequest
) -> ProfileResponse:
    """
    Update an existing user profile.

    All fields are optional - only provided fields will be updated.

    - **username**: New username (must be unique)
    - **email**: New email address (must be unique)
    - **display_name**: New display name
    - **avatar_url**: New avatar image URL
    - **dietary_preferences**: New list of dietary preferences (replaces existing)

    Returns the updated profile.
    """
    logger.info(f"Updating profile: {profile_id}")

    repo = await get_repository()

    # Check if profile exists
    existing_profile = await repo.get_profile_by_id(str(profile_id))
    if not existing_profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Build updates dict (only include provided fields)
    updates: dict[str, Any] = {}
    if request.username is not None:
        updates["username"] = request.username
    if request.email is not None:
        updates["email"] = request.email
    if request.display_name is not None:
        updates["display_name"] = request.display_name
    if request.avatar_url is not None:
        updates["avatar_url"] = request.avatar_url
    if request.dietary_preferences is not None:
        updates["dietary_preferences"] = request.dietary_preferences

    if not updates:
        # No updates provided, return existing profile
        return ProfileResponse(profile=existing_profile)

    try:
        updated_profile = await repo.update_profile(str(profile_id), updates)
        logger.info(f"Profile updated: {profile_id}")
        return ProfileResponse(profile=updated_profile)
    except ValueError as e:
        # Handle duplicate username/email or not found
        logger.error(f"Failed to update profile: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/{profile_id}",
    summary="Delete a user profile",
)
async def delete_profile(profile_id: UUID) -> dict[str, Any]:
    """
    Delete a user profile by ID.

    This permanently removes the profile from the database.
    """
    logger.info(f"Deleting profile: {profile_id}")

    repo = await get_repository()

    deleted = await repo.delete_profile(str(profile_id))

    if not deleted:
        raise HTTPException(status_code=404, detail="Profile not found")

    logger.info(f"Profile deleted: {profile_id}")
    return {"success": True, "deleted_id": str(profile_id)}
