# `GET /v1/dashboard/daily` — AI tips and a pantry-aware suggestion (#225, #168)

**Status:** implemented (backend) · **Issues:** #225 (AI-generated, interest-tunable dashboard tip), #168 (dashboard recipe suggestion is random, not time- or pantry-aware)
**Depends on:** #306 / PR #318 (correct deep link + time-of-day wording), #314 (delete `BubblesFeed`)

**Amended after backend review.** Three points below were wrong or under-specified in the original
plan and are corrected here rather than left to drift from the implementation: the time-of-day
bucket used for *ranking* (was: reuse the greeting's clock; is: reuse the recipe tagger's clock —
these are two different rules and matching needs the second one), the timezone the bucket and cache
date are computed in (was: unspecified, defaulted to the server's UTC; is: the client's own offset,
passed explicitly), and the cache key's pantry/recipe revision components (was: max `updated_at`
alone; is: max `updated_at` *plus* a fingerprint of the row-id set, and the recipe set gets the same
treatment pantry did). See "Ranking", "Timezone", and "Caching" below.

## Why these are one piece of work

Both defects live in the same component (`nextjs/src/components/dashboard/HeroHome.tsx`), draw on the
same grounding inputs (pantry contents, expiring items, dietary preferences), and need the same
per-user-per-day caching so the dashboard does not hit an LLM on every page load.

Current live state:

| Line | Code | Issue |
|---|---|---|
| `:25`, `:156` | `tips[new Date().getDay() % tips.length]` | **#225** — every user sees the same tip on the same weekday, forever |
| `:132` | `pickRandomRecipe(recipes)` | **#168** — uniform random pick from the 5 most recent saves |
| `:36`, `:44` | `new Date().getHours()` | the greeting — already correct, leave alone |

**After #306 merges, #168 shrinks to just the selection problem.** Two of its four reported defects
(the action linking to the recipe list rather than the named recipe; "tonight" rendered at any hour)
are #306's job and will be done. #168's body should be trimmed to say so, or a reviewer will think it
is still four defects wide.

## The core decision: the LLM writes copy, it does not pick the recipe

#168's defect is *selection*, not wording. Selection stays deterministic; the LLM only phrases the
result. This mirrors the existing Recipe Grounding Workflow, which already does
`gather_pantry_context → extract_constraints → score_and_rank` (deterministic) `→
generate_grounded_response` (LLM).

Four reasons, in order of weight:

1. **Hallucination is a correctness bug here.** An LLM asked to pick could name a recipe that is not
   in the user's library, producing a broken "Open recipe" link — precisely the defect #306 just
   fixed. Regressing it would be worse than the original bug.
2. **Testability.** "Chicken expires tomorrow, so the chicken recipe ranks first" is a unit test. An
   LLM's choice is not.
3. **#168's acceptance criteria are a scoring rule** — "biased toward recipes I can actually make
   with what's in my pantry, especially items expiring soon."
4. **Cost and latency** on a surface that renders on every dashboard load.

## Endpoint

`GET /v1/dashboard/daily?tz_offset_minutes=<int>` on the AI microservice, authed via
`get_current_user_id` like every other `/v1` route. It runs server-side where `SupabaseRepository`
already reaches both pantry and recipes, so the client makes one call instead of orchestrating three.

```jsonc
{
  "tip": { "text": "...", "category": "technique" },
  "suggestion": {                      // null when the user has no saved recipes
    "recipe_id": "uuid",
    "title": "Stewed rhubarb",
    "total_time_minutes": 15,
    "copy": "Your rhubarb is going soft — this uses it up in 15 minutes.",
    "reason": "expiring"               // expiring | pantry_match | meal_time | fallback
  },
  "generated_at": "2026-09-04T08:00:00Z",
  "source": "ai"                       // ai | fallback
}
```

`reason` is a machine-readable trace of *why* this recipe won, so the UI can vary emphasis and so a
test can assert the ranking without asserting on LLM prose. `reason: "fallback"` also covers the
in-band case where a recipe won purely by the recency tie-break with zero real signal (no pantry
overlap, no meal-time match) — reporting that as `"pantry_match"` would misrepresent a coincidence
as a real match.

### Ranking (deterministic, server-side)

Score each candidate from the user's saved recipes:

```
score = w_expiry   * expiry_urgency      # max urgency across matched ingredients
      + w_pantry   * pantry_coverage     # fraction of recipe ingredients in pantry
      + w_mealtime * meal_type_match     # recipe.meal_type vs time-of-day bucket
```

