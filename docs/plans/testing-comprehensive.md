# Comprehensive API Testing Plan

**Created:** 2026-03-13
**Phase:** Cross-cutting (applies to all phases)
**Priority:** High
**Status:** Planning

---

## Motivation

Strong tests are essential for vibe coding. When moving fast, comprehensive test coverage:

1. **Catches bugs early** - Before they reach production
2. **Enables confident refactoring** - Change code without fear
3. **Documents behavior** - Tests show how code should work
4. **Prevents regressions** - Ensure fixes stay fixed

### Recent Bug Example

During development, we discovered a critical bug in recipe generation:

```
AttributeError: 'PantryItem' object has no attribute 'location'
```

**Root Cause:** Model/service mismatch - `recipe_generator.py` expected `item.location` but model has `storage_location`.

**This plan establishes comprehensive testing to prevent ALL similar issues across the entire codebase.**

---

## Current State

### Existing Tests ✅
| File | Coverage | Notes |
|------|----------|-------|
| `tests/api/test_pantry.py` | Good | CRUD + filters |
| `tests/api/test_scan.py` | Good | OCR + receipt parsing |
| `tests/api/test_profile.py` | Basic | Profile CRUD |
| `tests/domain/test_normalizer.py` | Good | Name normalization |
| `tests/domain/test_expiry.py` | Good | Expiry estimation |

### Missing Tests ❌
| Area | Gap |
|------|-----|
| `routes/recipes.py` | **0 tests** - No coverage for recipe generation |
| `routes/chat.py` | **0 tests** - No coverage for chat workflow |
| `services/recipe_generator.py` | **0 tests** - The source of the current bug |
| Integration tests | None - No end-to-end flow tests |
| Model consistency | No tests verifying model ↔ service compatibility |

---

## Bug Fix Required

Before implementing tests, fix the model/service mismatch:

### Option A: Add computed properties to PantryItem (Recommended)

```python
# bubbly_chef/models/pantry.py
class PantryItem(BaseModel):
    # ... existing fields ...

    @property
    def location(self) -> StorageLocation:
        """Alias for storage_location (backward compatibility)."""
        return self.storage_location

    @property
    def name_normalized(self) -> str:
        """Return normalized name for matching."""
        return self.name.lower().strip()

    @property
    def days_until_expiry(self) -> int | None:
        """Calculate days until expiry."""
        if self.expiry_date is None:
            return None
        return (self.expiry_date - date.today()).days

    @property
    def is_expiring_soon(self) -> bool:
        """Check if item expires within 3 days."""
        days = self.days_until_expiry
        return days is not None and 0 <= days <= 3

    @property
    def is_expired(self) -> bool:
        """Check if item is expired."""
        days = self.days_until_expiry
        return days is not None and days < 0
```

### Option B: Update recipe_generator.py to use correct field names

```python
# Change line 178 from:
line += f" [{item.location.value}]"
# To:
line += f" [{item.storage_location.value}]"
```

**Decision:** Use Option A - Adding properties provides better API ergonomics and backward compatibility.

---

## Testing Packages

### Already Installed ✅
```toml
[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=4.1.0",
    "httpx>=0.26.0",
]
```

### Add to pyproject.toml
```toml
[project.optional-dependencies]
dev = [
    # Existing
    "pytest>=7.4.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=4.1.0",
    "httpx>=0.26.0",
    "ruff>=0.1.0",
    "mypy>=1.8.0",
    # New additions
    "pytest-xdist>=3.5.0",      # Parallel test execution
    "pytest-mock>=3.12.0",      # Enhanced mocking
    "pytest-timeout>=2.2.0",    # Timeout for AI calls
    "respx>=0.20.0",            # Mock HTTP requests
    "hypothesis>=6.90.0",       # Property-based testing
    "faker>=22.0.0",            # Fake data generation
]
```

---

## Test Structure

