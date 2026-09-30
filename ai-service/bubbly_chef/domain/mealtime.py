"""Single source of truth for mapping a clock hour to a meal-type bucket.

The caller that needs "what meal is it right now, given this hour":

- `services/dashboard_ranking.py::dashboard_meal_time_bucket` — compares
  against the stored `recipe.meal_type` tag when ranking dashboard
  suggestions (#225, #168).

(Chat/brainstorm no longer defaults `meal_type` from the clock: no meal type
named means any dish, #408.)

It is a *matching* operation: it produces (or compares against) a value
from the same vocabulary `models/recipe.py` documents for `meal_type`
(breakfast, lunch, dinner, snack, plus this module's own "late-night snack").
It must stay one shared rule, not independently-hand-rolled copies — a
review pass on the dashboard endpoint once found hand-rolled boundaries that
disagreed with this one for 7 hours out of 24, which silently promoted
mistagged recipes in ranking.

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
