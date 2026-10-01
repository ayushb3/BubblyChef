"""Household size (issues #853, #874): how many people the user usually cooks for.

It is the user's default servings. The first-run staples step stores it in the
auth user's `user_metadata.household_size` (a guest has no `user_profiles` row);
`user_profiles.household_size` (migration 00018) is the fallback. When both are
set the auth metadata wins, because that is what first run and the Profile entry
write.

`coerce_household_size` is the same rule as `coerceHouseholdSize` in
`nextjs/src/lib/household.ts`: keep the two in step.
"""

from typing import Any

# Largest servings count the rest of the app accepts as a default.
MAX_HOUSEHOLD_SIZE = 20


def coerce_household_size(raw: Any) -> int | None:
    """An integer from 1 to 20, else None (unset, hand-edited or garbage data).

    A whole-number float such as `4.0` counts as 4, since JSON does not tell the
    two apart and the Next.js side reads both as the number 4. A bool is not a
    number here, even though Python makes it an int.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    if isinstance(raw, float) and not raw.is_integer():
        return None
    size = int(raw)
    if size < 1 or size > MAX_HOUSEHOLD_SIZE:
        return None
    return size