```
tests/
├── conftest.py                      # ✅ Exists - enhance with more fixtures
├── fixtures/                        # 🆕 NEW
│   ├── __init__.py
│   ├── pantry_items.py             # Sample pantry data
│   ├── ai_responses.py             # Mock AI responses
│   └── receipts/                   # Sample receipt images
│       └── sample_receipt.png
│
├── api/                             # Endpoint tests
│   ├── __init__.py                 # ✅ Exists
│   ├── test_pantry.py              # ✅ Exists
│   ├── test_scan.py                # ✅ Exists
│   ├── test_profile.py             # ✅ Exists
│   ├── test_recipes.py             # 🆕 NEW - HIGH PRIORITY
│   ├── test_chat.py                # 🆕 NEW
│   ├── test_ingest.py              # 🆕 NEW
│   └── test_apply.py               # 🆕 NEW
│
├── domain/                          # Business logic tests
│   ├── __init__.py                 # ✅ Exists
│   ├── test_normalizer.py          # ✅ Exists
│   ├── test_expiry.py              # ✅ Exists
│   └── test_defaults.py            # 🆕 NEW
│
├── services/                        # Service layer tests
│   ├── __init__.py                 # 🆕 NEW
│   ├── test_recipe_generator.py    # 🆕 NEW - HIGH PRIORITY
│   ├── test_receipt_parser.py      # 🆕 NEW (isolated service tests)
│   └── test_image_preprocessor.py  # 🆕 NEW
│
├── models/                          # Model tests
│   ├── __init__.py                 # 🆕 NEW
│   ├── test_pantry_item.py         # 🆕 NEW - Tests computed properties
│   └── test_recipe.py              # 🆕 NEW
│
├── integration/                     # End-to-end flows
│   ├── __init__.py                 # 🆕 NEW
│   ├── test_receipt_to_pantry.py   # Full receipt scan flow
│   ├── test_recipe_generation.py   # Recipe with pantry context
│   └── test_chat_workflows.py      # Chat → pantry updates
│
└── performance/                     # Performance tests
    ├── __init__.py                 # 🆕 NEW
    └── test_response_times.py      # API latency benchmarks
```

---

## Test Implementation Plan

### Phase 1: Fix Bug + Model Tests (Day 1)

#### 1.1 Add computed properties to PantryItem

```python
# tests/models/test_pantry_item.py

import pytest
from datetime import date, timedelta
from bubbly_chef.models.pantry import PantryItem, FoodCategory, StorageLocation


class TestPantryItemProperties:
    """Test computed properties on PantryItem."""

    def test_location_alias(self):
        """Test that .location returns storage_location value."""
        item = PantryItem(
            name="Milk",
            storage_location=StorageLocation.FRIDGE,
        )
        assert item.location == StorageLocation.FRIDGE
        assert item.location.value == "fridge"

    def test_name_normalized(self):
        """Test normalized name property."""
        item = PantryItem(name="  Organic MILK  ")
        assert item.name_normalized == "organic milk"

    def test_days_until_expiry_future(self):
        """Test days_until_expiry with future date."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() + timedelta(days=5),
        )
        assert item.days_until_expiry == 5

    def test_days_until_expiry_today(self):
        """Test days_until_expiry when expiring today."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today(),
        )
        assert item.days_until_expiry == 0

    def test_days_until_expiry_past(self):
        """Test days_until_expiry with past date (expired)."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() - timedelta(days=2),
        )
        assert item.days_until_expiry == -2

    def test_days_until_expiry_none(self):
        """Test days_until_expiry when no expiry set."""
        item = PantryItem(name="Rice")
        assert item.days_until_expiry is None

    def test_is_expiring_soon_true(self):
        """Test is_expiring_soon returns True within 3 days."""
        item = PantryItem(
            name="Chicken",
            expiry_date=date.today() + timedelta(days=2),
        )
        assert item.is_expiring_soon is True

    def test_is_expiring_soon_false(self):
        """Test is_expiring_soon returns False beyond 3 days."""
        item = PantryItem(
            name="Canned Beans",
            expiry_date=date.today() + timedelta(days=30),
        )
        assert item.is_expiring_soon is False

    def test_is_expiring_soon_no_expiry(self):
        """Test is_expiring_soon returns False when no expiry."""
        item = PantryItem(name="Salt")
        assert item.is_expiring_soon is False

    def test_is_expired_true(self):
        """Test is_expired returns True for past dates."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() - timedelta(days=1),
        )
        assert item.is_expired is True

    def test_is_expired_false(self):
        """Test is_expired returns False for future dates."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() + timedelta(days=1),
        )
        assert item.is_expired is False

    def test_is_expired_today(self):
        """Test is_expired returns False for today (still valid)."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today(),
        )
        assert item.is_expired is False
```

