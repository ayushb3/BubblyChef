"""Converting a recipe line's amount into a pantry row's base unit.

The cook matcher compares a recipe line ("1 cup flour", "2 cloves garlic") with the
pantry row that holds the food ("2 lb flour", "1 head garlic"). Each pantry row has a
base unit (grams, millilitres or a count, see ``normalizer.normalize_to_base_unit``)
and this module says how many of that base unit the recipe line is.

Three kinds of conversion, with the first that works winning:

1. **Exact**: inside one dimension (cups to ml, oz to g, dozen to count), a stated
   container size ("28 oz can") and a piece weight that is a definition (a stick of
   butter). ``Converted.approximate`` is False.
2. **Estimated**: a piece weight ("an onion is ~150 g", ``piece_weights``), a density
   (``density.py``), a typical container size ("a can of tomatoes is 14.5 oz"). The
   quantity is still produced and deducted, but ``approximate`` is True so the
   review sheet can say "about".
3. **Refused**: anything without an honest figure returns None. The matcher turns
   that into ``imprecise`` / ``unit_conflict`` and asks the user; nothing is
   invented. No model is involved anywhere, so every result is deterministic.

Why a pivot through mass or volume: "1 onion" against "1 lb onions" has no direct
rule, but onion has a typical weight and a pound is a weight, so both sides meet
in grams. Count targets divide by what one counted thing weighs on the pantry
side (a can, a clove, an egg).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from bubbly_chef.domain.normalizer import (
    CONTAINER_UNITS,
    EACH_LIKE_UNITS,
    each_factor,
    is_package_unit,
    is_piece_unit,
    measure_in_base,
    normalize_food_name,
    normalize_unit,
    parse_sized_container,
    resolve_container_size,
    resolve_density,
    resolve_piece_weight,
    to_base_unit,
)
from bubbly_chef.domain.density import is_exact_piece_weight
from bubbly_chef.domain.piece_weights import (
    bare_count_unit,
    each_weight_g,
    juice_yield_ml,
)

UnitKind = Literal["mass", "volume", "each", "container", "piece", "sized"]

# Pieces of a food that aren't a whole item: a clove of a head, a slice of a loaf.
_PIECE_UNITS: frozenset[str] = frozenset(
    {"clove", "slice", "leaf", "sprig", "head", "bunch", "loaf", "stick"}
)


@dataclass(frozen=True)
class Converted:
    """A recipe amount in the pantry row's base unit."""

    quantity: float
    unit: str  # "g" | "ml" | "count"
    approximate: bool


def unit_kind(unit: str | None) -> UnitKind | None:
    """What sort of thing `unit` measures, or None for a unit with no honest meaning.

    ``each`` counts whole pieces (item, dozen); ``piece`` counts parts of a food
    (clove, slice); ``container`` counts purchased containers (can, bag);
    ``sized`` is a container with its size stated ("28 oz can").
    """
    if not unit:
        return None
    if parse_sized_container(unit) is not None:
        return "sized"
    canonical = normalize_unit(unit)
    if canonical in EACH_LIKE_UNITS:
        return "each"
    if canonical in CONTAINER_UNITS:
        return "container"
    if canonical in _PIECE_UNITS:
        return "piece"
    measured = measure_in_base(1.0, canonical)
    if measured is not None:
        return "mass" if measured[1] == "g" else "volume"
    return None


def _piece_weight(unit: str, name: str) -> tuple[float, bool] | None:
    """(grams in one `unit` of `name`, is it an estimate)."""
    weight = resolve_piece_weight(unit, name.lower().strip())
    if weight is None:
        return None
    exact = is_exact_piece_weight(unit, name) or is_exact_piece_weight(
        unit, normalize_food_name(name)
    )
    return weight, not exact


def _each_weight(name: str) -> float | None:
    weight = each_weight_g(name)
    if weight is None:
        weight = each_weight_g(normalize_food_name(name))
    return weight


