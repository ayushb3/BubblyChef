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

  it('copes with three options and a different number of sides on each (issue #758)', () => {
    const [first, second] = OPTIONS
    const mainOnly: MealOption = {
      ...second,
      option_id: 'opt_3',
      title: 'Loaded ramen bowl',
      dishes: [second.dishes[0]],
    }
    const twoSides: MealOption = {
      ...first,
      option_id: 'opt_4',
      title: 'Roast chicken night',
      dishes: [...first.dishes, { ...first.dishes[1], name: 'Green beans' }],
    }
    render(<MealOptionCards options={[mainOnly, first, twoSides]} onSelect={jest.fn()} />)
    const cards = screen.getAllByRole('listitem', { name: /^Pick /i })
    expect(cards).toHaveLength(3)
    // Only the main-only card says "no side".
    expect(cards[0]).toHaveTextContent('no side')
    expect(cards[1]).not.toHaveTextContent('no side')
    expect(cards[2]).not.toHaveTextContent('no side')
    expect(cards[2]).toHaveTextContent('Buttered orzo')
    expect(cards[2]).toHaveTextContent('Green beans')
  })

  it('hides the coverage chip and rescue flag when the user opted out of the pantry (coverage null)', () => {
    const optedOut: MealOption[] = [{ ...OPTIONS[0], coverage: null, rescues: [] }]
    render(<MealOptionCards options={optedOut} onSelect={jest.fn()} />)
    expect(screen.queryByText(/of your items/)).not.toBeInTheDocument()
    expect(screen.queryByText(/rescues/)).not.toBeInTheDocument()
    expect(screen.getByText(/35 min total/)).toBeInTheDocument()
  })

  it('hides the time chip when there is no estimate, and never prints "null min"', () => {
    const noTimes: MealOption[] = [
      { ...OPTIONS[0], est_total_minutes: null, est_hands_on_minutes: null },
      { ...OPTIONS[1], est_hands_on_minutes: null },
    ]
    render(<MealOptionCards options={noTimes} onSelect={jest.fn()} />)
    expect(screen.queryByText(/null/)).not.toBeInTheDocument()
    // The second card still has a total, just no hands-on figure.
    expect(screen.getAllByText(/min total/)).toHaveLength(1)
    expect(screen.getByText(/20 min total/)).not.toHaveTextContent('hands-on')
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