- **Reuse the existing matcher.** `services/cook_matcher.py` already matches recipe ingredients
  against pantry items, handles both ingredient shapes (`isinstance(ingredient, str)` at `:392` and
  `:618`), and knows about synonyms and units. Do not write a second matching rule.
- **Time-of-day buckets — corrected after review.** The original plan said to reuse the greeting's
  clock (`HeroHome.tsx::getGreeting`, boundaries 5/12/18/22). That was wrong. Ranking is not wording
  like the greeting is — it *compares a computed bucket against `recipe.meal_type`, a stored tag* —
  so the rule that produces the bucket must be the same rule that produced the tag, or the comparison
  is between two different definitions of "right now." The tag comes from
  `workflows/recipe/nodes.py::_default_meal_type` (boundaries 5/10/14/17/21). A review pass measured
  the two rules disagreeing for 7 of 24 hours even after normalising vocabulary — a 0.1-weighted
  signal that's wrong that often is worse than no signal, since it silently promotes mistagged
  recipes. The shared rule now lives in `domain/mealtime.py::meal_time_bucket`, imported by both
  `_default_meal_type` and the dashboard ranking (which folds its `"late-night snack"` output to
  `"snack"` to match `models/recipe.py`'s documented four-value vocabulary). There is one rule, not
  three; the greeting keeps its own separate boundaries because it is wording, not matching, and #306
  already settled that the frontend owns that decision.
- Ties broken deterministically (e.g. most recently saved) so the same inputs always yield the same
  pick.
- Weights, plus the expiry-urgency day thresholds (urgent/soon), live in `config.py` as `BUBBLY_*`
  settings so they are tunable without a deploy. Note that `Settings` forbids extra keys, so any new
  name must be added to the model or the service dies at import.

### Timezone

The bucket above and the cache's "local date" (below) both need the *user's* clock, not the server's
— Railway runs UTC, so computing either from the server's own `datetime.now()` reintroduces #306's
exact complaint (dashboard disagreeing with the browser) on the server side, for every non-UTC user,
every day.

The endpoint takes `tz_offset_minutes` as a query parameter: the client's UTC offset in minutes,
**using the standard UTC-offset sign convention** — the number of minutes to ADD to UTC to reach
local time (UTC+2 → `120`, UTC-5 → `-300`). This is the *negation* of JavaScript's
`Date.prototype.getTimezoneOffset()`, which returns the opposite sign — the frontend must pass
`-date.getTimezoneOffset()`, not the raw value. Getting the sign backwards is a silent bug (every
bucket would be off by a spurious ~2× the true offset, in the wrong direction), so the route
docstring and the client call site should both say so explicitly. Range-validated
(`-720`–`840` minutes, i.e. UTC-12 to UTC+14); out-of-range values are rejected with 422. Defaults to
`0` (UTC) if the client omits it, so the endpoint keeps working — just server-clock-relative — for
any caller that doesn't send it yet.

### One LLM call

A single `AIManager` call with a structured Pydantic response schema produces both the tip text and
the suggestion copy, grounded in: `user_profiles.dietary_preferences`, **the user's pantry contents
and expiring items as their own section of the prompt**, and — only when there is a suggestion — the
chosen recipe's title and the pantry items that made it win. Never call the Gemini SDK directly.

**The pantry section must be independent of the recipe section — this was under-specified and wrong
in the original plan.** The first draft only interpolated the winning recipe's matched/expiring
ingredients, so the tip was only ever grounded in pantry data when there happened to be a suggestion,
and even then only in the sliver of the pantry that one recipe touched. Reviewed by rendering the
prompt for two users with different pantries, no dietary preferences, and no saved recipes: the
output was byte-identical, which is exactly the defect #225 exists to fix (every user seeing the same
tip). The pantry section — general contents plus what's expiring within a week — must be built and
interpolated regardless of whether a suggestion exists, so a user with zero saved recipes still gets
a tip grounded in something real about *their* kitchen. A test should assert on the rendered prompt
passed to the mocked `complete`, not only on its (trivially mockable) return value.

### Caching

Cache key: `user_id + local_date + pantry_revision + recipes_revision`.

`local_date` is computed using `tz_offset_minutes` (see "Timezone" above), not the server's own date
— otherwise the cache rolls over at the wrong moment for every non-UTC user.

