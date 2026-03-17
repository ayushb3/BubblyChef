"""Tests for SQLiteRepository methods including new recipe and ingestion features."""

import tempfile
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.repository.sqlite import SQLiteRepository


@pytest_asyncio.fixture
async def repo():
    """Create a fresh repository for each test."""
    _, db_path = tempfile.mkstemp(suffix=".db")
    repository = SQLiteRepository(db_path=db_path)
    await repository.initialize()
    yield repository
    await repository.close()


# =========================================================================
# find_similar_item
# =========================================================================


@pytest.mark.asyncio
async def test_find_similar_item_exact_match(repo: SQLiteRepository) -> None:
    """find_similar_item returns item with matching normalized name."""
    item = PantryItem(name="Whole Milk", category=FoodCategory.DAIRY)
    await repo.add_pantry_item(item)

    found = await repo.find_similar_item("whole milk")
    assert found is not None
    assert found.name == "Whole Milk"


@pytest.mark.asyncio
async def test_find_similar_item_case_insensitive(repo: SQLiteRepository) -> None:
    """find_similar_item is case-insensitive."""
    item = PantryItem(name="Brown Rice", category=FoodCategory.DRY_GOODS)
    await repo.add_pantry_item(item)

    found = await repo.find_similar_item("BROWN RICE")
    assert found is not None
    assert found.name == "Brown Rice"


@pytest.mark.asyncio
async def test_find_similar_item_not_found(repo: SQLiteRepository) -> None:
    """find_similar_item returns None when no match."""
    found = await repo.find_similar_item("nonexistent item")
    assert found is None


# =========================================================================
# Recipe CRUD
# =========================================================================


def _make_recipe(**kwargs: object) -> RecipeCard:
    """Helper to create a test recipe."""
    defaults = {
        "title": "Test Pasta",
        "description": "A simple pasta recipe",
        "ingredients": [
            Ingredient(name="pasta", quantity=1.0, unit="lb"),
            Ingredient(name="tomato sauce", quantity=1.0, unit="jar"),
        ],
        "instructions": ["Boil pasta", "Add sauce", "Serve"],
        "prep_time_minutes": 5,
        "cook_time_minutes": 15,
        "servings": 4,
        "dietary_tags": ["vegetarian"],
    }
    defaults.update(kwargs)  # type: ignore[arg-type]
    return RecipeCard(**defaults)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_add_and_get_recipe(repo: SQLiteRepository) -> None:
    """Can add a recipe and retrieve it by ID."""
    recipe = _make_recipe()
    added = await repo.add_recipe(recipe)
    assert added.id == recipe.id

    fetched = await repo.get_recipe(recipe.id)
    assert fetched is not None
    assert fetched.title == "Test Pasta"
    assert len(fetched.ingredients) == 2
    assert fetched.ingredients[0].name == "pasta"
    assert fetched.instructions == ["Boil pasta", "Add sauce", "Serve"]
    assert fetched.dietary_tags == ["vegetarian"]


