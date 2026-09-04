/**
 * Unit tests for `ingredientRowsToPayload` — the pure save-payload builder
 * for `RecipeEditModal`'s ingredient rows (#322).
 *
 * The bug: `RecipeEditModal` used to flatten every ingredient to a display
 * string on open (`toIngStr`) and write that `string[]` back on save,
 * unconditionally — so opening the modal and saving with zero edits still
 * destroyed `preparation`, `optional`, and object shape for every row.
 *
 * The fix keeps each row's original element alongside its editable text and,
 * on save, emits the original verbatim when the text is unchanged from
 * `ingredientLabel(original)` — so an untouched row round-trips exactly,
 * and only a row the user actually edited degrades to a string.
 */

import { ingredientLabel, ingredientRowsToPayload, type IngredientRow } from '@/lib/recipe-helpers'
import type { RecipeIngredient } from '@/types/recipes'

/** Build rows the way `RecipeEditModal` initialises them from a loaded recipe. */
function rowsFromIngredients(ingredients: (string | RecipeIngredient)[]): IngredientRow[] {
  return ingredients.map((original) => ({ original, text: ingredientLabel(original) }))
}

describe('ingredientRowsToPayload', () => {
  it('AC1: no-op save — object rows with preparation and optional round-trip deep-equal', () => {
    const loaded: RecipeIngredient[] = [
      { name: 'flour', quantity: 2, unit: 'cups', preparation: null, optional: false },
      { name: 'egg', quantity: 1, unit: null, preparation: 'beaten', optional: false },
      { name: 'vanilla extract', quantity: null, unit: null, preparation: null, optional: true },
    ]

    const rows = rowsFromIngredients(loaded)
    const payload = ingredientRowsToPayload(rows)

    expect(payload).toEqual(loaded)
    // Not just deep-equal — the exact same objects, not reconstructed copies.
    payload.forEach((item, i) => expect(item).toBe(loaded[i]))
  })

  it('AC2: editing one row degrades only that row; the rest keep original object identity', () => {
    const loaded: RecipeIngredient[] = [
      { name: 'flour', quantity: 2, unit: 'cups', preparation: null, optional: false },
      { name: 'egg', quantity: 1, unit: null, preparation: 'beaten', optional: false },
      { name: 'salt', quantity: null, unit: null, preparation: null, optional: true },
    ]
    const rows = rowsFromIngredients(loaded)
    rows[1] = { ...rows[1], text: '2 eggs, beaten' }

    const payload = ingredientRowsToPayload(rows)

    expect(payload[0]).toBe(loaded[0])
    expect(payload[1]).toBe('2 eggs, beaten')
    expect(payload[2]).toBe(loaded[2])
  })

  it('AC3: an added row (original: null) is appended as a string; existing rows unchanged', () => {
    const loaded: RecipeIngredient[] = [
      { name: 'flour', quantity: 2, unit: 'cups', preparation: null, optional: false },
    ]
    const rows = rowsFromIngredients(loaded)
    rows.push({ original: null, text: 'a pinch of salt' })

    const payload = ingredientRowsToPayload(rows)

    expect(payload).toEqual([loaded[0], 'a pinch of salt'])
    expect(payload[0]).toBe(loaded[0])
  })

  it('AC4: a deleted row is dropped and survivors keep their original structure', () => {
    const loaded: RecipeIngredient[] = [
      { name: 'flour', quantity: 2, unit: 'cups', preparation: null, optional: false },
      { name: 'egg', quantity: 1, unit: null, preparation: 'beaten', optional: false },
      { name: 'salt', quantity: null, unit: null, preparation: null, optional: true },
    ]
    const rows = rowsFromIngredients(loaded)
    // Simulate deleting the middle row the way the modal's removeIngredient does.
    const afterDelete = rows.filter((_, i) => i !== 1)

    const payload = ingredientRowsToPayload(afterDelete)

    expect(payload).toEqual([loaded[0], loaded[2]])
    expect(payload[0]).toBe(loaded[0])
    expect(payload[1]).toBe(loaded[2])
  })

  it('AC5: a recipe whose ingredients are already strings round-trips unchanged', () => {
    const loaded = ['2 large eggs', 'a pinch of salt', 'butter']
    const rows = rowsFromIngredients(loaded)

    const payload = ingredientRowsToPayload(rows)

    expect(payload).toEqual(loaded)
    payload.forEach((item, i) => expect(item).toBe(loaded[i]))
  })

  it('AC6: a quantity of 0 round-trips as unchanged rather than registering as an edit', () => {
    const loaded: RecipeIngredient[] = [
      { name: 'chili flakes', quantity: 0, unit: 'tsp', preparation: null, optional: true },
    ]
    const rows = rowsFromIngredients(loaded)

    const payload = ingredientRowsToPayload(rows)

    expect(payload).toEqual(loaded)
    expect(payload[0]).toBe(loaded[0])
  })

  it('drops a row whose text is empty after trimming, whether typed or original', () => {
    const loaded: RecipeIngredient[] = [
      { name: 'flour', quantity: 2, unit: 'cups', preparation: null, optional: false },
    ]
    const rows: IngredientRow[] = [
      ...rowsFromIngredients(loaded),
      { original: null, text: '   ' },
    ]

    const payload = ingredientRowsToPayload(rows)

    expect(payload).toEqual([loaded[0]])
  })

  it('treats incidental whitespace around unedited text as a non-edit', () => {
    const loaded: RecipeIngredient[] = [
      { name: 'egg', quantity: 1, unit: null, preparation: 'beaten', optional: false },
    ]
    const rows: IngredientRow[] = [{ original: loaded[0], text: `  ${ingredientLabel(loaded[0])}  ` }]

    const payload = ingredientRowsToPayload(rows)

    expect(payload[0]).toBe(loaded[0])
  })
})
