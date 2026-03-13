"""Tests for recipe_generator service."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import date, timedelta
from uuid import uuid4

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.services.recipe_generator import (
    AIRecipeIngredient,
    AIRecipeOutput,
    GenerateRecipeResponse,
    IngredientStatus,
    calculate_pantry_match_score,
    format_constraints,
    format_expiring_items,
    format_pantry_for_prompt,
    format_recipe_for_context,
    generate_recipe,
    match_ingredient_to_pantry,
)


class TestFormatPantryForPrompt:
    """Tests for format_pantry_for_prompt function."""

    def test_empty_pantry(self):
        """Test formatting empty pantry."""
        result = format_pantry_for_prompt([])
        assert result == "No items in pantry."

    def test_single_item_with_quantity(self):
        """Test formatting single item with quantity and unit."""
        items = [
            PantryItem(
                name="Milk",
                quantity=1,
                unit="gallon",
                storage_location=StorageLocation.FRIDGE,
            )
        ]
        result = format_pantry_for_prompt(items)
        assert "Milk" in result
        assert "1" in result
        assert "gallon" in result
        assert "[fridge]" in result

    def test_multiple_items(self):
        """Test formatting multiple items."""
        items = [
            PantryItem(name="Milk", storage_location=StorageLocation.FRIDGE),
            PantryItem(name="Chicken", storage_location=StorageLocation.FREEZER),
            PantryItem(name="Rice", storage_location=StorageLocation.PANTRY),
        ]
        result = format_pantry_for_prompt(items)
        assert "Milk" in result
        assert "Chicken" in result
        assert "Rice" in result
        assert "[fridge]" in result
        assert "[freezer]" in result
        assert "[pantry]" in result

    def test_item_without_quantity(self):
        """Test formatting item with zero quantity."""
        items = [
            PantryItem(
                name="Eggs",
                quantity=0,
                unit="dozen",
                storage_location=StorageLocation.FRIDGE,
            )
        ]
        result = format_pantry_for_prompt(items)
        assert "Eggs" in result
        # Should not crash even with 0 quantity

    def test_item_with_fractional_quantity(self):
        """Test formatting item with fractional quantity."""
        items = [
            PantryItem(
                name="Butter",
                quantity=0.5,
                unit="lb",
                storage_location=StorageLocation.FRIDGE,
            )
        ]
        result = format_pantry_for_prompt(items)
        assert "Butter" in result
        assert "0.5" in result


class TestFormatExpiringItems:
    """Tests for format_expiring_items function."""

    def test_no_expiring_items(self):
        """Test when no items are expiring."""
        items = [
            PantryItem(
                name="Rice",
                expiry_date=date.today() + timedelta(days=365),
            )
        ]
        result = format_expiring_items(items)
        assert "No items expiring soon" in result

    def test_empty_list(self):
        """Test with empty list."""
        result = format_expiring_items([])
        assert "No items expiring soon" in result

    def test_item_expiring_today(self):
        """Test item expiring today."""
        items = [
            PantryItem(
                name="Chicken",
                expiry_date=date.today(),
            )
        ]
        result = format_expiring_items(items)
        assert "Chicken" in result
        assert "TODAY" in result

    def test_item_expiring_tomorrow(self):
        """Test item expiring tomorrow."""
        items = [
            PantryItem(
                name="Milk",
                expiry_date=date.today() + timedelta(days=1),
            )
        ]
        result = format_expiring_items(items)
        assert "Milk" in result
        assert "tomorrow" in result

    def test_item_expired(self):
        """Test already expired item."""
        items = [
            PantryItem(
                name="Yogurt",
                expiry_date=date.today() - timedelta(days=1),
            )
        ]
        result = format_expiring_items(items)
        assert "Yogurt" in result
        assert "EXPIRED" in result

    def test_item_expiring_in_3_days(self):
        """Test item expiring in 3 days."""
        items = [
            PantryItem(
                name="Bread",
                expiry_date=date.today() + timedelta(days=3),
            )
        ]
        result = format_expiring_items(items)
        assert "Bread" in result
        assert "3 days" in result

    def test_multiple_expiring_items(self):
        """Test multiple items with different expiry status."""
        items = [
            PantryItem(name="Milk", expiry_date=date.today()),
            PantryItem(name="Chicken", expiry_date=date.today() + timedelta(days=1)),
            PantryItem(name="Rice", expiry_date=date.today() + timedelta(days=30)),  # Not expiring
        ]
        result = format_expiring_items(items)
        assert "Milk" in result
        assert "Chicken" in result
        assert "Rice" not in result  # Not expiring soon

    def test_item_without_expiry_date(self):
        """Test items without expiry dates are ignored."""
        items = [
            PantryItem(name="Salt"),  # No expiry
            PantryItem(name="Milk", expiry_date=date.today()),
        ]
        result = format_expiring_items(items)
        assert "Milk" in result
        assert "Salt" not in result


class TestFormatConstraints:
    """Tests for format_constraints function."""

    def test_no_constraints(self):
        """Test when no constraints are provided."""
        result = format_constraints(None)
        assert result == "None specified."

    def test_empty_constraints(self):
        """Test when constraints dict is empty."""
        result = format_constraints({})
        assert result == "None specified."

    def test_max_time_constraint(self):
        """Test max time constraint."""
        result = format_constraints({"max_time_minutes": 30})
        assert "30 minutes" in result

    def test_cuisine_constraint(self):
        """Test cuisine constraint."""
        result = format_constraints({"cuisine": "asian"})
        assert "asian" in result.lower() or "Asian" in result

    def test_dietary_list_constraint(self):
        """Test dietary constraint as list."""
        result = format_constraints({"dietary": ["vegetarian", "gluten-free"]})
        assert "vegetarian" in result
        assert "gluten-free" in result

    def test_dietary_string_constraint(self):
        """Test dietary constraint as string."""
        result = format_constraints({"dietary": "vegan"})
        assert "vegan" in result

    def test_use_expiring_constraint(self):
        """Test use_expiring constraint."""
        result = format_constraints({"use_expiring": True})
        assert "expiring" in result.lower()

    def test_servings_constraint(self):
        """Test servings constraint."""
        result = format_constraints({"servings": 4})
        assert "4" in result

    def test_multiple_constraints(self):
        """Test multiple constraints together."""
        result = format_constraints({
            "max_time_minutes": 45,
            "cuisine": "italian",
            "dietary": ["vegetarian"],
            "servings": 6,
        })
        assert "45" in result
        assert "italian" in result.lower() or "Italian" in result
        assert "vegetarian" in result
        assert "6" in result


class TestFormatRecipeForContext:
    """Tests for format_recipe_for_context function."""

    def test_basic_recipe(self):
        """Test formatting a basic recipe."""
        recipe = RecipeCard(
            title="Test Recipe",
            description="A test description",
            ingredients=[
                Ingredient(name="chicken", quantity=1, unit="lb"),
                Ingredient(name="salt", quantity=1, unit="tsp"),
            ],
            instructions=["Step 1", "Step 2"],
        )
        result = format_recipe_for_context(recipe)
        assert "Test Recipe" in result
        assert "A test description" in result
        assert "chicken" in result
        assert "salt" in result
        assert "Step 1" in result
        assert "Step 2" in result

    def test_recipe_with_preparation(self):
        """Test formatting recipe with ingredient preparation notes."""
        recipe = RecipeCard(
            title="Stir Fry",
            ingredients=[
                Ingredient(name="chicken", quantity=1, unit="lb", preparation="sliced"),
            ],
            instructions=["Cook it"],
        )
        result = format_recipe_for_context(recipe)
        assert "sliced" in result

    def test_recipe_with_optional_ingredient(self):
        """Test formatting recipe with optional ingredient."""
        recipe = RecipeCard(
            title="Soup",
            ingredients=[
                Ingredient(name="parsley", quantity=1, unit="tbsp", optional=True),
            ],
            instructions=["Make soup"],
        )
        result = format_recipe_for_context(recipe)
        assert "optional" in result.lower()


class TestMatchIngredientToPantry:
    """Tests for ingredient matching logic."""

    def test_exact_match(self):
        """Test exact name match."""
        pantry = [
            PantryItem(name="Chicken Breast", quantity=2, unit="lb"),
        ]
        ingredient = Ingredient(name="chicken breast", quantity=1, unit="lb")

        status = match_ingredient_to_pantry(ingredient, pantry)

        assert status.status == "have"
        assert status.pantry_item_name == "Chicken Breast"

    def test_partial_match_ingredient_in_pantry(self):
        """Test partial name match - ingredient substring of pantry item."""
        pantry = [
            PantryItem(name="Organic Chicken Breast", quantity=2, unit="lb"),
        ]
        ingredient = Ingredient(name="chicken", quantity=1, unit="lb")

        status = match_ingredient_to_pantry(ingredient, pantry)

        assert status.status == "have"

    def test_partial_match_pantry_in_ingredient(self):
        """Test partial name match - pantry item substring of ingredient."""
        pantry = [
            PantryItem(name="Chicken", quantity=2, unit="lb"),
        ]
        ingredient = Ingredient(name="chicken breast", quantity=1, unit="lb")

        status = match_ingredient_to_pantry(ingredient, pantry)

        assert status.status == "have"

    def test_no_match(self):
        """Test when ingredient not in pantry."""
        pantry = [
            PantryItem(name="Milk"),
        ]
        ingredient = Ingredient(name="eggs", quantity=2, unit="count")

        status = match_ingredient_to_pantry(ingredient, pantry)

        assert status.status == "missing"
        assert status.need_quantity == 2

    def test_partial_quantity(self):
        """Test when pantry has less than needed."""
        pantry = [
            PantryItem(name="Eggs", quantity=6, unit="count"),
        ]
        ingredient = Ingredient(name="eggs", quantity=12, unit="count")

        status = match_ingredient_to_pantry(ingredient, pantry)

        assert status.status == "partial"
        assert status.have_quantity == 6
        assert status.need_quantity == 12

    def test_empty_pantry(self):
        """Test with empty pantry."""
        ingredient = Ingredient(name="flour", quantity=1, unit="cup")

        status = match_ingredient_to_pantry(ingredient, [])

        assert status.status == "missing"

    def test_word_overlap_match(self):
        """Test matching based on word overlap."""
        pantry = [
            PantryItem(name="Fresh Basil Leaves", quantity=1, unit="bunch"),
        ]
        ingredient = Ingredient(name="basil", quantity=1, unit="tbsp")

        status = match_ingredient_to_pantry(ingredient, pantry)

        assert status.status == "have"

    def test_no_match_unrelated_words(self):
        """Test no match for unrelated items."""
        pantry = [
            PantryItem(name="Apples", quantity=5, unit="count"),
        ]
        ingredient = Ingredient(name="oranges", quantity=3, unit="count")

        status = match_ingredient_to_pantry(ingredient, pantry)

        assert status.status == "missing"


class TestCalculatePantryMatchScore:
    """Tests for pantry match score calculation."""

    def test_all_have(self):
        """Test score when all ingredients are available."""
        statuses = [
            IngredientStatus(ingredient_name="A", status="have"),
            IngredientStatus(ingredient_name="B", status="have"),
        ]
        assert calculate_pantry_match_score(statuses) == 1.0

    def test_all_missing(self):
        """Test score when all ingredients are missing."""
        statuses = [
            IngredientStatus(ingredient_name="A", status="missing"),
            IngredientStatus(ingredient_name="B", status="missing"),
        ]
        assert calculate_pantry_match_score(statuses) == 0.0

    def test_mixed(self):
        """Test score with mixed availability."""
        statuses = [
            IngredientStatus(ingredient_name="A", status="have"),
            IngredientStatus(ingredient_name="B", status="partial"),
            IngredientStatus(ingredient_name="C", status="missing"),
        ]
        # (1.0 + 0.5 + 0) / 3 = 0.5
        assert calculate_pantry_match_score(statuses) == 0.5

    def test_empty(self):
        """Test score with no ingredients."""
        assert calculate_pantry_match_score([]) == 0.0

    def test_all_partial(self):
        """Test score when all ingredients are partial."""
        statuses = [
            IngredientStatus(ingredient_name="A", status="partial"),
            IngredientStatus(ingredient_name="B", status="partial"),
        ]
        assert calculate_pantry_match_score(statuses) == 0.5

    def test_single_have(self):
        """Test score with single available ingredient."""
        statuses = [
            IngredientStatus(ingredient_name="A", status="have"),
        ]
        assert calculate_pantry_match_score(statuses) == 1.0

    def test_single_missing(self):
        """Test score with single missing ingredient."""
        statuses = [
            IngredientStatus(ingredient_name="A", status="missing"),
        ]
        assert calculate_pantry_match_score(statuses) == 0.0


class TestGenerateRecipe:
    """Integration tests for recipe generation."""

    @pytest.fixture
    def mock_ai_manager(self):
        """Create mock AI manager."""
        manager = MagicMock()
        manager.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Test Recipe",
                description="A test recipe",
                prep_time_minutes=10,
                cook_time_minutes=20,
                servings=4,
                ingredients=[
                    AIRecipeIngredient(name="chicken", quantity=1, unit="lb"),
                    AIRecipeIngredient(name="garlic", quantity=3, unit="cloves"),
                ],
                instructions=["Step 1", "Step 2"],
                tips=["Tip 1"],
                cuisine="American",
                difficulty="easy",
            )
        )
        return manager

    @pytest.fixture
    def sample_pantry(self):
        """Create sample pantry items."""
        return [
            PantryItem(
                name="Chicken Breast",
                quantity=2,
                unit="lb",
                storage_location=StorageLocation.FRIDGE,
                expiry_date=date.today() + timedelta(days=2),
            ),
            PantryItem(
                name="Garlic",
                quantity=1,
                unit="head",
                storage_location=StorageLocation.COUNTER,
            ),
        ]

    @pytest.mark.asyncio
    async def test_generate_recipe_success(self, mock_ai_manager, sample_pantry):
        """Test successful recipe generation."""
        result = await generate_recipe(
            prompt="Make dinner",
            pantry_items=sample_pantry,
            ai_manager=mock_ai_manager,
        )

        assert result.recipe.title == "Test Recipe"
        assert len(result.recipe.ingredients) == 2
        assert result.have_count >= 0
        assert 0.0 <= result.pantry_match_score <= 1.0

    @pytest.mark.asyncio
    async def test_generate_recipe_empty_pantry(self, mock_ai_manager):
        """Test generation with empty pantry."""
        result = await generate_recipe(
            prompt="Make anything",
            pantry_items=[],
            ai_manager=mock_ai_manager,
        )

        assert result.recipe is not None
        assert result.missing_count == 2  # All ingredients missing

    @pytest.mark.asyncio
    async def test_generate_recipe_with_constraints(self, mock_ai_manager, sample_pantry):
        """Test generation with constraints."""
        result = await generate_recipe(
            prompt="Quick dinner",
            pantry_items=sample_pantry,
            ai_manager=mock_ai_manager,
            constraints={
                "max_time_minutes": 30,
                "cuisine": "asian",
                "dietary": ["gluten-free"],
            },
        )

        # Verify AI was called
        mock_ai_manager.complete.assert_called_once()
        call_kwargs = mock_ai_manager.complete.call_args.kwargs
        assert "30 minutes" in call_kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_generate_recipe_calculates_total_time(self, mock_ai_manager, sample_pantry):
        """Test that total time is calculated correctly."""
        result = await generate_recipe(
            prompt="Make dinner",
            pantry_items=sample_pantry,
            ai_manager=mock_ai_manager,
        )

        # 10 prep + 20 cook = 30 total
        assert result.recipe.total_time_minutes == 30

    @pytest.mark.asyncio
    async def test_generate_recipe_with_followup(self, mock_ai_manager, sample_pantry):
        """Test recipe generation as a follow-up to previous recipe."""
        previous_recipe = RecipeCard(
            title="Original Recipe",
            ingredients=[Ingredient(name="chicken", quantity=1, unit="lb")],
            instructions=["Cook it"],
        )

        result = await generate_recipe(
            prompt="Make it spicier",
            pantry_items=sample_pantry,
            ai_manager=mock_ai_manager,
            previous_recipe=previous_recipe,
        )

        assert result.recipe is not None
        # Verify follow-up prompt was used
        call_kwargs = mock_ai_manager.complete.call_args.kwargs
        assert "Original Recipe" in call_kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_generate_recipe_matches_pantry_items(self, mock_ai_manager, sample_pantry):
        """Test that generated recipe ingredients are matched to pantry."""
        result = await generate_recipe(
            prompt="Make dinner",
            pantry_items=sample_pantry,
            ai_manager=mock_ai_manager,
        )

        # Check ingredient statuses
        assert len(result.ingredients_status) == 2
        chicken_status = next(
            s for s in result.ingredients_status if "chicken" in s.ingredient_name.lower()
        )
        assert chicken_status.status == "have"

    @pytest.mark.asyncio
    async def test_generate_recipe_counts_statuses(self, mock_ai_manager, sample_pantry):
        """Test that status counts are accurate."""
        result = await generate_recipe(
            prompt="Make dinner",
            pantry_items=sample_pantry,
            ai_manager=mock_ai_manager,
        )

        total = result.have_count + result.partial_count + result.missing_count
        assert total == len(result.ingredients_status)


class TestIngredientStatus:
    """Tests for IngredientStatus model."""

    def test_create_have_status(self):
        """Test creating a 'have' status."""
        status = IngredientStatus(
            ingredient_name="chicken",
            status="have",
            pantry_item_name="Chicken Breast",
            have_quantity=2,
            have_unit="lb",
        )
        assert status.status == "have"
        assert status.pantry_item_name == "Chicken Breast"

    def test_create_missing_status(self):
        """Test creating a 'missing' status."""
        status = IngredientStatus(
            ingredient_name="soy sauce",
            status="missing",
            need_quantity=2,
            need_unit="tbsp",
        )
        assert status.status == "missing"
        assert status.need_quantity == 2

    def test_create_partial_status(self):
        """Test creating a 'partial' status."""
        status = IngredientStatus(
            ingredient_name="eggs",
            status="partial",
            pantry_item_name="Eggs",
            have_quantity=6,
            have_unit="count",
            need_quantity=12,
            need_unit="count",
        )
        assert status.status == "partial"
        assert status.have_quantity == 6
        assert status.need_quantity == 12
