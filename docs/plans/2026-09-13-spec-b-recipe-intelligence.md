---
type: spec
created: 2026-09-13
updated: 2026-09-13
spec: B
status: draft
depends-on: [spec-0]
coordinates-with: [spec-a]
---

# Spec B — Recipe intelligence

Third spec of the 5-spec master roadmap
(`docs/plans/2026-09-13-issue-triage.md`). Additive, high demo value. Can be
drafted / built in parallel with **Spec C**. Depends on **Spec 0** (#410) for
typed session/proposals; coordinates with **Spec A** (#412) where multi-component
meals touch the cook/deduction path.

Reshaped in the 2026-09-13 triage addendum around a **notification center as the
hub**: signals live in one durable in-app store (portable web→mobile; web push
is a later delivery channel reading the same store, not a dependency).

---

## Problem Statement

BubblyChef generates recipes but isn't yet an intelligent, tailored cooking
companion:

- **Saved recipes are unreachable from chat.** "make that butter chicken I
  saved" generates a brand-new recipe instead of finding the one you saved — the
  intent is absent entirely, not stubbed (#186).
- **The recipe text and a running timer are disconnected.** "simmer 15 minutes"
  means opening the phone's clock app and losing the flow; nothing links the
  step to a timer, and two things simmering at once has no support (#45).
- **Cooking depletes the pantry but produces no shopping list.** The app can see
  what ran out but can't turn it into something you take to the store (#42).
- **The app is entirely passive.** Items expire, you run out of things, and
  nothing tells you — no reason to reopen the app between shops (#43).
- **Follow-up chips are static and often wrong** — "What can I substitute?"
  under a doneness question, "How long does this take?" after the reply already
  said — a chip that doesn't match the message costs a tap and makes the
  assistant look like it wasn't reading (#317).
- **Chat only ever makes one all-in-one dish.** Ask for "chicken and potatoes"
  and every idea fuses them into one plate; the domain model has no concept of a
  *meal* (entrée + sides), so no phrasing gets you one (#289).
- **The profile doesn't shape anything.** Allergies, household size, dislikes,
  cuisines, and how hard to push expiring items are either absent or cosmetic —
  the assistant feels generic instead of *yours*, and (for allergies) it's a
  real safety gap (#395).

## Solution

BubblyChef becomes tailored and proactive:

- **Chat can find your saved recipes** — "show me my saved butter chicken"
  returns ranked recipe cards, distinct from generating something new.
- **Timers feel native** — a step's time mention becomes a tappable timer that
  runs in a glanceable cooking-session dock; multiple timers run at once; a
  finished timer lands as an entry in the notification center.
- **A grocery list generates itself** from cook depletions and low/expiring
  items, living on its own `/grocery` route (checkable, editable, shareable),
  which the notification center points to.
- **A notification center is the hub** — a bell/badge surfacing expiry alerts,
  pantry nudges, timer completions, and "5 items added → view list", so there's
  a reason to reopen the app.
- **Follow-up chips fit the message** — derived from what the assistant actually
  said, with the current static set as a safe fallback.
- **Chat can suggest a meal, not just a dish** — "a full meal, separate dishes"
  yields an entrée plus sides, each a recipe-shaped component with a role.
- **The profile shapes output** — allergies as hard "never suggest" constraints,
  household size scaling yields, dislikes filtered, cuisines biased, and a
  user-controlled expiry-priority (Off / Gentle / Aggressive).

## User Stories

1. As a cook, I want "make that butter chicken I saved" to find my saved recipe,
   so that I don't get a new invented one instead.
2. As a cook, I want saved-recipe results as ranked, tappable cards handling 0 /
   1 / many matches, so that I can pick the right one when several match.
3. As a cook, I want the assistant to tell "find my saved X" apart from "invent
   a new X", so that lookup and generation don't collide.
4. As a cook, I want a step's "simmer 15 minutes" to start a named timer on tap,
   so that I don't leave the recipe to use my phone's clock.
5. As a cook, I want several named timers running at once (pasta + sauce), so
   that a multi-pot recipe is manageable.
6. As a cook, I want running timers glanceable while I cook, so that I can check
   them without navigating away.
7. As a cook, I want a finished timer to show up in my notification center, so
   that I don't miss it if I looked away.
8. As a cook, I want a grocery list generated from what I depleted and what's
   low, so that I know what to buy without reconstructing it by hand.
9. As a cook, I want the grocery list on its own page I can check off and edit,
   so that it's usable in the store.
10. As a cook, I want to share/copy the grocery list, so that I can take it out
    of the app.
11. As a cook, I want to be told when pantry items are expiring, so that I use
    them before they spoil.
12. As a cook, I want a single place (a bell/inbox) for expiry alerts, nudges,
    and timer completions, so that signals aren't scattered or lost.
13. As a cook, I want the inbox to point me to my grocery list ("5 items added →
    view list"), so that the pieces connect.
14. As a cook, I want follow-up chips that match what the assistant just said, so
    that tapping one asks a question that actually follows.
15. As a cook, I want the chip row to fall back to a sensible default rather than
    disappear when nothing better fits, so that there's always a gentle nudge.
16. As a cook, I want "a full meal, separate dishes" to give me an entrée plus
    sides, so that I get a meal, not three variations of one plate.
17. As a cook, I want each meal component to carry its own ingredients and role
    (main / side / starch), so that the meal reads as a coherent whole.
18. As a cook with an allergy, I want the assistant to *never* suggest that
    ingredient, so that suggestions are safe, not just preferred-against.
19. As a cook, I want generated recipes to default to my household size, so that
    yields match how many I cook for.
20. As a cook, I want disliked ingredients kept out of suggestions, so that I
    stop seeing cilantro I'll never use.
21. As a cook, I want suggestions biased toward cuisines I like, so that the
    assistant feels tuned to me.
22. As a cook, I want to control how hard the assistant pushes expiring items
    (Off / Gentle / Aggressive), so that an explicit dish request isn't hijacked
    by expiry urgency.

## Implementation Decisions

**Depends on Spec 0 (#410):** typed session/proposal foundation. **Coordinates
with Spec A (#412):** the multi-component meal (#289) touches the cook flow and
deduction, which Spec A owns — Spec B scopes only the brainstorm/generation half
of #289 and defers the cook-flow-for-multicomponent slice to land against Spec A's
deduction seam.

### #186 — saved-recipe lookup (do first; feature gap)

Four slices (per the issue's decided scope):
1. **Repository search method** — fuzzy match a user's saved recipes by
   name/text via Postgres trigram or full-text search, ranked (not exact/ilike).
   Only fetch-by-id exists today.
2. **Intent** — new enum member + classifier wiring (LLM prompt + mapping).
3. **Disambiguation** — classifier must tell "find my saved X" from "generate a
   new X"; prompt tuning + tests.
4. **Handler + ranked recipe cards** — 0 / 1 / many matches; reuse the tappable
   recipe-card treatment (#106) for presentation.

### Notification center (#43) — the hub. Ship a **lite inbox first**.

- **Lite inbox first:** a bell/badge in the header + dropdown, **compute-on-load**
  (or a daily job over pantry `expiry` dates) — no persistence, no read/unread.
  Content: expiring items (`days_until_expiry` is live), low-stock nudges, timer
  completions, and a grocery pointer.
- **Then** a fully persisted inbox with read/unread **only if it earns its keep**.
- In-app first (no permissions, universal). **Web push is a later delivery
  channel** reading the same store — explicitly not this spec.
- Open (settle in ticket): max entries before it's noise; whether triggers are
  user-configurable; bell placement (header vs bottom-nav badge).

### #45 — timers as a cooking-session dock (feeds the inbox)

- Timers live as a **cooking-session dock** — glanceable on the recipe screen
  while cooking (floating bar / stacked badges), supporting **multiple concurrent
  named timers**. Timers are *not* managed from the inbox.
- **Completion lands in the notification center** as an entry.
- Shape: lean to **C (hybrid)** — header quick-set (Prep/Cook/Total, no parsing)
  + step-level ⏱ chips where a duration is parseable in the instruction text.
  Full auto-advancing cook-mode (shape D) is the #273 prototype's call in Spec A,
  not decided here.

### #42 — grocery list on its own `/grocery` route

- A dedicated **`/grocery` route**: checkable, editable list generated from cook
  depletions (`times_cooked`/`last_cooked_at` shipped) + low-stock + expiring-
  with-no-recipe + manual "add to list". The inbox **points to** it; the list
  does not live inside the inbox.
- Shareable (copy to clipboard / native share sheet).
- Settle in ticket: persist between sessions vs regenerate on demand; whether
  cook-flow "missing ingredients" auto-add.

### #317 — context-aware follow-up chips

- **Hybrid:** model-generated follow-ups carried in the same structured response
  envelope (no second round trip, no added latency), falling back to the current
  static set when none are usable. Never render an empty chip row.
- Keep `resolveChips` **pure and unit-testable** (the #313 extraction is the
  right shape); this changes *what feeds it*, not where it lives. Chip count
  stays 2–3.

### #289 — meals, not one all-in-one dish (brainstorm half here; cook half → Spec A)

- **In Spec B:** `RecipeConstraints` gains `meal_structure`
  (`single_dish | multi_component | None`), extracted from phrasing ("a full
  meal", "with sides", "separate dishes", "just one dish"); a meal-level result
  type whose components each carry a `RecipeCard`-shaped payload + a role
  (main/side/starch/veg/sauce) with combined timing and a merged ingredient
  view; brainstorm proposes *meals* in multi-component mode. Also relax the
  "60%+ of listed ingredients in one dish" rule that actively pushes kitchen-sink
  dishes.
- **Deferred to coordinate with Spec A:** cook flow + deduction + library
  handling of a multi-component recipe (the largest slice; where the meal result
  type meets the deduction seam). This is where #289 and Spec A's cook seam meet.
- Open (settle in ticket): meal structure inferred from phrasing vs an explicit
  chat affordance vs a profile preference — inference alone already failed the
  user, so an explicit affordance is likely needed.

### #395 — profile cooking-context (core-value pillar, `priority:high`)

- Fields, each with a **defined consumption point** (recipe-generation
  constraints and/or chat system prompt) — not cosmetic:
  - **Allergies = hard constraints** ("never suggest"), distinct from dietary
    **preferences** ("prefer"). Real safety value; carried into generation as a
    hard filter.
  - **Household size** → default servings / yield scaling.
  - **Disliked ingredients** → filtered out of suggestions.
  - **Favorite cuisines** → bias suggestions.
  - **Expiry-priority (Off / Gentle=default / Aggressive)** → user control over
    how hard expiring items are pushed. **An explicit dish request always wins
    over expiry urgency regardless of the setting.** This is the user-facing fix
    direction for #288; coordinate with #336/#347 so the setting and internal
    weighting don't fight.
- **First slice:** wire the existing dead dietary-preference chips (#394) — the
  natural entry; this issue extends the same profile section.
- Coordinate-not-merge: chef skill level + Bubbles tone (#392) share the section
  but are personalization, tracked separately.

## Testing Decisions

Good tests assert external behavior. Seams by area:

1. **Saved-recipe lookup (#186)** — repository search returns ranked matches for
   a query; classifier routes "find my saved X" to lookup and "invent X" to
   generation (the disambiguation is the risk). Prior art: existing classifier
   tests + repository tests.
2. **Profile → generation constraints (#395)** — the master safety seam: given a
   profile with an allergen, generation/chat **never** proposes it; household
   size sets default servings; dislikes are filtered; expiry-priority modulates
   ranking but an explicit dish request overrides. Test at the constraint-
   extraction / grounding boundary. Prior art: `score_and_rank` / grounding
   tests.
3. **Meal structure (#289)** — `meal_structure` extraction from phrasing;
   multi-component brainstorm returns components-with-roles, not alternatives.
   Backend seam at brainstorm/constraint extraction. (Cook/deduction for
   multi-component tested under Spec A.)
4. **Chips (#317)** — `resolveChips` stays pure: given a response envelope with
   model suggestions, returns them; with none, returns the static fallback; never
   empty. Prior art: #313's chip tests.
5. **Grocery generation (#42)** — given cook depletions + low/expiring rows, the
   generated list contains the right items. Backend seam.
6. **Inbox content (#43)** — given pantry expiry/low state + a completed timer,
   the computed inbox surfaces the right entries. Compute-on-load seam.
7. **Timers (#45)** — component/interaction: parse a duration from step text,
   start/label a timer, run multiple concurrently, completion emits an inbox
   entry. Frontend seam.

## Out of Scope

- **Chat state machine / typed session** — Spec 0 (#410).
- **Cook-flow + deduction handling of multi-component meals** — coordinated into
  Spec A (#412); Spec B does the brainstorm/generation half of #289 only.
- **Web push notifications / service worker / PWA** — a later delivery channel
  over the same inbox store; not this spec.
- **Persisted inbox with read/unread** — only if the lite compute-on-load inbox
  earns it.
- **Full auto-advancing cook-mode timers (shape D)** — the #273 prototype (Spec A).
- **Taste profiling (#46)** — Phase 5; a downstream consumer of #42.
- **Guest save-account trap (#393), dead dietary chips beyond wiring (#394),
  chef-skill/tone (#392)** — adjacent profile issues tracked separately; #394's
  wiring is #395's first slice, the rest are not this spec.

## Further Notes

- **Notification-center-as-hub is the organizing decision** (triage addendum):
  #43 is the hub, #45 completions feed it, #42 lives on `/grocery` and the inbox
  points to it. Build the lite inbox first so the hub exists before the feeders.
- **Data substrate is already live:** `days_until_expiry` (`pantry-helpers.ts`),
  `/pantry/expiring`, `times_cooked` / `last_cooked_at`, migration 00006. These
  features surface existing data proactively rather than needing new plumbing.
- **#395 overlaps #288 / #336 / #347 / #394 / #392 / #393** — coordinate the
  expiry-priority setting with the internal weighting work so they don't fight.
- **#186 pairs with #106** (tappable recipe cards) for presentation.
- Recommended pull-forward for demo value: **#45 (timers) and #186 (saved-recipe
  lookup)** can run alongside Spec A rather than waiting for all of Spec B.
