/**
 * Issue #805: on a meal's dish cards, the ingredient tags and the "N to buy" line
 * agree, card by card. The demo showed "0.5 count onion" with no tag while the line
 * listed onion. A line the match endpoint calls `missing` now wears "To buy", so the
 * rows tagged To buy on a card are exactly the names on that card's line.
 *
 * A food missing in two dishes is listed once by `/v1/grocery/meal-to-buy` (the
 * meal's own list and the grocery hand-off stay deduped), but BOTH cards list it:
 * the response's `items[].dish_positions` says which dishes each entry covers, with
 * the service's own "same food" key, so "fresh basil" in the soup and "basil" in the
 * salad are one entry on both cards. The client does not re-match names.
 *
 * `SOUP` / `SALAD` are the shape `/v1/pantry/match-ingredients` returns per dish
 * against a pantry with flour 500 g and butter 50 g and no onion, basil or saffron;
 * `RESPONSE` is the shape `/v1/grocery/meal-to-buy` returns for the same meal. The
 * backend half of the contract (`ai-service/tests/test_issue_805_tag_tobuy_agree.py`)
 * asserts these same statuses and attributions against the real routes.
 */

import React from 'react'
import { render, within } from '@testing-library/react'
import RecipeCard from '@/components/recipes/RecipeCard'
import { alignToRows, toLines } from '@/hooks/useIngredientMatches'
import { fetchIngredientMatches } from '@/lib/api/ingredient-match'
import { toBuyByDish } from '@/lib/meal-to-buy'
import { ingredientParts } from '@/lib/recipe-helpers'
import type { RecipeIngredient } from '@/types/recipes'

jest.mock('@/components/timers/HeaderQuickSetTimers', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/timers/StepTimerChip', () => ({ __esModule: true, default: () => null }))

const missing = (name: string) => ({
  name, status: 'missing', pantry_food: null, basis: 'none', pantry_qty_available: null, shortfall: null,
})

const SOUP_INGREDIENTS: RecipeIngredient[] = [
  { name: 'onion', quantity: 0.5, unit: 'count' },
  { name: 'saffron', quantity: 1, unit: 'g' },
  { name: 'fresh basil', quantity: 1, unit: 'bunch' },
  { name: 'butter', quantity: 100, unit: 'g' },
  { name: 'flour', quantity: 200, unit: 'g' },
  { name: 'water', quantity: 2, unit: 'l' },
]
const SOUP = [
  missing('onion'),
  missing('saffron'),
  missing('fresh basil'),
  { name: 'butter', status: 'low', pantry_food: 'butter', basis: 'pantry', pantry_qty_available: 50, shortfall: 50 },
  { name: 'flour', status: 'have', pantry_food: 'flour', basis: 'pantry', pantry_qty_available: 500, shortfall: null },
  { name: 'water', status: 'have', pantry_food: null, basis: 'assumed', pantry_qty_available: null, shortfall: null },
]

const SALAD_INGREDIENTS: RecipeIngredient[] = [
  { name: 'onion', quantity: 0.5, unit: 'count' },
  { name: 'basil', quantity: 1, unit: 'bunch' },
  { name: 'cucumber', quantity: 1, unit: 'count' },
  { name: 'flour', quantity: 10, unit: 'g' },
]
const SALAD = [
  missing('onion'),
  missing('basil'),
  missing('cucumber'),
  { name: 'flour', status: 'have', pantry_food: 'flour', basis: 'pantry', pantry_qty_available: 490, shortfall: null },
]

// `/v1/grocery/meal-to-buy` for the whole meal: onion and basil each appear once.
const RESPONSE = {
  to_buy: ['onion', 'saffron', 'fresh basil', 'cucumber'],
  items: [
    { name: 'onion', dish_positions: [0, 1], dish_names: ['onion', 'onion'] },
    { name: 'saffron', dish_positions: [0], dish_names: ['saffron'] },
    { name: 'fresh basil', dish_positions: [0, 1], dish_names: ['fresh basil', 'basil'] },
    { name: 'cucumber', dish_positions: [1], dish_names: ['cucumber'] },
  ],
}

const DISHES = [
  { position: 0, role: 'main' as const, title: 'Onion soup', ingredients: SOUP_INGREDIENTS, matches: SOUP },
  { position: 1, role: 'side' as const, title: 'Salad', ingredients: SALAD_INGREDIENTS, matches: SALAD },
]

const detail = (withItems: boolean) => ({
  names: RESPONSE.to_buy,
  items: withItems
    ? RESPONSE.items.map((i) => ({ name: i.name, dishPositions: i.dish_positions, dishNames: i.dish_names }))
    : null,
})

const attributed = (withItems = true) =>
  toBuyByDish(
    detail(withItems),
    DISHES.map((d) => ({ position: d.position, names: d.ingredients.map((i) => ingredientParts(i).name) })),
  )

/** Render one dish card the way the meal screen does, and read back what it shows. */
async function renderCard(dish: (typeof DISHES)[number], toBuy: string[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ matches: dish.matches }),
  }) as unknown as typeof fetch
  const { lines, rows } = toLines(dish.ingredients)
  const rowMatches = alignToRows(await fetchIngredientMatches(lines), rows, dish.ingredients.length)
  const { container } = render(
    <RecipeCard
      variant="dish"
      role={dish.role}
      position={dish.position}
      title={dish.title}
      ingredients={dish.ingredients}
      instructions={[]}
      defaultExpanded
      rowMatches={rowMatches}
      toBuy={toBuy}
    />,
  )
  const card = within(container)
  const list = card.getByRole('heading', { name: 'Ingredients', hidden: true }).parentElement as HTMLElement
  const tagged: string[] = []
  for (const row of within(list).getAllByRole('listitem')) {
    const name = dish.ingredients.map((i) => i.name).find((n) => within(row).queryByText(n))!
    if (within(row).queryByTestId('ingredient-tag')?.textContent === 'To buy') tagged.push(name)
  }
  const summary = container.querySelector('b')?.parentElement?.textContent ?? ''
  return { tagged, summary }
}

