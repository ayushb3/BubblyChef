"""Abstract repository interface."""

from abc import ABC, abstractmethod
from typing import Any
from uuid import UUID

from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.models.recipe import RecipeCard


class Repository(ABC):
    """Abstract base class for data repository."""

    # Initialization
    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the repository (create tables, etc.)."""
        pass

    @abstractmethod
    async def close(self) -> None:
        """Close the repository connection."""
        pass

    # Pantry operations
    @abstractmethod
    async def get_pantry_item(self, item_id: UUID) -> PantryItem | None:
        """Get a single pantry item by ID."""
        pass

    @abstractmethod
    async def get_all_pantry_items(self) -> list[PantryItem]:
        """Get all pantry items."""
        pass

    @abstractmethod
    async def find_pantry_items(
        self,
        name: str | None = None,
        category: str | None = None,
        storage_location: str | None = None,
    ) -> list[PantryItem]:
        """Find pantry items matching criteria."""
        pass

    @abstractmethod
    async def add_pantry_item(self, item: PantryItem) -> PantryItem:
        """Add a new pantry item."""
        pass

    @abstractmethod
    async def update_pantry_item(self, item: PantryItem) -> PantryItem:
        """Update an existing pantry item."""
        pass

    @abstractmethod
    async def delete_pantry_item(self, item_id: UUID) -> bool:
        """Delete a pantry item. Returns True if deleted."""
        pass

    @abstractmethod
    async def find_similar_item(self, name: str) -> PantryItem | None:
        """Find a pantry item with similar name (for dedup)."""
        pass

    # Recipe operations
    @abstractmethod
    async def get_recipe(self, recipe_id: UUID) -> RecipeCard | None:
        """Get a single recipe by ID."""
        pass

    @abstractmethod
    async def get_all_recipes(self) -> list[RecipeCard]:
        """Get all recipes."""
        pass

    @abstractmethod
    async def add_recipe(self, recipe: RecipeCard) -> RecipeCard:
        """Add a new recipe."""
        pass

    @abstractmethod
    async def update_recipe(self, recipe: RecipeCard) -> RecipeCard:
        """Update an existing recipe."""
        pass

    @abstractmethod
    async def delete_recipe(self, recipe_id: UUID) -> bool:
        """Delete a recipe. Returns True if deleted."""
        pass

    # Ingestion logs
    @abstractmethod
    async def log_ingestion(
        self,
        request_id: UUID,
        intent: str,
        input_payload: dict[str, Any],
        proposal: dict[str, Any] | None,
        errors: list[str],
    ) -> None:
        """Log an ingestion request and its result."""
        pass

    @abstractmethod
    async def get_ingestion_log(self, request_id: UUID) -> dict[str, Any] | None:
        """Get an ingestion log by request ID."""
        pass
