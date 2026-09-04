"""Single source of truth for mapping a clock hour to a meal-type bucket.

Two callers need "what meal is it right now, given this hour":

- `workflows/recipe/nodes.py::_default_meal_type` — defaults `meal_type` for a
  chat/brainstorm request when the user didn't say one.
- `services/dashboard_ranking.py::dashboard_meal_time_bucket` — compares
  against the stored `recipe.meal_type` tag when ranking dashboard
  suggestions (#225, #168).

Both are *matching* operations: they produce (or compare against) a value
from the same vocabulary `models/recipe.py` documents for `meal_type`
(breakfast, lunch, dinner, snack, plus this module's own "late-night snack").
They must use one rule, not two independently-hand-rolled ones — a second
review pass on the dashboard endpoint found the dashboard's original
hand-rolled boundaries disagreed with this one for 7 hours out of 24, which
silently promoted mistagged recipes in ranking.

This is deliberately NOT the same rule `HeroHome.tsx`'s `getGreeting()` uses
(5/12/18/22 vs. 5/10/14/17/21 here). The greeting is *wording* — a decision
#306 established belongs to the frontend and is allowed to disagree with a
server-side matching rule. This module is for *matching* a stored tag, which
must stay married to whatever rule produced that tag.
"""


def meal_time_bucket(hour: int) -> str:
    """Return breakfast | lunch | snack | dinner | late-night snack for a 0-23 hour."""
    if 5 <= hour < 10:
        return "breakfast"
    if 10 <= hour < 14:
        return "lunch"
    if 14 <= hour < 17:
        return "snack"
    if 17 <= hour < 21:
        return "dinner"
    return "late-night snack"
