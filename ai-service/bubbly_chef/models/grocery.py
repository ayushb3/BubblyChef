"""Grocery-list request/response models (issue #497)."""

from typing import Literal

from pydantic import BaseModel, Field


class GroceryItemOut(BaseModel):
    """One line on the grocery list, as the API returns it (no user id)."""

    id: str
    name: str
    quantity: float | None = None
    unit: str | None = None
    category: str = "other"
    source: Literal["depleted", "expiring", "low", "meal", "manual"] = "manual"
    source_ref: str | None = None
    checked: bool = False


class RegenerateGroceryResponse(BaseModel):
    """Response for POST /v1/grocery/regenerate."""

    added: int = Field(description="Lines newly added")
    updated: int = Field(description="Generated lines refreshed in place")
    removed: int = Field(description="Stale unchecked generated/meal lines dropped")
    items: list[GroceryItemOut]


class GroceryFromMealRequest(BaseModel):
    """Body for POST /v1/grocery/from-meal."""

    meal_id: str = Field(min_length=1, description="UUID of the saved meal")


class GroceryFromMealResponse(BaseModel):
    """Response for POST /v1/grocery/from-meal."""

    to_buy: list[str] = Field(description="Everything the meal needs that the pantry lacks")
    added: list[str] = Field(description="The subset newly put on the list")
    already_on_list: list[str] = Field(description="The subset that was already there")
    items: list[GroceryItemOut]