### Phase 2: Recipe Generator Tests (Day 1-2)

#### 2.1 Service unit tests

```python
# tests/services/test_recipe_generator.py

import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import date, timedelta

from bubbly_chef.models.pantry import PantryItem, FoodCategory, StorageLocation
from bubbly_chef.services.recipe_generator import (
    format_pantry_for_prompt,
    format_expiring_items,
    format_constraints,
    match_ingredient_to_pantry,
    calculate_pantry_match_score,
    generate_recipe,
    IngredientStatus,
)
from bubbly_chef.models.recipe import Ingredient


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
        assert "1" in result or "1.0" in result
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
        """Test formatting item without quantity (uses default)."""
        items = [
            PantryItem(
                name="Eggs",
                quantity=0,  # No quantity
                unit="dozen",
                storage_location=StorageLocation.FRIDGE,
            )
        ]
        result = format_pantry_for_prompt(items)
        assert "Eggs" in result
        # Should not crash even with 0 quantity


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

    def test_partial_match(self):
        """Test partial name match."""
        pantry = [
            PantryItem(name="Organic Chicken Breast", quantity=2, unit="lb"),
        ]
        ingredient = Ingredient(name="chicken", quantity=1, unit="lb")

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


class TestGenerateRecipe:
    """Integration tests for recipe generation."""

    @pytest.fixture
    def mock_ai_manager(self):
        """Create mock AI manager."""
        from bubbly_chef.services.recipe_generator import AIRecipeOutput, AIRecipeIngredient

        manager = MagicMock()
        manager.complete = AsyncMock(return_value=AIRecipeOutput(
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
        ))
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

        # Verify AI was called (constraints are in prompt)
        mock_ai_manager.complete.assert_called_once()
        call_args = mock_ai_manager.complete.call_args
        assert "30 minutes" in call_args.kwargs["prompt"]
```

### Phase 3: API Endpoint Tests (Day 2-3)

#### 3.1 Recipe endpoint tests

```python
# tests/api/test_recipes.py

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient


class TestRecipeGeneration:
    """Tests for POST /api/recipes/generate"""

    @pytest.fixture
    def mock_generate_recipe(self):
        """Mock the generate_recipe service."""
        with patch("bubbly_chef.api.routes.recipes.generate_recipe") as mock:
            from bubbly_chef.services.recipe_generator import GenerateRecipeResponse
            from bubbly_chef.models.recipe import RecipeCard, Ingredient

            mock.return_value = GenerateRecipeResponse(
                recipe=RecipeCard(
                    title="Test Recipe",
                    description="Test description",
                    ingredients=[Ingredient(name="chicken", quantity=1, unit="lb")],
                    instructions=["Cook it"],
                ),
                ingredients_status=[],
                missing_count=0,
                have_count=1,
                partial_count=0,
                pantry_match_score=1.0,
            )
            yield mock

    @pytest.mark.asyncio
    async def test_generate_recipe_success(self, client: AsyncClient, mock_generate_recipe):
        """Test successful recipe generation."""
        response = await client.post(
            "/api/recipes/generate",
            json={"prompt": "Make dinner with chicken"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "recipe" in data
        assert data["recipe"]["title"] == "Test Recipe"
        assert "pantry_match_score" in data

    @pytest.mark.asyncio
    async def test_generate_recipe_with_constraints(self, client: AsyncClient, mock_generate_recipe):
        """Test recipe generation with constraints."""
        response = await client.post(
            "/api/recipes/generate",
            json={
                "prompt": "Quick healthy meal",
                "constraints": {
                    "max_time_minutes": 30,
                    "dietary": ["vegetarian"],
                },
            },
        )

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_recipe_empty_prompt_fails(self, client: AsyncClient):
        """Test that empty prompt returns 422."""
        response = await client.post(
            "/api/recipes/generate",
            json={"prompt": ""},
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_generate_recipe_ai_failure_returns_500(self, client: AsyncClient):
        """Test that AI failure returns 500."""
        with patch("bubbly_chef.api.routes.recipes.generate_recipe") as mock:
            mock.side_effect = Exception("AI service unavailable")

            response = await client.post(
                "/api/recipes/generate",
                json={"prompt": "Make dinner"},
            )

            assert response.status_code == 500
            assert "failed" in response.json()["detail"].lower()


class TestRecipeSuggestions:
    """Tests for GET /api/recipes/suggestions"""

    @pytest.mark.asyncio
    async def test_suggestions_returns_list(self, client: AsyncClient):
        """Test that suggestions returns a list."""
        response = await client.get("/api/recipes/suggestions")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 5

    @pytest.mark.asyncio
    async def test_suggestions_with_expiring_items(self, client: AsyncClient):
        """Test suggestions include expiring item prompts."""
        # Add an expiring item first
        from datetime import date, timedelta

        await client.post(
            "/api/pantry",
            json={
                "name": "Chicken",
                "quantity": 1,
                "unit": "lb",
                "expiry_date": (date.today() + timedelta(days=2)).isoformat(),
            },
        )

        response = await client.get("/api/recipes/suggestions")

        assert response.status_code == 200
        data = response.json()
        # Should have suggestion about expiring chicken
        assert any("chicken" in s.lower() or "expires" in s.lower() for s in data)
```

