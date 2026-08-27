# Cook-flow backlog — sequenced from #242

*Captured 2026-08-27, after PR #271 (cook-flow redesign + review fixes) was pushed.*

Ordering principle: closest to the code just shipped first. Issues #262–#269 are
all fallout from the #242 redesign — they came out of a QA pass on the live
build. The rest of the repo backlog is unrelated and not sequenced here.

## Shipped

- **#242** — cook ungated from save; guided vs deduction split into separate
  affordances; router brainstorm trapdoor closed. PR #271, commits `1448aff`
  (feature) + `2975ec0` (review fixes).
  - Verified live signed-in: draft POST carries `is_draft: true`, drafts stay
    out of the library, "Add to library?" fires on the `I already made this`
    path, promotion moves the row into the library, and a brainstorm-flavoured
    follow-up in COOKING mode no longer unpins the recipe.

## Tier 1 — same files, small, one PR

Two of these are regressions introduced by #271.

| Issue | What | Where |
|---|---|---|
| **#262** | `👩‍🍳 Cook with me` overflows the card; spring animation scales past the boundary | `ChatRecipeCard.tsx` — the `w-full` primary added in #271 |
| **#269** | Card should go inert once `Cook with me` is tapped — otherwise `I already made this` on an already-cooking recipe is a double-deduction path | `ChatRecipeCard.tsx` + `chat/page.tsx`; the other half of the `cookState` prop |
| **#268** | COOKING NOW banner persists after completing a cook and choosing "Not now" | `CookModal.tsx` + `chat/page.tsx` — the draft success branch never clears `?cooking=`, unlike the redirect branch |

**Decision (user, 2026-08-27):** #269 — the card is inert **forever** once
`Cook with me` is tapped. Not scoped to "while this recipe is pinned".

## Tier 2 — design first, not a patch

- **#267** — show the pantry deduction preview *before* cooking, not after.
  Inverts the modal's role from post-hoc accounting to pre-cook planning.
- **#245** — confirm is the primary CTA while ingredients are unresolved, and
  unresolved rows are silently skipped (`deductQty <= 0` drops them).

These are the same problem seen from two angles — this is audit item **B6**,
explicitly scoped out of the #242 plan. **Fold #245 into #267** and design once.

## Tier 3 — the unfinished half of #242

- **#263** — step-by-step guided cooking. Today "Cook with me" only pins a
  recipe and hands off to chat; the guided UI (timers, step advancement) was
  deliberately out of scope in the #242 plan. Prototype issue **#273** and map
  **#272** already cover this.
- **#266** — follow-up on a picked recipe restarts brainstorm instead of
  modifying it. Related to **#274**. Plausibly the same class of bug as the
  COOKING trapdoor, one layer up in `RECIPE_EXPLORING`.

## Adjacent, not sequential

- **#265** — no recent chat history, session lost on navigation. Unrelated to
  cook, but sounds severe.
- **#231** — `gemini-2.5-flash` slated for retirement. A clock, not a feature.

## Audit items still open from `docs/plans/2026-08-24-ux-audit.md` §B

- **B6** → #267 / #245 (above)
- **B8** — cook match takes ~6.7 s with only static "Checking your pantry…" text
- B7 (uncancellable redirect timer) was fixed in #271
