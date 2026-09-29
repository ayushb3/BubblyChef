/**
 * Issue #650 — the meal option cards in chat. A tap fires onSelect with the
 * full option (the caller sends `context: { meal_option_id: option.option_id }`),
 * never a fuzzy text match.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import MealOptionCards from '@/components/chat/MealOptionCards'
import type { MealOption } from '@/types/chat'

const OPTIONS: MealOption[] = [
  {
    option_id: 'opt_1',
    title: 'Lemon chicken dinner',
    blurb: 'Bright, quick, uses the romaine tonight.',
    dishes: [
      { role: 'main', name: 'Lemon butter chicken', key_ingredients: ['chicken', 'lemon'], est_total_minutes: 30, est_hands_on_minutes: 15 },
      { role: 'side', name: 'Buttered orzo', key_ingredients: ['orzo', 'butter'], est_total_minutes: 15, est_hands_on_minutes: 5 },
    ],
    est_total_minutes: 35,
    est_hands_on_minutes: 20,
    coverage: { pantry_items_used: 8, to_buy: ['parsley', 'shallot'] },
    rescues: ['romaine'],
  },
  {
    option_id: 'opt_2',
    title: 'Sheet pan salmon',
    blurb: 'One pan, twenty minutes.',
    dishes: [
      { role: 'main', name: 'Sheet pan salmon', key_ingredients: ['salmon'], est_total_minutes: 20, est_hands_on_minutes: 10 },
      { role: 'side', name: 'Roasted broccoli', key_ingredients: ['broccoli'], est_total_minutes: 20, est_hands_on_minutes: 5 },
    ],
    est_total_minutes: 20,
    est_hands_on_minutes: 10,
    coverage: { pantry_items_used: 5, to_buy: [] },
    rescues: [],
  },
]

describe('MealOptionCards', () => {
  it('renders nothing for an empty options list', () => {
    const { container } = render(<MealOptionCards options={[]} onSelect={jest.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one card per option, each naming its dishes with role', () => {
    render(<MealOptionCards options={OPTIONS} onSelect={jest.fn()} />)
    // Cards themselves are role="listitem" with a "Pick <title>" accessible
    // name; each dish is also rendered as a plain <li> (no accessible name),
    // so filtering by name isolates the two top-level cards.
    const cards = screen.getAllByRole('listitem', { name: /^Pick /i })
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Lemon chicken dinner')
    expect(cards[0]).toHaveTextContent('Lemon butter chicken')
    expect(cards[0]).toHaveTextContent('Buttered orzo')
  })

  it('shows total/hands-on time and pantry coverage', () => {
    render(<MealOptionCards options={OPTIONS} onSelect={jest.fn()} />)
    expect(screen.getByText(/35 min total/)).toBeInTheDocument()
    expect(screen.getByText(/uses 8 of your items · 2 to buy/)).toBeInTheDocument()
  })

  it('shows a rescue flag only for an option that rescues an expiring item', () => {
    render(<MealOptionCards options={OPTIONS} onSelect={jest.fn()} />)
    expect(screen.getByText(/rescues romaine/)).toBeInTheDocument()
    // The second option has an empty rescues list — no flag for it.
    const cards = screen.getAllByRole('listitem', { name: /^Pick /i })
    expect(cards[1]).not.toHaveTextContent(/rescues/)
  })

  it('calls onSelect with the full option object — not just its title — when tapped', () => {
    const onSelect = jest.fn()
    render(<MealOptionCards options={OPTIONS} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('listitem', { name: 'Pick Sheet pan salmon' }))
    expect(onSelect).toHaveBeenCalledWith(OPTIONS[1])
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not call onSelect when disabled', () => {
    const onSelect = jest.fn()
    render(<MealOptionCards options={OPTIONS} onSelect={onSelect} disabled />)
    const card = screen.getByRole('listitem', { name: 'Pick Lemon chicken dinner' })
    expect(card).toBeDisabled()
    fireEvent.click(card)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
