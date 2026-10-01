/**
 * Issue #868: the recipe card's own "N to buy" key (the dish card in a meal and
 * the chat recipe card) puts the same amounts on the grocery list as the meal
 * page's line does (issue #850): quantity, unit and category, never a bare name,
 * and never over an amount the user already typed on the list.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import RecipeCard from '@/components/recipes/RecipeCard'
import { toBuyEntriesByDish, toBuyEntriesFromRecipe, toBuyByDish } from '@/lib/meal-to-buy'
import type { MealToBuyDetail } from '@/lib/api/grocery'
import { addToGroceryList, loadGroceryLines } from '@/lib/grocery-store'
import type { ChatRecipeData } from '@/types/chat'

const getUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => getUser() } }),
}))

beforeEach(() => {
  window.localStorage.clear()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

const DETAIL: MealToBuyDetail = {
  names: ['feta', 'parsley', 'lemon'],
  items: [
    { name: 'feta', dishPositions: [0], dishNames: ['crumbled feta'], quantity: 200, unit: 'g', category: 'dairy' },
    {
      name: 'parsley',
      dishPositions: [0, 1],
      dishNames: ['parsley', 'fresh parsley'],
      quantity: null,
      unit: null,
      category: 'produce',
    },
    { name: 'lemon', dishPositions: [1], dishNames: ['lemon'], quantity: 2, unit: null, category: 'produce' },
  ],
}
const DISHES = [
  { position: 0, names: ['crumbled feta', 'parsley'] },
  { position: 1, names: ['fresh parsley', 'lemon'] },
]

describe('toBuyEntriesByDish', () => {
  it("gives each dish the meal's amount, unit and category for the foods it needs", () => {
    const entries = toBuyEntriesByDish(DETAIL, DISHES)
    expect(entries.get(0)).toEqual([
      { name: 'feta', quantity: 200, unit: 'g', category: 'dairy' },
      { name: 'parsley', quantity: null, unit: null, category: 'produce' },
    ])
    expect(entries.get(1)).toEqual([
      { name: 'parsley', quantity: null, unit: null, category: 'produce' },
      { name: 'lemon', quantity: 2, unit: null, category: 'produce' },
    ])
  })

  it('lines up one-for-one with the names the card shows', () => {
    const names = toBuyByDish(DETAIL, DISHES)
    const entries = toBuyEntriesByDish(DETAIL, DISHES)
    for (const position of [0, 1]) expect(entries.get(position)).toHaveLength(names.get(position)!.length)
  })

  it('falls back to bare names from an older service that sent no items', () => {
    const entries = toBuyEntriesByDish({ names: ['feta'], items: null }, [{ position: 0, names: ['feta'] }])
    expect(entries.get(0)).toEqual(['feta'])
  })
})

describe('toBuyEntriesFromRecipe', () => {
  const recipe: ChatRecipeData = {
    title: 'Lemon pasta',
    ingredients: [
      { name: 'spaghetti', quantity: 200, unit: 'g' },
      { name: 'Parmesan', quantity: 50, unit: 'g' },
      { name: 'lemon', quantity: 2, unit: null },
      { name: 'basil', quantity: null, unit: null },
    ],
    ingredient_availability: [
      { name: 'spaghetti', status: 'have' },
      { name: 'parmesan', status: 'missing' },
      { name: 'lemon', status: 'missing' },
      { name: 'basil', status: 'missing' },
    ],
  }

  it("takes each missing food's own amount and unit from the recipe's ingredients", () => {
    expect(toBuyEntriesFromRecipe(recipe)).toEqual([
      { name: 'Parmesan', quantity: 50, unit: 'g' },
      { name: 'lemon', quantity: 2, unit: null },
      { name: 'basil', quantity: null, unit: null },
    ])
  })

  it('is undefined while the pantry has not graded the recipe', () => {
    expect(toBuyEntriesFromRecipe({ ...recipe, ingredient_availability: undefined })).toBeUndefined()
  })

  it('keeps a missing food the ingredients list does not name, as a bare name', () => {
    expect(
      toBuyEntriesFromRecipe({
        title: 'x',
        ingredients: [],
        ingredient_availability: [{ name: 'salt', status: 'missing' }],
      }),
    ).toEqual(['salt'])
  })
})

describe('the dish card key (a saved meal)', () => {
  it('hands the amounts to onAddToGrocery', async () => {
    const onAddToGrocery = jest.fn().mockResolvedValue(undefined)
    const entries = toBuyEntriesByDish(DETAIL, DISHES).get(0)!
    render(
      <RecipeCard
        variant="dish"
        role="main"
        title="Feta salad"
        ingredients={[]}
        instructions={[]}
        toBuy={['crumbled feta', 'parsley']}
        toBuyEntries={entries}
        onAddToGrocery={onAddToGrocery}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to grocery list' }))
    await waitFor(() => expect(onAddToGrocery).toHaveBeenCalledWith(entries))
  })

  it('writes lines with amount, unit and category, and keeps an amount the user typed', async () => {
    // The user already has feta on the list at 1 block.
    addToGroceryList('u1', [{ name: 'feta', quantity: 1, unit: 'block' }])

    const entries = toBuyEntriesByDish(DETAIL, DISHES).get(0)!
    render(
      <RecipeCard
        variant="dish"
        role="main"
        title="Feta salad"
        ingredients={[]}
        instructions={[]}
        toBuy={['crumbled feta', 'parsley']}
        toBuyEntries={entries}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to grocery list' }))
    expect(await screen.findByRole('status')).toHaveTextContent('2 on your grocery list')
    const lines = loadGroceryLines('u1')
    expect(lines.find((l) => l.key === 'feta')).toEqual(expect.objectContaining({ quantity: 1, unit: 'block' }))
    expect(lines.find((l) => l.key === 'parsley')).toEqual(expect.objectContaining({ category: 'produce' }))
  })
})

describe('the chat recipe card key', () => {
  const recipe: ChatRecipeData = {
    title: 'Lemon pasta',
    ingredients: [
      { name: 'spaghetti', quantity: 200, unit: 'g' },
      { name: 'Parmesan', quantity: 50, unit: 'g' },
      { name: 'lemon', quantity: 2, unit: null },
    ],
    instructions: ['Boil.'],
    ingredient_availability: [
      { name: 'spaghetti', status: 'have' },
      { name: 'parmesan', status: 'missing' },
      { name: 'lemon', status: 'missing' },
    ],
  }

  it('adds each missing food with the amount the recipe gives', async () => {
    render(<RecipeCard variant="chat" recipe={recipe} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to grocery list' }))
    expect(await screen.findByRole('status')).toHaveTextContent('2 on your grocery list')
    const lines = loadGroceryLines('u1')
    expect(lines.find((l) => l.key === 'parmesan')).toEqual(expect.objectContaining({ quantity: 50, unit: 'g' }))
    expect(lines.find((l) => l.key === 'lemon')).toEqual(expect.objectContaining({ quantity: 2, unit: null }))
  })

  it('never overwrites an amount the user typed on the list', async () => {
    addToGroceryList('u1', [{ name: 'parmesan', quantity: 1, unit: 'wedge' }])

    render(<RecipeCard variant="chat" recipe={recipe} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to grocery list' }))
    await screen.findByRole('status')
    expect(loadGroceryLines('u1').find((l) => l.key === 'parmesan')).toEqual(
      expect.objectContaining({ quantity: 1, unit: 'wedge' }),
    )
  })
})
