/**
 * Issue #745 — the recipe page's steps in the signature language (solid for a
 * step you do, hatched for one that is just cooking, with hands-on / hands-off
 * chips), and ingredient rows that wear a food tag when the caller knows how
 * the pantry covers them ("In pantry", "Short ½", "Staple").
 */

import React from 'react'
import { render, screen, within } from '@testing-library/react'
import RecipeDetail, { type Recipe } from '@/components/recipes/RecipePage'
import { pantryTag } from '@/components/recipes/ingredient-tags'
import type { IngredientMatch, Step } from '@/types/recipes'

jest.mock('@/components/timers/HeaderQuickSetTimers', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/timers/StepTimerChip', () => ({
  __esModule: true,
  default: () => null,
}))

const STEPS: Step[] = [
  { text: 'Chop the onion.', label: 'Chop the onion', ongoing_label: null, duration_minutes: 3, duration_estimated: false, hands_on: true, depends_on: [], exclusive: [] },
  { text: 'Simmer the sauce.', label: 'Simmer', ongoing_label: 'the sauce simmers', duration_minutes: 20, duration_estimated: false, hands_on: false, depends_on: [0], exclusive: [] },
]

function recipe(extra: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    user_id: 'u1',
    title: 'Tomato sauce',
    ingredients: ['2 onions', 'salt', '400 g tomatoes'],
    instructions: ['Chop the onion.', 'Simmer the sauce.'],
    steps: STEPS,
    ...extra,
  }
}

function match(name: string, status: IngredientMatch['status'], extra: Partial<IngredientMatch> = {}): IngredientMatch {
  return {
    ingredient_name: name,
    ingredient_qty: null,
    ingredient_unit: null,
    pantry_item_id: null,
    pantry_item_name: null,
    pantry_qty_available: null,
    deduct_qty: null,
    base_unit: null,
    status,
    shortfall: null,
    match_type: 'exact',
    substitution_note: null,
    ...extra,
  }
}

describe('RecipeDetail steps (issue #745)', () => {
  it('draws a hands-on step solid and a hands-off step hatched, each with its chip and minutes', () => {
    render(<RecipeDetail recipe={recipe()} />)
    const steps = screen.getAllByTestId('recipe-step')
    expect(steps).toHaveLength(2)

    expect(steps[0]).toHaveAttribute('data-look', 'solid')
    expect(within(steps[0]).getByText('Hands-on')).toBeInTheDocument()
    expect(steps[0]).toHaveTextContent('3 min')

    expect(steps[1]).toHaveAttribute('data-look', 'hatched')
    expect(within(steps[1]).getByText('Hands-off')).toBeInTheDocument()
    expect(steps[1]).toHaveTextContent('20 min')
  })

  it('keeps the step text and numbering readable in order', () => {
    render(<RecipeDetail recipe={recipe()} />)
    const steps = screen.getAllByTestId('recipe-step')
    expect(steps[0]).toHaveTextContent('1')
    expect(steps[0]).toHaveTextContent('Chop the onion.')
    expect(steps[1]).toHaveTextContent('2')
    expect(steps[1]).toHaveTextContent('Simmer the sauce.')
  })

  it('draws steps without structure as plain solid rows with no chip', () => {
    render(<RecipeDetail recipe={recipe({ steps: null })} />)
    const steps = screen.getAllByTestId('recipe-step')
    expect(steps).toHaveLength(2)
    for (const s of steps) {
      expect(s).toHaveAttribute('data-look', 'solid')
      expect(s).not.toHaveTextContent(/Hands-(on|off)/)
    }
  })

  it('has no Method section when the recipe has no instructions', () => {
    render(<RecipeDetail recipe={recipe({ instructions: [], steps: null })} />)
    expect(screen.queryByText('Method')).not.toBeInTheDocument()
  })
})

describe('RecipeDetail ingredient tags (issue #745)', () => {
  it('shows no tags unless the caller passes pantry matches', () => {
    render(<RecipeDetail recipe={recipe()} />)
    expect(screen.queryByTestId('ingredient-tag')).not.toBeInTheDocument()
  })

  it('tags each ingredient from its match: In pantry, Short, Staple; a missing one gets none', () => {
    render(
      <RecipeDetail
        recipe={recipe()}
        ingredientMatches={[
          match('onions', 'ready'),
          match('salt', 'assumed'),
          match('tomatoes', 'shortfall', { pantry_qty_available: 200, shortfall: 200 }),
        ]}
      />,
    )
    const tags = screen.getAllByTestId('ingredient-tag').map((t) => t.textContent)
    expect(tags).toEqual(['In pantry', 'Staple', 'Short ½'])
  })

  it('leaves a missing ingredient untagged (nothing to say beyond "you need it")', () => {
    render(<RecipeDetail recipe={recipe()} ingredientMatches={[match('onions', 'missing')]} />)
    expect(screen.queryByTestId('ingredient-tag')).not.toBeInTheDocument()
  })
})

describe('pantryTag', () => {
  it('maps a match status to a label and tone', () => {
    expect(pantryTag(match('x', 'ready'))).toEqual({ label: 'In pantry', tone: 'fresh' })
    expect(pantryTag(match('x', 'substitute'))).toEqual({ label: 'In pantry', tone: 'fresh' })
    expect(pantryTag(match('x', 'imprecise'))).toEqual({ label: 'In pantry', tone: 'fresh' })
    expect(pantryTag(match('x', 'assumed'))).toEqual({ label: 'Staple', tone: 'muted' })
    expect(pantryTag(match('x', 'missing'))).toBeNull()
    expect(pantryTag(match('x', 'unit_conflict'))).toBeNull()
  })

  it('rounds a shortfall to the nearest quarter of what is needed', () => {
    const short = (have: number, missing: number) =>
      pantryTag(match('x', 'shortfall', { pantry_qty_available: have, shortfall: missing }))
    expect(short(200, 200)).toEqual({ label: 'Short ½', tone: 'expiring' })
    expect(short(300, 100)).toEqual({ label: 'Short ¼', tone: 'expiring' })
    expect(short(100, 300)).toEqual({ label: 'Short ¾', tone: 'expiring' })
  })

  it('says plain Short when the amounts are unknown', () => {
    expect(pantryTag(match('x', 'shortfall'))).toEqual({ label: 'Short', tone: 'expiring' })
  })
})
