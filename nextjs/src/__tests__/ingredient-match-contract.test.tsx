/**
 * Issue #784: the contract between the AI service's match response and the food
 * tags on screen.
 *
 * `BACKEND_RESPONSE` is a real response, captured by running the backend's
 * `match_ingredient_lines` through `MatchIngredientsResponse` (the route's
 * response model) for the pantry eggs 2, flour 500 g, butter 50 g and the lines
 * below. Note what the server does to the names: "2 eggs" comes back named
 * "eggs", "1 egg" as "egg", "salt and pepper to taste" as "salt", none of which
 * is the row's label. The tags must still land on the right rows, so they are
 * matched by row index, never by name.
 */

import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryRecipeDetail from '@/components/recipes/PantryRecipeDetail'
import RecipeCard from '@/components/recipes/RecipeCard'
import { alignToRows, toLines } from '@/hooks/useIngredientMatches'
import { fetchIngredientMatches } from '@/lib/api/ingredient-match'
import type { Recipe } from '@/components/recipes/RecipePage'

jest.mock('@/components/timers/HeaderQuickSetTimers', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/timers/StepTimerChip', () => ({ __esModule: true, default: () => null }))

const INGREDIENTS: Recipe['ingredients'] = [
  '2 eggs',
  '1 egg',
  '200 g flour',
  { name: 'butter', quantity: 100, unit: 'g' },
  'saffron',
  'salt and pepper to taste',
]

// Captured from the backend (see the file comment).
const BACKEND_RESPONSE = {
  matches: [
    { name: 'eggs', status: 'have', pantry_food: 'eggs', basis: 'pantry', pantry_qty_available: 2.0, shortfall: null },
    { name: 'egg', status: 'low', pantry_food: 'eggs', basis: 'pantry', pantry_qty_available: 0.0, shortfall: 1.0 },
    { name: 'flour', status: 'have', pantry_food: 'flour', basis: 'pantry', pantry_qty_available: 500.0, shortfall: null },
    { name: 'butter', status: 'low', pantry_food: 'butter', basis: 'pantry', pantry_qty_available: 50.0, shortfall: 50.0 },
    { name: 'saffron', status: 'missing', pantry_food: null, basis: 'none', pantry_qty_available: null, shortfall: null },
    { name: 'salt', status: 'have', pantry_food: null, basis: 'assumed', pantry_qty_available: null, shortfall: null },
  ],
}

// One tag per row ('' = no tag; a missing line is To buy, #805): the second egg line is short (the first took both eggs).
const EXPECTED_TAGS = ['In pantry', 'Short', 'In pantry', 'Short ½', 'To buy', 'Staple']

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

/** Each ingredient row's tag text, in row order ('' when untagged). */
function tagsByRow(rows: HTMLElement[]): string[] {
  return rows.map((row) => within(row).queryByTestId('ingredient-tag')?.textContent ?? '')
}

describe('the backend response shape, through the client', () => {
  it('parses every field the tags read, one match per line', async () => {
    fetchMock.mockResolvedValue(reply(BACKEND_RESPONSE))
    const got = await fetchIngredientMatches(['2 eggs', '1 egg', '200 g flour', 'butter', 'saffron', 'salt'])
    expect(got.map((m) => m.status)).toEqual(['ready', 'shortfall', 'ready', 'shortfall', 'missing', 'assumed'])
    expect(got[1]).toMatchObject({ pantry_qty_available: 0, shortfall: 1, pantry_item_name: 'eggs' })
  })
})

describe('tags land on the right rows (matched by row, not by name)', () => {
  it('recipe page: two lines of one food each get their own tag', async () => {
    fetchMock.mockResolvedValue(reply(BACKEND_RESPONSE))
    render(withClient(<PantryRecipeDetail recipe={{ id: 'r', user_id: 'u', title: 'T', ingredients: INGREDIENTS, instructions: [] }} />))
    await waitFor(() => expect(screen.getAllByTestId('ingredient-tag').length).toBeGreaterThan(0))
    const rows = screen.getAllByRole('listitem')
    expect(tagsByRow(rows)).toEqual(EXPECTED_TAGS)
  })

  it('meal dish card: same', async () => {
    fetchMock.mockResolvedValue(reply(BACKEND_RESPONSE))
    const { lines, rows } = toLines(INGREDIENTS)
    const matches = await fetchIngredientMatches(lines)
    const aligned = alignToRows(matches, rows, INGREDIENTS.length)
    render(
      <RecipeCard
        variant="dish"
        role="main"
        title="T"
        ingredients={INGREDIENTS.map((i) => (typeof i === 'string' ? { name: i } : i))}
        instructions={[]}
        rowMatches={aligned}
      />,
    )
    const list = screen.getByRole('heading', { name: 'Ingredients', hidden: true }).parentElement as HTMLElement
    expect(tagsByRow(within(list).getAllByRole('listitem'))).toEqual(EXPECTED_TAGS)
  })
})

describe('toLines / alignToRows', () => {
  it('drops blank rows from the request and puts each match back on its own row', () => {
    const { lines, rows } = toLines(['2 eggs', '', { name: '  ' }, '1 egg'])
    expect(lines).toEqual(['2 eggs', '1 egg'])
    expect(rows).toEqual([0, 3])
    const [a, b] = BACKEND_RESPONSE.matches
    const aligned = alignToRows([{ ...a } as never, { ...b } as never], rows, 4)
    expect(aligned.map((m) => (m ? 'x' : null))).toEqual(['x', null, null, 'x'])
  })
})