### Phase 4: Integration Tests (Day 3-4)

```python
# tests/integration/test_recipe_generation.py

import pytest
from datetime import date, timedelta
from httpx import AsyncClient


class TestRecipeGenerationFlow:
    """End-to-end recipe generation tests."""

    @pytest.mark.asyncio
    async def test_full_recipe_flow_with_pantry(self, client: AsyncClient):
        """Test complete flow: add items → generate recipe → check matching."""
        # Step 1: Add pantry items
        items = [
            {"name": "Chicken Breast", "quantity": 2, "unit": "lb"},
            {"name": "Garlic", "quantity": 1, "unit": "head"},
            {"name": "Olive Oil", "quantity": 1, "unit": "bottle"},
        ]

        for item in items:
            response = await client.post("/api/pantry", json=item)
            assert response.status_code == 201

        # Step 2: Verify pantry has items
        pantry_response = await client.get("/api/pantry")
        assert pantry_response.json()["total_count"] == 3

        # Step 3: Generate recipe (with mocked AI)
        # Note: In real integration test, would use actual AI or realistic mock

        # Step 4: Verify ingredient status reflects pantry

    @pytest.mark.asyncio
    async def test_expiring_items_prioritized(self, client: AsyncClient):
        """Test that expiring items appear in recipe generation context."""
        # Add item expiring soon
        await client.post(
            "/api/pantry",
            json={
                "name": "Fresh Salmon",
                "quantity": 1,
                "unit": "lb",
                "expiry_date": (date.today() + timedelta(days=1)).isoformat(),
            },
        )

        # Recipe generation should prioritize salmon
        # (verified through mocked AI receiving correct prompt)
```

---

## Coverage Configuration

Add to `pyproject.toml`:

```toml
[tool.coverage.run]
source = ["bubbly_chef"]
branch = true
omit = [
    "*/tests/*",
    "*/__init__.py",
    "*/cli/*",
]

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
    "@abstractmethod",
]
fail_under = 80
show_missing = true
skip_covered = false

[tool.coverage.html]
directory = "htmlcov"
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: |
          pip install -e ".[dev]"

      - name: Run tests with coverage
        run: |
          pytest --cov=bubbly_chef --cov-report=xml --cov-report=html -v

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml
          fail_ci_if_error: true
```

---

## Running Tests

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run all tests
pytest

# Run with coverage report
pytest --cov=bubbly_chef --cov-report=html --cov-report=term-missing

# Run in parallel (faster)
pytest -n auto

# Run specific test file
pytest tests/services/test_recipe_generator.py -v

# Run with timeout (prevent hanging on AI)
pytest --timeout=30

# Run only tests matching pattern
pytest -k "test_recipe"

