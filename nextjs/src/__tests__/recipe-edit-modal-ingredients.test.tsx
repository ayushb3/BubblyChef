/**
 * Component-level regression test for #322: deleting an ingredient row in
 * `RecipeEditModal` must not corrupt the structure of the rows after it.
 *
 * Rows used to be a parallel `string[]`, so a row's original object was
 * unrecoverable once flattened and array index was the only identity —
 * deleting row 1 silently shifted rows 2+ under stale index-based state.
 * This drives the actual rendered modal (not just the pure payload builder)
 * to catch a regression in the delete handler itself.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecipeEditModal from '@/components/recipes/RecipeEditModal'
import type { Recipe } from '@/components/recipes/RecipePage'

const baseRecipe: Recipe = {
  id: 'r1',
  user_id: 'u1',
  title: 'Pancakes',
  description: 'Fluffy pancakes',
  ingredients: [
    { name: 'flour', quantity: 2, unit: 'cups', preparation: null, optional: false },
    { name: 'egg', quantity: 1, unit: null, preparation: 'beaten', optional: false },
    { name: 'vanilla extract', quantity: null, unit: null, preparation: null, optional: true },
    // quantity 0 is load-bearing: the deleted `toIngStr` used `.filter(Boolean)`
    // and dropped it, while `ingredientLabel` keeps it. Without a 0 in this
    // fixture the two agree everywhere, and a regression to the old
    // initialiser would pass the whole suite. See #322.
    { name: 'chili flakes', quantity: 0, unit: 'tsp', preparation: 'crushed', optional: true },
  ],
  instructions: ['Mix dry ingredients', 'Whisk in egg', 'Cook on griddle'],
}

describe('RecipeEditModal ingredient rows (#322)', () => {
  it('no-op save: an untouched recipe round-trips ingredients deep-equal to what was loaded', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    render(<RecipeEditModal recipe={baseRecipe} onSave={onSave} onClose={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0]
    expect(payload.ingredients).toEqual(baseRecipe.ingredients)
    payload.ingredients.forEach((item: unknown, i: number) => {
      expect(item).toBe(baseRecipe.ingredients[i])
    })
  })

  it('delete-then-save: removing the middle row drops it and keeps the survivors structured', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    render(<RecipeEditModal recipe={baseRecipe} onSave={onSave} onClose={jest.fn()} />)

    const removeButtons = screen.getAllByRole('button', { name: /remove ingredient/i })
    expect(removeButtons).toHaveLength(4)

    // Delete the middle row ("egg").
    fireEvent.click(removeButtons[1])

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0]
    expect(payload.ingredients).toEqual([
      baseRecipe.ingredients[0],
      baseRecipe.ingredients[2],
      baseRecipe.ingredients[3],
    ])
    expect(payload.ingredients[0]).toBe(baseRecipe.ingredients[0])
    expect(payload.ingredients[1]).toBe(baseRecipe.ingredients[2])
  })

  it('delete-then-edit-then-save: the surviving row after a delete keeps its own identity when edited', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    render(<RecipeEditModal recipe={baseRecipe} onSave={onSave} onClose={jest.fn()} />)

    // Delete the first row ("flour").
    const removeButtons = screen.getAllByRole('button', { name: /remove ingredient/i })
    fireEvent.click(removeButtons[0])

    // The remaining ingredient row (index 0 after the delete) should now be "1 egg".
    const eggInput = screen.getByDisplayValue('1 egg')

    // Edit what is now the first remaining row (the egg row) — this must not
    // touch the vanilla extract row, which sat at index 2 before the delete.
    fireEvent.change(eggInput, { target: { value: '2 eggs, beaten well' } })

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0]
    expect(payload.ingredients).toEqual([
      '2 eggs, beaten well',
      baseRecipe.ingredients[2],
      baseRecipe.ingredients[3],
    ])
    expect(payload.ingredients[1]).toBe(baseRecipe.ingredients[2])
  })
})
