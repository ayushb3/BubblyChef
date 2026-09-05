# Preserve ingredient structure through the edit modal (#322)

**Status:** plan · **Issue:** #322 · **Related:** #315 (the reader-side fix, PR #323)

## Problem

`RecipeEditModal` flattens every ingredient to a display string on open and writes
that `string[]` back on save. Structure is destroyed for **every** row, including
rows the user never touched — opening the modal and pressing Save is enough.

The path:

1. `RecipeEditModal.tsx:7` — `toIngStr` collapses each element to `"qty unit name"`.
2. `:25` — that `string[]` becomes the editing state.
3. `:54` — `handleSave` sends `ingredients: ingredients.filter(Boolean)`.
4. `app/api/recipes/[id]/route.ts:39` — `ingredients` is an allowed update field,
   written through verbatim into a JSONB column that accepts either shape.

Lost: `preparation` (a cooking instruction — "minced", "diced"), `optional` (the
"optional" tag), and possibly `substitutes` (see the caveat below). `quantity` and
`unit` survive only as text, and the cook matcher re-derives them by regex on every
cook via `_parse_ingredient_string`.

### Caveat on `substitutes`

Established: it is real in the backend model (`models/recipe.py:20`) and populated
on the recipe workflow path (`workflows/recipe/nodes.py:921`). But
`recipe_generator.py:457` hardcodes it to `[]`, and it is absent from the frontend
TypeScript type. Whether a non-empty `substitutes` actually reaches the DB is
**unconfirmed** — no DB access. Treat preserving it as desirable-if-free, not as a
requirement. `preparation` and `optional` need no caveat: they are in the frontend
type, rendered on the detail page, and definitively dropped.

## Approach: preserve originals, re-parse only what changed

Three options were considered (see the issue). Chosen: **option 3**.

- *Parse strings back to objects on save* — cheapest, but re-parses every row
  through a best-effort regex, so it can corrupt rows the user never touched. It
  turns a guaranteed loss into a probabilistic corruption, which is worse.
- *Structured per-ingredient fields in the modal* — lossless, but a substantial UI
  change and a different ticket's worth of design work.
- *Preserve originals, re-parse only touched rows* — lossless for untouched rows,
  which is the overwhelmingly common case (edit the title, fix a typo in step 3,
  save). No new parser. Minimal UI change. **Chosen.**

### Design

The core change is to row identity. Today the modal holds `string[]`, so a row's
original element is unrecoverable once flattened, and adding or deleting a row
shifts every index after it.

Replace the parallel `string[]` with a single array of row records:

```ts
interface IngredientRow {
  /** The element exactly as loaded. `null` for a row the user added. */
  original: string | Ingredient | null
  /** Current textarea contents. */
  text: string
}
```

Initialise `text` from `ingredientLabel(original)` — reuse the shared helper from
`lib/recipe-helpers.ts` rather than `toIngStr`; see "Consolidation" below.

On save, per row:

| Row state | Emit |
|---|---|
| `original !== null` and `text` equals `ingredientLabel(original)` | `original` **verbatim** |
| `original !== null` and `text` differs | `text` (the string — status quo) |
| `original === null` (user-added) | `text` |
| `text` is empty after trim | drop the row |

So a save with no ingredient edits is a structural no-op, and a save that edits one
row degrades only that row.

Compare with `text.trim() === ingredientLabel(original).trim()` so incidental
whitespace does not count as an edit.

### Consolidation

`toIngStr` (`RecipeEditModal.tsx:7`) is a fourth copy of the ingredient-label rule
and it **disagrees** with the shared helper: it uses `.filter(Boolean)`, which drops
a `quantity` of `0`, whereas `ingredientLabel` treats `0` as present. Delete
`toIngStr` and use `ingredientLabel` so round-tripping is exact — if the two
disagree, an untouched row would compare as edited and lose its structure. **This
is load-bearing for correctness here, not a tidy-up.**

Depends on `ingredientParts`/`ingredientLabel` from PR #323. If #323 has not landed,
rebase onto it rather than duplicating the helper.

## Scope

**In:** ingredient structure preservation in `RecipeEditModal`, deleting `toIngStr`
in favour of the shared helper, tests.

**Out:**
- The equivalent problem for `instructions`. `toStepStr` flattens
  `{text?, step?}` objects the same way. Verify whether that shape actually occurs
  in stored data; if it does, file a sibling issue rather than widening this one.
- Structured per-field editing UI (option 2).
- Any backfill or migration of rows already flattened. Data already lost stays lost;
  this stops the bleeding.

## Acceptance

1. Open a recipe with object-shaped ingredients carrying `preparation` and
   `optional`, save without editing → stored JSON is deep-equal to what was loaded.
2. Edit one ingredient's text, save → that row is a string, every other row keeps
   its original object identity.
3. Add a row → appended as a string; existing rows unchanged.
4. Delete a row → the correct row is dropped and the survivors keep their structure
   (this is the case index-shifting breaks).
5. A recipe whose ingredients are already strings round-trips unchanged.
6. A `quantity: 0` row round-trips as unchanged rather than registering as an edit.

## Tests

Unit tests on the save-payload builder — extract the row→payload mapping as a pure
function so it can be tested without driving the modal. Plus a component test for
the delete-then-save case, which is where index-based identity fails.

Each test must be verified to fail against current `main`.