# Generate HTML coverage report
pytest --cov=bubbly_chef --cov-report=html
# Open htmlcov/index.html in browser
```

---

## Implementation Tasks

### Immediate (Fix the Bug)
- [x] Add computed properties to `PantryItem` model
- [x] Write model tests (`tests/models/test_pantry_item.py`)
- [x] Verify recipe generation works

### Week 1: Core Tests
- [x] Add new test packages to `pyproject.toml`
- [x] Create `tests/services/test_recipe_generator.py`
- [x] Create `tests/api/test_recipes.py`
- [ ] Achieve 80% coverage on recipe module

### Week 2: Expand Coverage
- [ ] Create `tests/api/test_chat.py`
- [ ] Create `tests/integration/` directory with flow tests
- [x] Add mock fixtures for AI responses
- [ ] Set up coverage reporting in CI

### Ongoing
- [ ] Maintain 80%+ coverage
- [ ] Add tests for every new endpoint
- [ ] Run tests before every PR merge

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Overall code coverage | > 80% | ~40% (estimated) |
| Recipe module coverage | > 90% | 0% |
| Chat module coverage | > 85% | 0% |
| Test execution time | < 60s | ~10s |
| Flaky test rate | < 1% | N/A |

---

## Complete Test Matrix

### All API Endpoints to Test

| Endpoint | Method | Test File | Priority |
|----------|--------|-----------|----------|
| `/health` | GET | `test_pantry.py` ✅ | Done |
| `/health/ai` | GET | `test_pantry.py` ✅ | Done |
| `/api/pantry` | GET | `test_pantry.py` ✅ | Done |
| `/api/pantry` | POST | `test_pantry.py` ✅ | Done |
| `/api/pantry/{id}` | GET | `test_pantry.py` ✅ | Done |
| `/api/pantry/{id}` | PUT | `test_pantry.py` ✅ | Done |
| `/api/pantry/{id}` | DELETE | `test_pantry.py` ✅ | Done |
| `/api/pantry/expiring` | GET | `test_pantry.py` ✅ | Done |
| `/api/scan/ocr-status` | GET | `test_scan.py` ✅ | Done |
| `/api/scan/receipt` | POST | `test_scan.py` ✅ | Done |
| `/api/scan/preprocess` | POST | `test_scan.py` | P1 |
| `/api/scan/confirm` | POST | `test_scan.py` ✅ | Done |
| `/api/scan/undo/{id}` | POST | `test_scan.py` ✅ | Done |
| `/api/recipes/generate` | POST | `test_recipes.py` | **P0** |
| `/api/recipes/suggestions` | GET | `test_recipes.py` | **P0** |
| `/api/profile` | POST | `test_profile.py` ✅ | Done |
| `/api/profile/{id}` | GET | `test_profile.py` ✅ | Done |
| `/api/profile/{id}` | PUT | `test_profile.py` | P1 |
| `/api/profile/{id}` | DELETE | `test_profile.py` | P1 |
| `/api/chat` | POST | `test_chat.py` | **P0** |
| `/api/workflows/{id}` | GET | `test_chat.py` | P1 |
| `/api/workflows/{id}/events` | POST | `test_chat.py` | P1 |

### All User Flows to Test

| Flow | Description | Test File | Priority |
|------|-------------|-----------|----------|
| Manual Add | User manually adds item to pantry | `test_pantry.py` ✅ | Done |
| Receipt Scan | Upload receipt → OCR → Parse → Review → Confirm | `test_integration.py` | **P0** |
| Recipe Generation | Request recipe → AI generates → Match pantry | `test_recipes.py` | **P0** |
| Recipe with Expiring | Generate using expiring items | `test_recipes.py` | **P0** |
| Recipe Follow-up | "Make it spicier" modifications | `test_recipes.py` | P1 |
| Chat Add Items | "I bought milk and eggs" → Pantry update | `test_chat.py` | **P0** |
| Chat Remove Items | "I used all the chicken" → Pantry update | `test_chat.py` | P1 |
| Chat Recipe Request | "What can I make?" → Recipe suggestion | `test_chat.py` | P1 |
| Chat Receipt Request | "I want to scan a receipt" → Handoff | `test_chat.py` | P1 |
| Workflow Approve | Review proposal → Approve → Apply changes | `test_chat.py` | P1 |
| Workflow Reject | Review proposal → Reject | `test_chat.py` | P1 |
| Profile Management | Create/update dietary preferences | `test_profile.py` | P1 |

### All Services to Unit Test

| Service | Functions | Test File | Priority |
|---------|-----------|-----------|----------|
| `recipe_generator.py` | `format_pantry_for_prompt()` | `test_recipe_generator.py` | **P0** |
| `recipe_generator.py` | `format_expiring_items()` | `test_recipe_generator.py` | **P0** |
| `recipe_generator.py` | `match_ingredient_to_pantry()` | `test_recipe_generator.py` | **P0** |
| `recipe_generator.py` | `calculate_pantry_match_score()` | `test_recipe_generator.py` | **P0** |
| `recipe_generator.py` | `generate_recipe()` | `test_recipe_generator.py` | **P0** |
| `receipt_parser.py` | `parse_receipt()` | `test_receipt_parser.py` | P1 |
| `receipt_parser.py` | `is_likely_food()` | `test_scan.py` ✅ | Done |
| `image_preprocessor.py` | `preprocess_image()` | `test_image_preprocessor.py` | P2 |
| `ocr.py` | `extract_text()` | `test_ocr.py` | P2 |

### All Domain Logic to Test

| Module | Functions | Test File | Priority |
|--------|-----------|-----------|----------|
| `normalizer.py` | `normalize_food_name()` | `test_normalizer.py` ✅ | Done |
| `normalizer.py` | `detect_category()` | `test_normalizer.py` ✅ | Done |
| `expiry.py` | `estimate_expiry_days()` | `test_expiry.py` ✅ | Done |
| `expiry.py` | `get_default_location()` | `test_expiry.py` ✅ | Done |
| `defaults.py` | `get_default_quantity()` | `test_defaults.py` | P1 |

### All Models to Test

| Model | Properties/Methods | Test File | Priority |
|-------|-------------------|-----------|----------|
| `PantryItem` | Computed properties | `test_pantry_item.py` | **P0** |
| `PantryItem` | `.location` alias | `test_pantry_item.py` | **P0** |
| `PantryItem` | `.name_normalized` | `test_pantry_item.py` | **P0** |
| `PantryItem` | `.is_expiring_soon` | `test_pantry_item.py` | **P0** |
| `PantryItem` | `.is_expired` | `test_pantry_item.py` | **P0** |
| `PantryItem` | `.days_until_expiry` | `test_pantry_item.py` | **P0** |
| `RecipeCard` | Serialization | `test_recipe.py` | P1 |
| `UserProfile` | Validation | `test_user.py` | P2 |

---

## Specific Bug Test: Recipe Generation with Real Pantry

This test specifically covers the bug we encountered:

```python
# tests/integration/test_recipe_with_pantry.py

