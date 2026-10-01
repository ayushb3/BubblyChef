/**
 * Issue #744 — the parts of the one recipe card the migrated old-card tests don't
 * cover: the chat variant's ingredient statuses and "N to buy" line, and the
 * compact variant as the saved-meal row (a link) with its unknown / nothing-to-buy
 * states.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import RecipeCard from '@/components/recipes/RecipeCard'
import { attributeToBuy } from '@/lib/meal-to-buy'
import type { ChatRecipeData } from '@/types/chat'

const RECIPE: ChatRecipeData = {
  title: 'Lemon pasta',
  total_time_minutes: 20,
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'lemon', quantity: 1 },
    { name: 'cream', quantity: 1, unit: 'cup' },
  ],
  instructions: ['Boil the pasta.'],
  ingredient_availability: [
    { name: 'pasta', status: 'have' },
    { name: 'lemon', status: 'missing' },
    { name: 'cream', status: 'substitute', substitute_note: 'Milk works' },
  ],
}

describe('RecipeCard chat variant', () => {
  it('shows the minutes in the header band and a status pill per graded ingredient', () => {
    render(<RecipeCard variant="chat" recipe={RECIPE} />)
    expect(screen.getByText('20 min')).toBeInTheDocument()
    expect(screen.getByText('In kitchen')).toBeInTheDocument()
    expect(screen.getByText('To buy')).toBeInTheDocument()
    expect(screen.getByText('Substitute')).toBeInTheDocument()
    expect(screen.getByText('Milk works')).toBeInTheDocument()
  })

  it('lists the missing ingredients on the "N to buy" line and adds them to the grocery list', async () => {
    const onAddToGrocery = jest.fn().mockResolvedValue(undefined)
    render(<RecipeCard variant="chat" recipe={RECIPE} onAddToGrocery={onAddToGrocery} />)
    expect(screen.getByText('1 to buy:')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to grocery list' }))
    expect(onAddToGrocery).toHaveBeenCalledWith(['Lemon'])
    expect(await screen.findByRole('status')).toHaveTextContent('1 on your grocery list')
  })

  it('has no "N to buy" line when the pantry was not checked', () => {
    render(<RecipeCard variant="chat" recipe={{ ...RECIPE, ingredient_availability: undefined }} />)
    expect(screen.queryByText(/to buy/i)).not.toBeInTheDocument()
    expect(screen.queryByText('In kitchen')).not.toBeInTheDocument()
  })
})

describe('RecipeCard compact variant as the saved-meal row', () => {
  it('is one link to the meal, with the dishes and servings on its meta line', () => {
    render(
      <RecipeCard
        variant="compact"
        href="/meals/m1"
        title="Lemon chicken dinner"
        dishes={['Lemon chicken', 'Orzo']}
        servings={2}
      />,
    )
    const link = screen.getByRole('link', { name: /Lemon chicken dinner/ })
    expect(link).toHaveAttribute('href', '/meals/m1')
    expect(link).toHaveTextContent('Lemon chicken · Orzo')
    expect(link).toHaveTextContent('Serves 2')
  })

  it('does not claim "nothing to buy" when the missing foods are unknown', () => {
    render(<RecipeCard variant="compact" href="/meals/m1" title="Dinner" dishes={['Soup']} />)
    expect(screen.queryByText(/to buy/i)).not.toBeInTheDocument()
  })

  it('says so when a meal needs nothing, and lists the expiring badge only when given', () => {
    const { rerender } = render(
      <RecipeCard variant="compact" href="/meals/m1" title="Dinner" toBuy={[]} expiring={['romaine']} />,
    )
    expect(screen.getByText(/Nothing to buy/)).toBeInTheDocument()
    expect(screen.getByText(/Uses your romaine/)).toBeInTheDocument()
    rerender(<RecipeCard variant="compact" href="/meals/m1" title="Dinner" toBuy={[]} />)
    expect(screen.queryByText(/Uses your/)).not.toBeInTheDocument()
  })

  it('is a button that opens the meal when it has no link, and has no Save key unless given onSave', () => {
    const onOpen = jest.fn()
    render(<RecipeCard variant="compact" title="Dinner" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open meal: Dinner' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Save meal/ })).not.toBeInTheDocument()
  })
})

describe('attributeToBuy', () => {
  it('gives each missing food to every dish that lists it, folding case and plurals (issue #805)', () => {
    const result = attributeToBuy(
      ['Lemons', 'parsley', 'saffron'],
      [
        { position: 0, names: ['chicken', 'lemon'] },
        { position: 1, names: ['orzo', 'Lemon', 'Parsley'] },
        { position: 2, names: ['romaine'] },
      ],
    )
    // Lemon is missing in two dishes: both rows read To buy, so both cards list it.
    expect(result.get(0)).toEqual(['Lemons'])
    expect(result.get(1)).toEqual(['Lemons', 'parsley'])
    // Every dish has an entry; "saffron" belongs to no dish and is dropped.
    expect(result.get(2)).toEqual([])
  })

  it('lists a food once per dish even when that dish names it twice', () => {
    const result = attributeToBuy(['onion'], [{ position: 0, names: ['onion', 'Onions'] }])
    expect(result.get(0)).toEqual(['onion'])
  })
})