The date component satisfies #225's "same tip persists across reloads within a day" and also fixes
#168's complaint that *"refreshing the page changes the suggestion with no change to pantry or time"*.

**The revision components are the design decision worth flagging — and the original plan's
`max(updated_at)` alone was insufficient, found by review.** A pure per-day cache would keep
suggesting a recipe built around ingredients the user has since used or thrown out, or a shop they
just did, or a recipe they just saved. A revision component is meant to invalidate on any of those.
But `max(updated_at)` alone misses deletion of any row that isn't the current newest: delete an
*older* expiring item and the max across the remaining rows doesn't change, so the cache key doesn't
change, and the endpoint keeps serving a suggestion built on an ingredient that's gone. Reproduced in
review: pantry `{chicken (older, expiring), rice (newest)}` → "Chicken soup"; delete the chicken →
identical revision, cache hit, still "Chicken soup" for a pantry with no chicken. The fix is to fold
in something that changes on *any* membership change, not just the newest row's timestamp — a
fingerprint of the row-id set (order-independent) alongside the row count, combined with
`max(updated_at)` to still catch in-place edits (e.g. a corrected expiry date) that don't change
membership. `recipes_revision` gets the identical treatment for the identical reason: saving a recipe
is plausibly the single most common thing a user does right before opening the dashboard, and the
original plan didn't include a recipe-set revision component at all, so a newly-saved recipe would
never be considered until the date rolled over.

### Fallback

If every provider is unavailable or generation fails, return `source: "fallback"` with the existing
static tip list and a deterministically ranked suggestion carrying `reason: "fallback"` and
templated copy. The dashboard must never show an error or a blank tip — degrade, don't break.

**The fallback path is the one path that must never raise, which means it must not assume its own
inputs are well-formed either.** Review found a bug where a malformed `recipe_id` reaching the
fallback path (via a bare `UUID(recipe_id)` call with no guard) raised *inside the fallback itself*,
propagating uncaught past a docstring that promised it never would. Any field the fallback path
depends on to build a `DashboardSuggestion` (chiefly the recipe id) must degrade that one field
(`suggestion: null`) rather than raise, exactly as `_ai_response` already does for a null AI-generated
copy string.

## Delivery

Two PRs, in order:

1. **Backend** — endpoint, ranking, cache, fallback, Pydantic schemas, tests. Shippable and testable
   with no UI change.
2. **Frontend** — `HeroHome` consumes it through a per-domain client in `nextjs/src/lib/api/`
   (no ad hoc `fetch` in the component), deletes the hardcoded `tips` array, and replaces the
   `pickRandomRecipe` call. Keep the static array as the client-side fallback.

`pickRandomRecipe` loses its last caller at that point and should be deleted with it — noting that
#306 introduced it and #314 already reduces it to one caller.

## Acceptance

- Tip is per-user, not identical across accounts; grounded in at least one real signal — and grounded
  in the pantry specifically even when there is no recipe suggestion (two different pantries, no
  saved recipes, no dietary prefs must not render the same prompt).
- Tip and suggestion are stable across reloads within a day, and change when the pantry changes —
  including a deletion that isn't the pantry's most-recently-updated row, and including a newly
  saved recipe.
- The ranking's meal-time bucket agrees with the rule that tags `recipe.meal_type`
  (`domain/mealtime.py`, shared with `_default_meal_type`), not with the dashboard greeting's clock —
  those are two different rules serving two different purposes (matching vs. wording).
- The meal-time bucket and the cache's "local date" are computed from the client's own UTC offset
  (`tz_offset_minutes`), not the server's, so a non-UTC user's suggestion agrees with their own clock.
- The suggested recipe is one the user has saved (never hallucinated), and its ranking is unit-tested
  against fixed pantry/time inputs without invoking an LLM.
- A recipe whose ingredients are expiring outranks one whose are not, all else equal.
- A recipe that wins purely on the recency tie-break (zero real signal) reports `reason: "fallback"`,
  not `"pantry_match"`.
- With all AI providers down, the dashboard still renders a tip and a suggestion — and does so even
  when the winning recipe has a malformed id, degrading to `suggestion: null` rather than raising.
- No direct SDK calls; everything through `AIManager`.
- A user with no saved recipes gets `suggestion: null` and no error.

## Out of scope

- Full taste profiling (#46).
- A dedicated "topics I'm interested in" profile field — dietary preferences plus pantry are enough
  for a first version; add the field as a fast-follow if too coarse.
- Any change to the "Only N min!" figure, which is real metadata and correct.
