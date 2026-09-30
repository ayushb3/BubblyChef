/**
 * Issue #654 PR B — `isRecipeAmendmentProposal` (`types/chat.ts`), the
 * frontend's only guard for the backend's `RecipeAmendmentProposal`.
 */

import { isRecipeAmendmentProposal, type RecipeAmendmentProposal } from '@/types/chat'

const validProposal: RecipeAmendmentProposal = {
  proposal_type: 'recipe_amendment',
  is_amendment: true,
  amended_ingredients: [
    { name: 'Greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null },
  ],
  change_summary: 'Swapped the cream for Greek yoghurt.',
  recipe_id: 'r1',
  recipe_title: 'Creamy pasta',
}

describe('isRecipeAmendmentProposal', () => {
  it('is true for a backend-shaped proposal', () => {
    expect(isRecipeAmendmentProposal(validProposal)).toBe(true)
  })

  it('is false for a meal proposal', () => {
    expect(
      isRecipeAmendmentProposal({
        proposal_type: 'meal',
        title: 'Dinner',
        servings: 4,
        constraints: {},
        dishes: [],
        missing_ingredients: [],
      }),
    ).toBe(false)
  })

  it('is false for a meal_options proposal', () => {
    expect(isRecipeAmendmentProposal({ proposal_type: 'meal_options' })).toBe(false)
  })

  it('is false for null', () => {
    expect(isRecipeAmendmentProposal(null)).toBe(false)
  })

  it('is false for an empty amended_ingredients list', () => {
    expect(isRecipeAmendmentProposal({ ...validProposal, amended_ingredients: [] })).toBe(false)
  })
})
