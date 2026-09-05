"""Tests for the /v1/pantry/normalize-base-unit endpoint and its helpers (#224).

The endpoint itself requires JWT auth + wires FastAPI, so the interesting
behaviour — the conversion dispatch table and the graceful null return — is
tested via the domain function directly, matching the pattern used by the
expiry-estimation and category-estimation tests.

The endpoint model is also exercised to confirm that null pairs are serialised
as expected (both fields null rather than one or neither).
"""

from __future__ import annotations

import pytest

from bubbly_chef.api.routes.pantry import (
    NormalizeBaseUnitRequest,
    NormalizeBaseUnitResponse,
)
from bubbly_chef.domain.normalizer import normalize_to_base_unit


# ---------------------------------------------------------------------------
# Request / response model smoke tests
# ---------------------------------------------------------------------------


def test_request_requires_name_quantity_unit() -> None:
    req = NormalizeBaseUnitRequest(name="milk", quantity=2.0, unit="cup")
    assert req.name == "milk"
    assert req.quantity == 2.0
    assert req.unit == "cup"
    assert req.category == "other"  # default


def test_request_accepts_category() -> None:
    req = NormalizeBaseUnitRequest(name="milk", quantity=2.0, unit="cup", category="dairy")
    assert req.category == "dairy"


def test_response_allows_null_pair() -> None:
    resp = NormalizeBaseUnitResponse(quantity_base=None, unit_base=None)
    assert resp.quantity_base is None
    assert resp.unit_base is None


def test_response_carries_values() -> None:
    resp = NormalizeBaseUnitResponse(quantity_base=480.0, unit_base="ml")
    assert resp.quantity_base == pytest.approx(480.0)
    assert resp.unit_base == "ml"


# ---------------------------------------------------------------------------
# Domain function — conversion cases
# ---------------------------------------------------------------------------


def test_ml_conversion_cup_to_ml() -> None:
    """2 cups of milk → 480 ml."""
    qty, unit = normalize_to_base_unit("milk", 2.0, "cup", category="dairy")
    assert qty == pytest.approx(480.0)
    assert unit == "ml"


def test_g_conversion_oz_to_g() -> None:
    """2 oz of butter → 56.7 g."""
    qty, unit = normalize_to_base_unit("butter", 2.0, "oz", category="dairy")
    assert qty == pytest.approx(56.7, rel=1e-3)
    assert unit == "g"


def test_count_conversion_dozen_to_count() -> None:
    """1 dozen eggs → 12 count."""
    qty, unit = normalize_to_base_unit("eggs", 1.0, "dozen")
    assert qty == pytest.approx(12.0)
    assert unit == "count"


def test_same_unit_no_conversion_needed() -> None:
    """500 g of rice is already in grams."""
    qty, unit = normalize_to_base_unit("rice", 500.0, "g")
    assert qty == pytest.approx(500.0)
    assert unit == "g"


def test_piece_weight_clove_garlic() -> None:
    """2 cloves garlic → 6 g (conventional 3 g/clove)."""
    qty, unit = normalize_to_base_unit("garlic", 2.0, "clove")
    assert qty == pytest.approx(6.0)
    assert unit == "g"


def test_density_tbsp_butter_to_g() -> None:
    """1 tbsp butter → ~13.6 g via density (0.911 g/ml × 15 ml)."""
    qty, unit = normalize_to_base_unit("butter", 1.0, "tbsp")
    assert qty == pytest.approx(13.665, rel=1e-2)
    assert unit == "g"


def test_unknown_unit_returns_null_pair() -> None:
    """A completely unknown unit returns (None, None) — not a guess."""
    qty, unit = normalize_to_base_unit("spinach", 1.0, "bag")
    # "bag" is a package unit that maps to "count" in _TO_COUNT, so it converts.
    # Use a genuinely unknown unit instead.
    qty2, unit2 = normalize_to_base_unit("spinach", 1.0, "glorp")
    assert qty2 is None
    assert unit2 is None


def test_no_density_volume_to_g_returns_null_pair() -> None:
    """Volume → g conversion for an ingredient with no density entry → (None, None).

    This is the "1 tbsp matcha" case: matcha has no density in the registry,
    so converting 15 ml to grams is impossible. The function must refuse rather
    than invent a number.
    """
    qty, unit = normalize_to_base_unit("matcha", 1.0, "tbsp")
    assert qty is None
    assert unit is None


# ---------------------------------------------------------------------------
# Real-world cases: items typically added via the Next.js write path
# ---------------------------------------------------------------------------


def test_greek_yogurt_grams_passthrough() -> None:
    """500 g greek yogurt is already in grams — no conversion needed."""
    qty, unit = normalize_to_base_unit("greek yogurt", 500.0, "g", category="dairy")
    assert qty == pytest.approx(500.0)
    assert unit == "g"


def test_basmati_rice_kg_to_g() -> None:
    """2 kg basmati rice → 2000 g."""
    qty, unit = normalize_to_base_unit("basmati rice", 2.0, "kg", category="dry_goods")
    assert qty == pytest.approx(2000.0)
    assert unit == "g"


def test_olive_oil_ml_passthrough() -> None:
    """500 ml olive oil stays in ml."""
    qty, unit = normalize_to_base_unit("olive oil", 500.0, "ml", category="condiments")
    assert qty == pytest.approx(500.0)
    assert unit == "ml"


def test_bag_item_maps_to_count() -> None:
    """1 bag baby spinach → 1 count (package unit)."""
    qty, unit = normalize_to_base_unit("baby spinach", 1.0, "bag")
    assert qty == pytest.approx(1.0)
    assert unit == "count"


def test_item_unit_maps_to_count() -> None:
    """3 item avocados → 3 count."""
    qty, unit = normalize_to_base_unit("avocado", 3.0, "item")
    assert qty == pytest.approx(3.0)
    assert unit == "count"
