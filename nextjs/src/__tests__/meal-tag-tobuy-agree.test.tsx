/**
 * Issue #805: on a meal's dish card, the ingredient tags and the "N to buy" line
 * agree. The demo showed "0.5 count onion" with no tag while the line listed
 * onion. A line the match endpoint calls `missing` now wears "To buy", so the
 * rows tagged To buy are exactly the names on the line, and nothing the line
 * leaves out wears it.
 *
 * `MATCHES` is the shape `/v1/pantry/match-ingredients` returns for the fixture
 * dish against a pantry with flour 500 g and butter 50 g and no onion (the
 * backend half of the contract is `ai-service/tests/test_issue_805_tag_tobuy_agree.py`,
 * which asserts these same statuses against `/v1/grocery/meal-to-buy`).
 */

import React from 'react'
import { render, screen, within } from '@testing-library/react'
import RecipeCard from '@/components/recipes/RecipeCard'
import { alignToRows, toLines } from '@/hooks/useIngredientMatches'
import { fetchIngredientMatches } from '@/lib/api/ingredient-match'
import { attributeToBuy } from '@/lib/meal-to-buy'
import { ingredientParts } from '@/lib/recipe-helpers'
import type { RecipeIngredient } from '@/types/recipes'

jest.mock('@/components/timers/HeaderQuickSetTimers', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/timers/StepTimerChip', () => ({ __esModule: true, default: () => null }))

const INGREDIENTS: RecipeIngredient[] = [
  { name: 'onion', quantity: 0.5, unit: 'count' },
  { name: 'saffron', quantity: 1, unit: 'g' },
  { name: 'butter', quantity: 100, unit: 'g' },
  { name: 'flour', quantity: 200, unit: 'g' },
  { name: 'water', quantity: 2, unit: 'l' },
]

const MATCHES = {
  matches: [
    { name: 'onion', status: 'missing', pantry_food: null, basis: 'none', pantry_qty_available: null, shortfall: null },
    { name: 'saffron', status: 'missing', pantry_food: null, basis: 'none', pantry_qty_available: null, shortfall: null },
    { name: 'butter', status: 'low', pantry_food: 'butter', basis: 'pantry', pantry_qty_available: 50, shortfall: 50 },
    { name: 'flour', status: 'have', pantry_food: 'flour', basis: 'pantry', pantry_qty_available: 500, shortfall: null },
    { name: 'water', status: 'have', pantry_food: null, basis: 'assumed', pantry_qty_available: null, shortfall: null },
  ],
}

// `/v1/grocery/meal-to-buy` for the same meal: the lines the match calls missing.
const TO_BUY = ['onion', 'saffron']

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => MATCHES,
  }) as unknown as typeof fetch
})

it('every to-buy item\'s row is tagged To buy (or Short), and no other row is', async () => {
  const { lines, rows } = toLines(INGREDIENTS)
  const matches = await fetchIngredientMatches(lines)
  const rowMatches = alignToRows(matches, rows, INGREDIENTS.length)
  const owned = attributeToBuy(TO_BUY, [
    { position: 0, names: INGREDIENTS.map((i) => ingredientParts(i).name) },
  ]).get(0)!

  render(
    <RecipeCard
      variant="dish"
      role="main"
      title="Onion soup"
      ingredients={INGREDIENTS}
      instructions={[]}
      rowMatches={rowMatches}
      toBuy={owned}
    />,
  )

  const list = screen.getByRole('heading', { name: 'Ingredients', hidden: true }).parentElement as HTMLElement
  const tagByName = new Map<string, string>()
  for (const row of within(list).getAllByRole('listitem')) {
    const name = INGREDIENTS.map((i) => i.name).find((n) => within(row).queryByText(n))!
    tagByName.set(name, within(row).queryByTestId('ingredient-tag')?.textContent ?? '')
  }

  // The issue's example: a half onion with none in the pantry is To buy, not untagged.
  expect(tagByName.get('onion')).toBe('To buy')
  for (const name of owned) expect(['To buy', 'Short ½']).toContain(tagByName.get(name))
  const taggedToBuy = [...tagByName].filter(([, tag]) => tag === 'To buy').map(([n]) => n)
  expect(taggedToBuy.sort()).toEqual([...owned].sort())
  expect(screen.getByText('2 to buy:')).toBeInTheDocument()
})
