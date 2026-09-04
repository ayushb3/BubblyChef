# `GET /v1/dashboard/daily` — AI tips and a pantry-aware suggestion (#225, #168)

**Status:** plan · **Issues:** #225 (AI-generated, interest-tunable dashboard tip), #168 (dashboard recipe suggestion is random, not time- or pantry-aware)
**Depends on:** #306 / PR #318 (correct deep link + time-of-day wording), #314 (delete `BubblesFeed`)

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

`GET /v1/dashboard/daily` on the AI microservice, authed via `get_current_user_id` like every other
`/v1` route. It runs server-side where `SupabaseRepository` already reaches both pantry and recipes,
so the client makes one call instead of orchestrating three.

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
test can assert the ranking without asserting on LLM prose.

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
- **Time-of-day buckets** should reuse the same derivation the greeting uses rather than introducing
  a second clock-reading rule — the mistake #306 explicitly called out.
- Ties broken deterministically (e.g. most recently saved) so the same inputs always yield the same
  pick.
- Weights live in `config.py` as `BUBBLY_*` settings so they are tunable without a deploy. Note that
  `Settings` forbids extra keys, so any new name must be added to the model or the service dies at
  import.

### One LLM call

A single `AIManager` call with a structured Pydantic response schema produces both the tip text and
the suggestion copy, grounded in: the chosen recipe's title, the pantry items that made it win, and
`user_profiles.dietary_preferences`. Never call the Gemini SDK directly.

### Caching

Cache key: `user_id + local_date + pantry_revision`.

The date component satisfies #225's "same tip persists across reloads within a day" and also fixes
#168's complaint that *"refreshing the page changes the suggestion with no change to pantry or time"*.

**The `pantry_revision` component is the design decision worth flagging.** A pure per-day cache would
keep suggesting a recipe built around ingredients the user has since used or thrown out, and would
ignore a shop they just did — a stale suggestion that ignores the chicken you bought an hour ago is
its own bug. Including a pantry revision (max `updated_at` across the user's pantry rows, or a
counter) invalidates on real change while still collapsing repeated page loads.

### Fallback

If every provider is unavailable or generation fails, return `source: "fallback"` with the existing
static tip list and a deterministically ranked suggestion carrying `reason: "fallback"` and
templated copy. The dashboard must never show an error or a blank tip — degrade, don't break.

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

- Tip is per-user, not identical across accounts; grounded in at least one real signal.
- Tip and suggestion are stable across reloads within a day, and change when the pantry changes.
- The suggested recipe is one the user has saved (never hallucinated), and its ranking is unit-tested
  against fixed pantry/time inputs without invoking an LLM.
- A recipe whose ingredients are expiring outranks one whose are not, all else equal.
- With all AI providers down, the dashboard still renders a tip and a suggestion.
- No direct SDK calls; everything through `AIManager`.
- A user with no saved recipes gets `suggestion: null` and no error.

## Out of scope

- Full taste profiling (#46).
- A dedicated "topics I'm interested in" profile field — dietary preferences plus pantry are enough
  for a first version; add the field as a fast-follow if too coarse.
- Any change to the "Only N min!" figure, which is real metadata and correct.
