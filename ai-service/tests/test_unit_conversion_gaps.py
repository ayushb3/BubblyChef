"""Unit conversion in the cook matcher and pantry deduction, against real home-cook pairs.

Every case in ``unit_conversion_cases.CASES`` is a recipe line against a pantry row,
run through the real ``match_ingredients`` and then the real
``SupabaseRepository.deduct_pantry_item``. Each asserts the settled behaviour:

- within a dimension (mass, volume, count) everything converts;
- count <-> mass goes through a typical piece weight, volume <-> mass through a
  staple density, a can/jar/bag through its stated or typical size;
- such conversions deduct but are flagged ``approximate``;
- "pinch", "dash" and "to taste" never block and never deduct;
- a range checks the upper bound and deducts the midpoint;
- only a pair with no honest conversion stays ``imprecise`` / ``unit_conflict``.

Each case runs twice: once with a pantry row that carries no stored base (what the
Next.js CRUD routes write) and once with the base the write path would have stored.
"""

from __future__ import annotations

import pytest

from tests.unit_conversion_cases import CASES, Case
from tests.unit_conversion_harness import run_case


@pytest.mark.parametrize("stored_base", [False, True], ids=["derived-base", "stored-base"])
@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_recipe_line_against_pantry_row(case: Case, stored_base: bool) -> None:
    out = run_case(case, stored_base=stored_base)

    assert out.status == case.status, f"{case.id}: {case.note}"

    if case.status == "missing":
        assert out.match is None
        return

    match = out.match
    assert match is not None

    if case.deduct is None:
        # to_taste / assumed / imprecise / unit_conflict: nothing is deducted.
        assert match.deduct_qty is None
        assert out.remaining is None
        return

    assert match.deduct_qty == pytest.approx(case.deduct, rel=2e-3, abs=1e-3)
    assert match.base_unit == case.base
    assert match.approximate is case.approx, "the approximate flag must say what was estimated"
    if case.shortfall is not None:
        assert match.shortfall == pytest.approx(case.shortfall, rel=2e-3, abs=1e-2)
    else:
        assert match.shortfall is None

    # The pantry afterwards: the real deduction path, in the row's own display unit.
    assert case.remaining is not None
    assert out.remaining is not None, "the deduction was refused or the row vanished"
    assert out.remaining == pytest.approx(case.remaining, rel=5e-3, abs=1e-2)