def _source_measure(name: str, quantity: float, unit: str) -> tuple[float, str, bool] | None:
    """The recipe amount as (amount, "g" | "ml", is it an estimate), or None."""
    kind = unit_kind(unit)
    canonical = normalize_unit(unit)

    if kind == "sized":
        sized = parse_sized_container(unit)
        assert sized is not None
        measured = measure_in_base(quantity * sized[0], sized[1])
        return None if measured is None else (measured[0], measured[1], False)

    if kind in ("mass", "volume"):
        measured = measure_in_base(quantity, canonical)
        return None if measured is None else (measured[0], measured[1], False)

    if kind == "each":
        factor = each_factor(unit)
        weight = _each_weight(name)
        if factor is None or weight is None:
            return None
        return quantity * factor * weight, "g", True

    if kind == "container":
        size = resolve_container_size(canonical, name)
        if size is None:
            return None
        amount, size_unit = size
        if size_unit == "count":
            weight = _each_weight(name)
            return None if weight is None else (quantity * amount * weight, "g", True)
        measured = measure_in_base(quantity * amount, size_unit)
        return None if measured is None else (measured[0], measured[1], True)

    if kind == "piece":
        piece = _piece_weight(canonical, name)
        if piece is None:
            return None
        return quantity * piece[0], "g", piece[1]

    return None


def _per_count(pantry_name: str, pantry_unit: str) -> tuple[float, str] | None:
    """What ONE counted thing in the pantry row weighs, as (amount, "g" | "ml").

    A row's base is a count (``unit_base == "count"``) of whatever its unit counts:
    eggs for a dozen, cans for a can, cloves for a clove. This is the size of one.
    """
    kind = unit_kind(pantry_unit)
    canonical = normalize_unit(pantry_unit)

    if kind == "each":
        weight = _each_weight(pantry_name)
        return None if weight is None else (weight, "g")

    if kind == "container":
        size = resolve_container_size(canonical, pantry_name)
        if size is None:
            return None
        amount, size_unit = size
        if size_unit == "count":
            # A carton of eggs is counted in eggs (the base is pieces), not cartons.
            weight = _each_weight(pantry_name)
            return None if weight is None else (weight, "g")
        measured = measure_in_base(amount, size_unit)
        return None if measured is None else (measured[0], measured[1])

    if kind == "piece":
        piece = _piece_weight(canonical, pantry_name)
        return None if piece is None else (piece[0], "g")

    return None


def _into_dimension(
    amount: float, dim: str, want: str, name: str, pantry_name: str
) -> tuple[float, bool] | None:
    """`amount` of `dim` ("g" | "ml") as `want`, through density when it crosses.

    Returns (amount, crossed); `crossed` marks a density estimate. None when the
    food has no density, which is a refusal, not a gap to fill with a default.
    """
    if dim == want:
        return amount, False
    density = resolve_density(name, "other") or resolve_density(pantry_name, "other")
    if density is None or density <= 0:
        return None
    if dim == "ml" and want == "g":
        return amount * density, True
    if dim == "g" and want == "ml":
        return amount / density, True
    return None


def _pivot(
    name: str,
    quantity: float,
    unit: str,
    target_unit: str,
    pantry_name: str,
    pantry_unit: str | None,
) -> Converted | None:
    """Meet in mass or volume: the recipe amount there, then into the target unit."""
    source = _source_measure(name, quantity, unit)
    if source is None:
        return None
    amount, dim, approximate = source

    if target_unit in ("g", "ml"):
        moved = _into_dimension(amount, dim, target_unit, name, pantry_name)
        if moved is None:
            return None
        return Converted(moved[0], target_unit, approximate or moved[1])

    if target_unit == "count" and pantry_unit:
        per = _per_count(pantry_name, pantry_unit)
        if per is None or per[0] <= 0:
            return None
        moved = _into_dimension(amount, dim, per[1], name, pantry_name)
        if moved is None:
            return None
        # What one counted thing weighs is itself an estimate.
        return Converted(moved[0] / per[0], "count", True)

    return None


