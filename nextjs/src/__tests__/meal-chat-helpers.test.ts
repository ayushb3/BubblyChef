/**
 * Issue #651 PR B — the pure helpers that build `context.meal_fixed_main`,
 * and `buildCreateMealPayload` linking a fixed saved main by id.
 */
import {
  buildCreateMealPayload,
  fixedMainForCard,
  fixedMainPayload,
} from '@/lib/meal-chat-helpers'
import type { ChatRecipeData, MealProposal } from '@/types/chat'

const recipe: ChatRecipeData = {
  title: '  Lemon Butter Pasta  ',
  description: 'Bright and quick',
  prep_time_minutes: 10,
  cook_time_minutes: 15,
  total_time_minutes: 25,
  difficulty: 'easy',
  servings: 4,
  cuisine: 'Italian',
  meal_type: 'dinner',
  dietary_tags: ['vegetarian'],
  ingredients: [
    { name: 'spaghetti', quantity: 400, unit: 'g' },
    { name: 'onion', quantity: 1, unit: null, preparation: 'diced', optional: true },
    { name: '   ', quantity: 1 },
    { name: '', quantity: 2 },
  ],
  instructions: ['Boil the pasta.', 'Toss with butter.'],
  ingredient_availability: [{ name: 'spaghetti', status: 'have' }],
}

describe('fixedMainPayload', () => {
  it('strips ingredient_availability and any id', () => {
    const payload = fixedMainPayload({ ...recipe, id: 'abc' } as ChatRecipeData)
    expect(payload).not.toHaveProperty('ingredient_availability')
    expect(payload).not.toHaveProperty('id')
  })

  it('drops blank-named ingredients and keeps preparation and optional', () => {
    const { ingredients } = fixedMainPayload(recipe)
    expect(ingredients).toEqual([
      { name: 'spaghetti', quantity: 400, unit: 'g' },
      { name: 'onion', quantity: 1, unit: null, preparation: 'diced', optional: true },
    ])
  })

  it('trims the title and copies the listed fields', () => {
    expect(fixedMainPayload(recipe)).toMatchObject({
      title: 'Lemon Butter Pasta',
      description: 'Bright and quick',
      instructions: ['Boil the pasta.', 'Toss with butter.'],
      prep_time_minutes: 10,
      cook_time_minutes: 15,
      total_time_minutes: 25,
      servings: 4,
      cuisine: 'Italian',
      meal_type: 'dinner',
      difficulty: 'easy',
      dietary_tags: ['vegetarian'],
    })
  })

  it("falls back to 'Untitled recipe' for a missing or blank title", () => {
    expect(fixedMainPayload({}).title).toBe('Untitled recipe')
    expect(fixedMainPayload({ title: '   ' }).title).toBe('Untitled recipe')
  })

  it('turns missing ingredients and instructions into empty arrays', () => {
    const payload = fixedMainPayload({ title: 'Toast' })
    expect(payload.ingredients).toEqual([])
    expect(payload.instructions).toEqual([])
  })
})

describe('fixedMainForCard', () => {
  it('sends the id when the card was saved', () => {
    expect(fixedMainForCard(recipe, 'recipe-1')).toEqual({ recipe_id: 'recipe-1' })
  })

  it.each([undefined, null, ''])('sends the payload when savedId is %p', (savedId) => {
    const ctx = fixedMainForCard(recipe, savedId)
    expect(ctx).toEqual({ recipe: fixedMainPayload(recipe) })
    expect(ctx).not.toHaveProperty('recipe_id')
  })
})

describe('buildCreateMealPayload', () => {
  const proposal = (mainId?: string | null): MealProposal => ({
    proposal_type: 'meal',
    meal_ref: 'ref-1',
    title: 'Pasta night',
    servings: 4,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
    missing_ingredients: [],
    dishes: [
      {
        role: 'main',
        position: 0,
        ...(mainId !== undefined ? { recipe_id: mainId } : {}),
        recipe: { title: 'Lemon Butter Pasta', instructions: ['Boil.'], servings: 4 },
      },
      {
        role: 'side',
        position: 1,
        recipe: { title: 'Green salad', instructions: ['Toss.'] },
      },
    ],
  })

  it('sends a fixed saved main as a reference with no recipe payload', () => {
    const { dishes } = buildCreateMealPayload(proposal('recipe-1'), true)
    expect(dishes[0]).toEqual({ role: 'main', position: 0, recipe_id: 'recipe-1' })
    expect(dishes[0]).not.toHaveProperty('recipe')
  })

  it('keeps the sides as new recipe payloads, at the meal servings', () => {
    const { dishes } = buildCreateMealPayload(proposal('recipe-1'), true)
    expect(dishes[1].recipe).toMatchObject({ title: 'Green salad', servings: 4 })
    expect(dishes[1]).not.toHaveProperty('recipe_id')
  })

  it.each([undefined, null, ''])('sends every dish as a payload when the main id is %p', (id) => {
    const { dishes } = buildCreateMealPayload(proposal(id), false)
    expect(dishes[0].recipe).toMatchObject({ title: 'Lemon Butter Pasta', servings: 4 })
    expect(dishes[0]).not.toHaveProperty('recipe_id')
    expect(dishes[1].recipe).toBeDefined()
  })

  it('carries the meal-level fields as before', () => {
    expect(buildCreateMealPayload(proposal('recipe-1'), true)).toMatchObject({
      title: 'Pasta night',
      servings: 4,
      is_draft: true,
      source_type: 'chat',
      source_ref: 'ref-1',
    })
  })
})