describe('a dish card\'s "N to buy" line and its To buy rows agree, per card (#805)', () => {
  it.each(DISHES)('$title: the rows tagged To buy are exactly the names on its line', async (dish) => {
    const owned = attributed().get(dish.position)!
    const { tagged, summary } = await renderCard(dish, owned)

    // The line names each food as this dish wrote it, so the names are the rows' own.
    expect([...tagged].sort()).toEqual([...owned].sort())
    expect(summary).toContain(`${owned.length} to buy:`)
    for (const name of owned) expect(summary).toContain(name)
  })

  it('the issue example: a half onion with none in the pantry is To buy on its card', async () => {
    const { tagged } = await renderCard(DISHES[0], attributed().get(0)!)
    expect(tagged).toContain('onion')
  })

  it('a food missing in two dishes is on both cards, and once on the meal list', async () => {
    const byDish = attributed()
    expect(byDish.get(0)).toEqual(['onion', 'saffron', 'fresh basil'])
    expect(byDish.get(1)).toEqual(['onion', 'basil', 'cucumber'])
    expect(RESPONSE.to_buy.filter((n) => n === 'onion')).toHaveLength(1)

    const salad = await renderCard(DISHES[1], byDish.get(1)!)
    expect(salad.tagged).toContain('onion')
    expect(salad.summary).toContain('3 to buy:')
  })

  it('"fresh basil" in one dish and "basil" in the other: the salad card lists basil', async () => {
    const salad = await renderCard(DISHES[1], attributed().get(1)!)
    expect(salad.tagged).toContain('basil')
    expect(salad.summary).toContain('basil')
  })

  it('an older service with no items: falls back to name matching (exact names agree; spellings may not)', () => {
    const byDish = attributed(false)
    // Names-only matching still gives onion to both cards ...
    expect(byDish.get(0)).toContain('onion')
    expect(byDish.get(1)).toContain('onion')
    // ... but "fresh basil" only reaches the dish that spells it that way: the
    // degradation the service's `items` exist to remove.
    expect(byDish.get(0)).toContain('fresh basil')
    expect(byDish.get(1)).not.toContain('fresh basil')
  })
})