def convert_amount(
    name: str,
    quantity: float,
    unit: str,
    target_unit: str,
    *,
    pantry_name: str | None = None,
    pantry_unit: str | None = None,
) -> Converted | None:
    """`quantity` `unit` of `name`, as the pantry row's base unit `target_unit`.

    Args:
        name: The recipe line's food, normalized.
        target_unit: The pantry row's base unit ("g", "ml" or "count").
        pantry_name: The pantry row's food, normalized, when it differs from `name`
            (a substitute). It decides what one counted pantry thing weighs.
        pantry_unit: The pantry row's own display unit ("dozen", "can", "28 oz
            can"). Needed to turn a mass or volume into a count of that row's things.

    Returns None when there is no honest conversion.
    """
    pantry_name = pantry_name or name
    kind = unit_kind(unit)
    pantry_kind = unit_kind(pantry_unit)

    # "3 garlic" in a recipe is three cloves, not three heads: the bare count means a
    # smaller piece. Only against a row that is not itself counted in whole items.
    if kind == "each" and normalize_unit(unit) in ("count", "item") and pantry_kind != "each":
        piece_unit = bare_count_unit(name)
        if piece_unit is not None:
            unit, kind = piece_unit, "piece"

    if target_unit == "count" and pantry_unit:
        same_unit = normalize_unit(unit) == normalize_unit(pantry_unit)
        direct = (kind == "each" and pantry_kind == "each") or (
            kind in ("container", "piece") and pantry_kind == kind and same_unit
        )
        if direct:
            exact = to_base_unit(name, quantity, unit, target_unit="count")
            return None if exact is None else Converted(*exact)
        # "1 (14.5 oz) can" against "2 cans": a can is a can, but the recipe's size may
        # not be the pantry's, so the 1:1 is an assumption and says so.
        if kind == "sized" and pantry_kind == "container":
            sized = parse_sized_container(unit)
            if sized is not None and sized[2] == normalize_unit(pantry_unit):
                return Converted(quantity, "count", True)
        pivoted = _pivot(name, quantity, unit, target_unit, pantry_name, pantry_unit)
        if pivoted is not None:
            return pivoted
        # No typical figure to bridge the two counts. Pieces of a food against a package
        # of it (4 slices against a loaf) are not the same count at all, so there is no
        # honest answer and the matcher asks (ADR 0003). Every other pair of count-like
        # units (a loaf against a count, a head against a bunch) is one thing each.
        if is_piece_unit(unit) and is_package_unit(pantry_unit):
            return None
        fallback = to_base_unit(name, quantity, unit, target_unit="count")
        return None if fallback is None else Converted(*fallback)

    exact = to_base_unit(name, quantity, unit, target_unit=target_unit)
    if exact is not None:
        return Converted(*exact)
    return _pivot(name, quantity, unit, target_unit, pantry_name, pantry_unit)


# ── Juice as fruit ─────────────────────────────────────────────────────────

_JUICE_SUFFIX = " juice"


def juice_fruit(name: str) -> str | None:
    """The fruit a juice line is squeezed from ("lemon juice" -> "lemon"), or None."""
    key = name.lower().strip()
    if not key.endswith(_JUICE_SUFFIX):
        return None
    fruit = key[: -len(_JUICE_SUFFIX)].strip()
    return fruit if juice_yield_ml(fruit) is not None else None


def juice_as_fruit(fruit: str, quantity: float, unit: str) -> float | None:
    """How many `fruit` give `quantity` `unit` of juice, or None for a non-volume unit.

    Plain arithmetic: 30 ml of lemon juice at 45 ml per lemon is 2/3 of a lemon.
    """
    if unit_kind(unit) != "volume":
        return None
    yield_ml = juice_yield_ml(fruit)
    measured = measure_in_base(quantity, unit)
    if yield_ml is None or measured is None or yield_ml <= 0:
        return None
    return measured[0] / yield_ml