import pytest
from datetime import date, timedelta
from httpx import AsyncClient


class TestRecipeGenerationWithPantry:
    """
    Integration tests for recipe generation using actual pantry data.

    These tests ensure the full flow works:
    1. Pantry items are created correctly
    2. Recipe generation can read and format pantry
    3. Expiring items are properly identified
    4. Ingredient matching works against real data
    """

    @pytest.mark.asyncio
    async def test_recipe_generation_with_populated_pantry(self, client: AsyncClient):
        """
        TEST: Generate recipe with real pantry items

        This was the failing flow - generating a recipe when the user
        has items in their pantry caused AttributeError because
        format_pantry_for_prompt tried to access item.location
        instead of item.storage_location.
        """
        # Step 1: Populate pantry with various items
        pantry_items = [
            {
                "name": "Chicken Breast",
                "quantity": 2,
                "unit": "lb",
                "category": "meat",
                "location": "fridge",
            },
            {
                "name": "Garlic",
                "quantity": 1,
                "unit": "head",
                "category": "produce",
                "location": "counter",
            },
            {
                "name": "Olive Oil",
                "quantity": 1,
                "unit": "bottle",
                "category": "condiments",
                "location": "pantry",
            },
            {
                "name": "Rice",
                "quantity": 2,
                "unit": "lb",
                "category": "dry_goods",
                "location": "pantry",
            },
        ]

        for item in pantry_items:
            response = await client.post("/api/pantry", json=item)
            assert response.status_code == 201, f"Failed to add {item['name']}"

        # Step 2: Verify pantry has items
        pantry_response = await client.get("/api/pantry")
        assert pantry_response.status_code == 200
        assert pantry_response.json()["total_count"] == 4

        # Step 3: Generate recipe (this was failing!)
        # Note: This test needs the AI to be mocked or available
        recipe_response = await client.post(
            "/api/recipes/generate",
            json={"prompt": "Quick dinner under 30 minutes"},
        )

        # The bug caused this to return 500 with AttributeError
        assert recipe_response.status_code == 200, (
            f"Recipe generation failed: {recipe_response.json()}"
        )

        data = recipe_response.json()
        assert "recipe" in data
        assert "ingredients_status" in data
        assert "pantry_match_score" in data

    @pytest.mark.asyncio
    async def test_recipe_generation_with_expiring_items(self, client: AsyncClient):
        """
        TEST: Expiring items are included in recipe generation context.

        Verifies format_expiring_items() works with real pantry items
        that have expiry dates.
        """
        # Add item expiring tomorrow
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        response = await client.post(
            "/api/pantry",
            json={
                "name": "Fresh Salmon",
                "quantity": 1,
                "unit": "lb",
                "category": "seafood",
                "location": "fridge",
                "expiry_date": tomorrow,
            },
        )
        assert response.status_code == 201

        # Add item expiring today
        today = date.today().isoformat()
        response = await client.post(
            "/api/pantry",
            json={
                "name": "Spinach",
                "quantity": 1,
                "unit": "bunch",
                "category": "produce",
                "location": "fridge",
                "expiry_date": today,
            },
        )
        assert response.status_code == 201

        # Recipe generation should work and prioritize expiring items
        recipe_response = await client.post(
            "/api/recipes/generate",
            json={
                "prompt": "Use up ingredients before they expire",
                "constraints": {"use_expiring": True},
            },
        )

        assert recipe_response.status_code == 200

    @pytest.mark.asyncio
    async def test_recipe_suggestions_with_pantry(self, client: AsyncClient):
        """
        TEST: Suggestions endpoint works with populated pantry.

        Verifies the suggestions include personalized prompts based
        on what's in the pantry.
        """
        # Add some proteins
        await client.post(
            "/api/pantry",
            json={"name": "Chicken Thighs", "quantity": 1, "unit": "lb"},
        )

        # Get suggestions
        response = await client.get("/api/recipes/suggestions")
        assert response.status_code == 200

        suggestions = response.json()
        assert isinstance(suggestions, list)
        assert len(suggestions) > 0

    @pytest.mark.asyncio
    async def test_ingredient_matching_against_pantry(self, client: AsyncClient):
        """
        TEST: Recipe ingredients are correctly matched to pantry.

        Verifies match_ingredient_to_pantry() logic works end-to-end.
        """
        # Add specific items
        await client.post(
            "/api/pantry",
            json={"name": "Eggs", "quantity": 12, "unit": "count"},
        )
        await client.post(
            "/api/pantry",
            json={"name": "Butter", "quantity": 1, "unit": "stick"},
        )

        # Generate recipe that would use these
        response = await client.post(
            "/api/recipes/generate",
            json={"prompt": "Make scrambled eggs"},
        )

        assert response.status_code == 200
        data = response.json()

        # Check ingredient status
        statuses = data["ingredients_status"]
        assert any(
            s["status"] == "have" and "egg" in s["ingredient_name"].lower()
            for s in statuses
        ), "Eggs should be marked as 'have'"
```

---

## References

- [pytest documentation](https://docs.pytest.org/)
- [pytest-asyncio](https://pytest-asyncio.readthedocs.io/)
- [pytest-cov](https://pytest-cov.readthedocs.io/)
- [HTTPX testing](https://www.python-httpx.org/async/)
- [respx for mocking](https://lundberg.github.io/respx/)
