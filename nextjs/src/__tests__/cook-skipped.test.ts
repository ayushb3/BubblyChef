/**
 * Issue #621 — `lib/cook-skipped.ts`: resolving the pantry item ids the server
 * refused to deduct into names, from a cook proposal.
 */

import { skippedDeductionNames } from '@/lib/cook-skipped'
import type { CompoundSuggestion, IngredientMatch } from '@/types/recipes'

function match(id: string | null, pantryName: string | null, ingredient = 'ingredient'): IngredientMatch {
  return {
    ingredient_name: ingredient,
    ingredient_qty: 1,
    ingredient_unit: null,
    pantry_item_id: id,
    pantry_item_name: pantryName,
    pantry_qty_available: 1,
    deduct_qty: 1,
    base_unit: 'count',
    status: 'ready',
    shortfall: null,
    match_type: 'exact',
    substitution_note: null,
  }
}

const compound: CompoundSuggestion = {
  ingredient_name: 'buttermilk',
  components: ['Milk', 'Lemon'],
  note: 'Mix',
  component_items: [
    { pantry_item_id: 'p-milk', name: 'Milk', base_unit: 'ml' },
    { pantry_item_id: 'p-lemon', name: 'Lemon', base_unit: 'count' },
  ],
}

describe('skippedDeductionNames', () => {
  it('resolves names from the matches', () => {
    const proposal = { matches: [match('p-butter', 'Butter'), match('p-flour', 'Flour')] }
    expect(skippedDeductionNames(proposal, ['p-flour', 'p-butter'])).toEqual({
      names: ['Flour', 'Butter'],
      unnamed: 0,
    })
  })

  it('resolves names from compound components', () => {
    const proposal = { matches: [match('p-butter', 'Butter')], compound_suggestions: [compound] }
    expect(skippedDeductionNames(proposal, ['p-milk', 'p-butter'])).toEqual({
      names: ['Milk', 'Butter'],
      unnamed: 0,
    })
  })

  it('collapses duplicates and keeps the order of ids', () => {
    const proposal = { matches: [match('p-a', 'Butter'), match('p-b', 'Butter'), match('p-c', 'Egg')] }
    expect(skippedDeductionNames(proposal, ['p-c', 'p-a', 'p-c', 'p-b'])).toEqual({
      names: ['Egg', 'Butter'],
      unnamed: 0,
    })
  })

  it('counts an unknown id as unnamed', () => {
    const proposal = { matches: [match('p-butter', 'Butter')] }
    expect(skippedDeductionNames(proposal, ['p-butter', 'p-ghost', 'p-ghost2'])).toEqual({
      names: ['Butter'],
      unnamed: 2,
    })
  })

  it('an empty list gives zero', () => {
    expect(skippedDeductionNames({ matches: [match('p-a', 'Butter')] }, [])).toEqual({
      names: [],
      unnamed: 0,
    })
  })

  it('handles a proposal with no compound_suggestions', () => {
    const proposal = { matches: [match('p-a', 'Butter')] }
    expect(skippedDeductionNames(proposal, ['p-x'])).toEqual({ names: [], unnamed: 1 })
  })

  it('handles a suggestion with no component_items', () => {
    const bare: CompoundSuggestion = { ingredient_name: 'x', components: [], note: '' }
    const proposal = { matches: [match('p-a', 'Butter')], compound_suggestions: [bare] }
    expect(skippedDeductionNames(proposal, ['p-a', 'p-x'])).toEqual({ names: ['Butter'], unnamed: 1 })
  })

  it('falls back to ingredient_name when pantry_item_name is null', () => {
    const proposal = { matches: [match('p-a', null, 'plain flour')] }
    expect(skippedDeductionNames(proposal, ['p-a'])).toEqual({ names: ['plain flour'], unnamed: 0 })
  })
})