@pytest.mark.asyncio
async def test_get_recipe_not_found(repo: SQLiteRepository) -> None:
    """get_recipe returns None for missing ID."""
    result = await repo.get_recipe(uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_get_all_recipes(repo: SQLiteRepository) -> None:
    """get_all_recipes returns all stored recipes."""
    await repo.add_recipe(_make_recipe(title="Recipe A"))
    await repo.add_recipe(_make_recipe(title="Recipe B"))

    all_recipes = await repo.get_all_recipes()
    assert len(all_recipes) == 2
    titles = {r.title for r in all_recipes}
    assert titles == {"Recipe A", "Recipe B"}


@pytest.mark.asyncio
async def test_update_recipe(repo: SQLiteRepository) -> None:
    """Can update an existing recipe."""
    recipe = _make_recipe(title="Original Title")
    await repo.add_recipe(recipe)

    recipe.title = "Updated Title"
    recipe.servings = 8
    recipe.updated_at = datetime.now(UTC)
    updated = await repo.update_recipe(recipe)
    assert updated.title == "Updated Title"

    fetched = await repo.get_recipe(recipe.id)
    assert fetched is not None
    assert fetched.title == "Updated Title"
    assert fetched.servings == 8


@pytest.mark.asyncio
async def test_delete_recipe(repo: SQLiteRepository) -> None:
    """Can delete a recipe."""
    recipe = _make_recipe()
    await repo.add_recipe(recipe)

    deleted = await repo.delete_recipe(recipe.id)
    assert deleted is True

    fetched = await repo.get_recipe(recipe.id)
    assert fetched is None


@pytest.mark.asyncio
async def test_delete_recipe_not_found(repo: SQLiteRepository) -> None:
    """delete_recipe returns False for missing recipe."""
    result = await repo.delete_recipe(uuid4())
    assert result is False


# =========================================================================
# Ingestion logs
# =========================================================================


@pytest.mark.asyncio
async def test_log_and_get_ingestion(repo: SQLiteRepository) -> None:
    """Can log an ingestion and retrieve it."""
    request_id = uuid4()
    await repo.log_ingestion(
        request_id=request_id,
        intent="pantry_update",
        input_payload={"text": "I bought milk"},
        proposal={"actions": [{"name": "milk"}]},
        errors=[],
    )

    log = await repo.get_ingestion_log(request_id)
    assert log is not None
    assert log["request_id"] == str(request_id)
    assert log["intent"] == "pantry_update"
    assert log["input_payload"]["text"] == "I bought milk"
    assert log["proposal"]["actions"][0]["name"] == "milk"
    assert log["errors"] == []


@pytest.mark.asyncio
async def test_log_ingestion_with_errors(repo: SQLiteRepository) -> None:
    """Ingestion log preserves error messages."""
    request_id = uuid4()
    await repo.log_ingestion(
        request_id=request_id,
        intent="receipt_ingest_request",
        input_payload={"ocr_text": "blurry receipt"},
        proposal=None,
        errors=["OCR failed", "No items found"],
    )

    log = await repo.get_ingestion_log(request_id)
    assert log is not None
    assert log["proposal"] is None
    assert log["errors"] == ["OCR failed", "No items found"]


@pytest.mark.asyncio
async def test_get_ingestion_log_not_found(repo: SQLiteRepository) -> None:
    """get_ingestion_log returns None for missing request."""
    result = await repo.get_ingestion_log(uuid4())
    assert result is None


# =========================================================================
# update_pantry_item (both signatures)
# =========================================================================


@pytest.mark.asyncio
async def test_update_pantry_item_with_object(repo: SQLiteRepository) -> None:
    """update_pantry_item accepts a PantryItem object (full replacement)."""
    item = PantryItem(
        name="Eggs",
        category=FoodCategory.DAIRY,
        storage_location=StorageLocation.FRIDGE,
        quantity=12,
        unit="item",
    )
    await repo.add_pantry_item(item)

    item.quantity = 6
    item.updated_at = datetime.now(UTC)
    result = await repo.update_pantry_item(item)
    assert result.quantity == 6

    fetched = await repo.get_pantry_item(str(item.id))
    assert fetched is not None
    assert fetched.quantity == 6


@pytest.mark.asyncio
async def test_update_pantry_item_with_dict(repo: SQLiteRepository) -> None:
    """update_pantry_item accepts item_id + updates dict (legacy path)."""
    item = PantryItem(
        name="Butter",
        category=FoodCategory.DAIRY,
        storage_location=StorageLocation.FRIDGE,
        quantity=1,
        unit="lb",
    )
    await repo.add_pantry_item(item)

    result = await repo.update_pantry_item(
        str(item.id),
        {"quantity": 2, "unit": "lb"},
    )
    assert result.quantity == 2


@pytest.mark.asyncio
async def test_update_pantry_item_not_found(repo: SQLiteRepository) -> None:
    """update_pantry_item raises ValueError for missing item (dict path)."""
    with pytest.raises(ValueError, match="Item not found"):
        await repo.update_pantry_item("nonexistent-id", {"quantity": 1})


# =========================================================================
# Edge cases for search/filter
# =========================================================================


@pytest.mark.asyncio
async def test_search_pantry_items(repo: SQLiteRepository) -> None:
    """search_pantry_items finds items by partial name match."""
    await repo.add_pantry_item(
        PantryItem(name="Organic Milk", category=FoodCategory.DAIRY)
    )
    await repo.add_pantry_item(
        PantryItem(name="Almond Milk", category=FoodCategory.DAIRY)
    )
    await repo.add_pantry_item(
        PantryItem(name="Bread", category=FoodCategory.BAKERY)
    )

    results = await repo.search_pantry_items("milk")
    assert len(results) == 2


@pytest.mark.asyncio
async def test_get_pantry_items_filtered(repo: SQLiteRepository) -> None:
    """get_pantry_items filters by category and location."""
    await repo.add_pantry_item(
        PantryItem(
            name="Cheese",
            category=FoodCategory.DAIRY,
            storage_location=StorageLocation.FRIDGE,
        )
    )
    await repo.add_pantry_item(
        PantryItem(
            name="Frozen Peas",
            category=FoodCategory.FROZEN,
            storage_location=StorageLocation.FREEZER,
        )
    )

    dairy = await repo.get_pantry_items(category="dairy")
    assert len(dairy) == 1
    assert dairy[0].name == "Cheese"

    fridge = await repo.get_pantry_items(location="fridge")
    assert len(fridge) == 1

    both = await repo.get_pantry_items(category="dairy", location="fridge")
    assert len(both) == 1


# =========================================================================
# apply_pantry_proposal
# =========================================================================


@pytest.mark.asyncio
async def test_apply_pantry_proposal_add(repo):
    """apply_pantry_proposal adds new items."""
    actions = [
        {"action_type": "add", "item": {"name": "milk", "quantity": 2, "unit": "gallon", "category": "dairy"}},
        {"action_type": "add", "item": {"name": "eggs", "quantity": 12, "unit": "item", "category": "dairy"}},
    ]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert applied == 2
    assert failed == 0
    assert errors == []
    items = await repo.get_all_pantry_items()
    names = [i.name for i in items]
    assert "milk" in names
    assert "eggs" in names


@pytest.mark.asyncio
async def test_apply_pantry_proposal_add_existing_accumulates_quantity(repo):
    """apply_pantry_proposal adds to existing item quantity when action=add."""
    item = PantryItem(name="milk", quantity=1, unit="gallon", category=FoodCategory.DAIRY)
    await repo.add_pantry_item(item)

    actions = [{"action_type": "add", "item": {"name": "milk", "quantity": 2, "unit": "gallon", "category": "dairy"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert applied == 1
    items = await repo.get_all_pantry_items()
    milk = next(i for i in items if i.name == "milk")
    assert milk.quantity == 3.0


@pytest.mark.asyncio
async def test_apply_pantry_proposal_update_replaces_quantity(repo):
    """apply_pantry_proposal update action replaces quantity."""
    item = PantryItem(name="bread", quantity=2, unit="loaf", category=FoodCategory.BAKERY)
    await repo.add_pantry_item(item)

    actions = [{"action_type": "update", "item": {"name": "bread", "quantity": 1, "unit": "loaf", "category": "bakery"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert applied == 1
    items = await repo.get_all_pantry_items()
    bread = next(i for i in items if i.name == "bread")
    assert bread.quantity == 1.0


@pytest.mark.asyncio
async def test_apply_pantry_proposal_remove(repo):
    """apply_pantry_proposal remove action deletes the item."""
    item = PantryItem(name="yogurt", quantity=3, unit="cup", category=FoodCategory.DAIRY)
    await repo.add_pantry_item(item)

    actions = [{"action_type": "remove", "item": {"name": "yogurt", "quantity": 1, "unit": "cup", "category": "dairy"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert applied == 1
    items = await repo.get_all_pantry_items()
    assert all(i.name != "yogurt" for i in items)


@pytest.mark.asyncio
async def test_apply_pantry_proposal_use_deducts_quantity(repo):
    """apply_pantry_proposal use action deducts quantity; deletes if zero."""
    item = PantryItem(name="butter", quantity=4, unit="tbsp", category=FoodCategory.DAIRY)
    await repo.add_pantry_item(item)

    actions = [{"action_type": "use", "item": {"name": "butter", "quantity": 2, "unit": "tbsp", "category": "dairy"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert applied == 1
    items = await repo.get_all_pantry_items()
    butter = next((i for i in items if i.name == "butter"), None)
    assert butter is not None
    assert butter.quantity == 2.0


@pytest.mark.asyncio
async def test_apply_pantry_proposal_use_deletes_when_zero(repo):
    """apply_pantry_proposal use deletes item when quantity reaches zero."""
    item = PantryItem(name="cheese", quantity=1, unit="slice", category=FoodCategory.DAIRY)
    await repo.add_pantry_item(item)

    actions = [{"action_type": "use", "item": {"name": "cheese", "quantity": 1, "unit": "slice", "category": "dairy"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert applied == 1
    items = await repo.get_all_pantry_items()
    assert all(i.name != "cheese" for i in items)


@pytest.mark.asyncio
async def test_apply_pantry_proposal_remove_missing_fails(repo):
    """apply_pantry_proposal returns failure when removing a missing item."""
    actions = [{"action_type": "remove", "item": {"name": "ghost_item", "quantity": 1, "unit": "item", "category": "other"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert applied == 0
    assert failed == 1
    assert any("ghost_item" in e for e in errors)


@pytest.mark.asyncio
async def test_apply_pantry_proposal_missing_name_fails(repo):
    """apply_pantry_proposal returns failure for actions with no item name."""
    actions = [{"action_type": "add", "item": {"name": "", "quantity": 1, "unit": "item"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert failed == 1
    assert any("name" in e.lower() for e in errors)


@pytest.mark.asyncio
async def test_apply_pantry_proposal_unknown_action_fails(repo):
    """apply_pantry_proposal returns failure for unknown action_type."""
    actions = [{"action_type": "teleport", "item": {"name": "apple", "quantity": 1, "unit": "item", "category": "produce"}}]
    applied, failed, errors = await repo.apply_pantry_proposal(actions)
    assert failed == 1
    assert any("teleport" in e for e in errors)
