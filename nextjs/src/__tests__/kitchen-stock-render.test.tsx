/**
 * The wall with its category sprites and wilting items (issue #751): what the
 * scene draws for a stocked pantry, for an empty one, and under reduced motion.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenScene from '@/components/kitchen/KitchenScene'
import {
  kitchenStock,
  summarizePlaces,
  type KitchenStock,
  type PlaceSummaries,
  type StockItem,
} from '@/lib/kitchen/places'
import { PLACE_SLOTS } from '@/lib/kitchen/sprite-layout'
import { PLACE_KEYS } from '@/lib/kitchen/places'

let reduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => reduced,
}))

const TODAY = '2026-10-01'

function inDays(days: number): string {
  const d = new Date(2026, 9, 1 + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function pantry80(): StockItem[] {
  const categories = [
    'produce', 'dairy', 'meat', 'dry_goods', 'condiments',
    'snacks', 'beverages', 'frozen', 'bakery', 'other',
  ]
  const locations = ['fridge', 'freezer', 'pantry', 'counter']
  return Array.from({ length: 80 }, (_, i) => ({
    id: `p${i}`,
    name: `item ${i}`,
    category: categories[i % categories.length],
    location: locations[i % locations.length],
    quantity: 1,
    expiry_date: inDays(60 + i),
  }))
}

function renderScene(items: StockItem[], over: { reduced?: boolean; stock?: KitchenStock | null } = {}) {
  reduced = over.reduced ?? false
  const places: PlaceSummaries = summarizePlaces(items, TODAY)
  const stock = over.stock === undefined ? kitchenStock(items, TODAY) : over.stock
  return render(<KitchenScene unlocked={[]} places={places} stock={stock} onOpenPlace={jest.fn()} />)
}

afterEach(() => {
  reduced = false
})

describe('KitchenScene sprites (#751)', () => {
  it('shows only a few sprites per place, not one per item, for a ~80-item pantry', () => {
    renderScene(pantry80())
    const sprites = screen.queryAllByTestId('kitchen-sprite')
    expect(sprites.length).toBeGreaterThan(0)
    expect(sprites.length).toBeLessThan(20)
    for (const key of PLACE_KEYS) {
      const inPlace = sprites.filter((s) => s.getAttribute('data-place') === key)
      expect(inPlace.length).toBeLessThanOrEqual(PLACE_SLOTS[key].length)
      expect(inPlace.length).toBeGreaterThan(0)
    }
    // The count badges are still the true totals.
    expect(screen.getByRole('button', { name: 'Fridge, 20 items' })).toBeInTheDocument()
  })

  it('draws a sprite per representative category, by kind', () => {
    renderScene([
      { id: '1', name: 'milk', category: 'dairy', location: 'fridge', quantity: 1, expiry_date: inDays(20) },
      { id: '2', name: 'rice', category: 'dry_goods', location: 'pantry', quantity: 1, expiry_date: inDays(200) },
    ])
    const kinds = screen.getAllByTestId('kitchen-sprite').map((s) => `${s.getAttribute('data-place')}:${s.getAttribute('data-kind')}`)
    expect(kinds.sort()).toEqual(['fridge:carton', 'shelves:sack'])
  })

  it('draws no stock for an empty pantry, and no wilting', () => {
    renderScene([])
    expect(screen.queryAllByTestId('kitchen-sprite')).toHaveLength(0)
    expect(screen.queryAllByTestId('kitchen-wilting')).toHaveLength(0)
    expect(screen.queryAllByTestId('kitchen-wilt-tag')).toHaveLength(0)
  })

  it('draws nothing while the pantry is unknown (loading or failed), not a made-up empty', () => {
    renderScene([], { stock: null })
    expect(screen.queryAllByTestId('kitchen-sprite')).toHaveLength(0)
  })

  it('stops drawing the board\'s static stock once real sprites take over', () => {
    const { container } = renderScene([
      { id: '1', name: 'milk', category: 'dairy', location: 'fridge', quantity: 1, expiry_date: inDays(20) },
    ])
    // The static fridge stock draws cheese (#ffd98c) and a meat parcel (#f4a3a8).
    const fills = [...container.querySelectorAll('svg path')]
      .map((p) => (p.getAttribute('style') ?? '').toLowerCase())
      .join(' ')
    expect(fills).not.toMatch(/#ffd98c|255, 217, 140/)
    expect(fills).not.toMatch(/#f4a3a8|244, 163, 168/)
  })
})

describe('KitchenScene wilting items (#751)', () => {
  const expiring: StockItem[] = [
    { id: 'rom', name: 'Romaine', category: 'produce', location: 'fridge', quantity: 1, expiry_date: inDays(0) },
    { id: 'brd', name: 'Bread', category: 'bakery', location: 'pantry', quantity: 1, expiry_date: inDays(1) },
    { id: 'ban', name: 'Bananas', category: 'produce', location: 'counter', quantity: 1, expiry_date: inDays(2) },
    { id: 'late', name: 'Yogurt', category: 'dairy', location: 'fridge', quantity: 1, expiry_date: inDays(3) },
  ]

  it('draws at most 3, each tagged with its time left', () => {
    renderScene(expiring)
    const wilting = screen.getAllByTestId('kitchen-wilting')
    expect(wilting).toHaveLength(3)
    expect(wilting.map((w) => w.getAttribute('data-item-id'))).toEqual(['rom', 'brd', 'ban'])
    expect(screen.getAllByTestId('kitchen-wilt-tag').map((t) => t.textContent)).toEqual([
      'today',
      '1 day',
      '2 days',
    ])
  })

  it('shows an expired item first, tagged "expired"', () => {
    renderScene([
      ...expiring,
      { id: 'old', name: 'Spinach', category: 'produce', location: 'fridge', quantity: 1, expiry_date: inDays(-2) },
    ])
    const wilting = screen.getAllByTestId('kitchen-wilting')
    expect(wilting[0].getAttribute('data-item-id')).toBe('old')
    expect(screen.getAllByTestId('kitchen-wilt-tag')[0]).toHaveTextContent('expired')
  })

  it('wilts nothing when nothing needs attention', () => {
    renderScene(pantry80())
    expect(screen.queryAllByTestId('kitchen-wilting')).toHaveLength(0)
    expect(screen.queryAllByTestId('kitchen-wilt-tag')).toHaveLength(0)
  })

  it('keeps the tags out of the accessibility tree: the place buttons already say "to use soon"', () => {
    renderScene(expiring)
    for (const tag of screen.getAllByTestId('kitchen-wilt-tag')) {
      expect(tag).toHaveAttribute('aria-hidden', 'true')
    }
    expect(screen.getByRole('button', { name: /Fridge, 2 items, 2 to use soon/ })).toBeInTheDocument()
  })

  it('lets a tap on a wilting tag fall through to the place beneath it', () => {
    renderScene(expiring)
    for (const tag of screen.getAllByTestId('kitchen-wilt-tag')) {
      expect(tag.className).toContain('pointer-events-none')
    }
  })

  it('plays the stepped droop on arrival', () => {
    renderScene(expiring, { reduced: false })
    const first = screen.getAllByTestId('kitchen-wilting')[0]
    // Arrives upright and un-faded; the reaction then takes it to the drooped pose.
    expect(first.getAttribute('opacity')).toBe('1')
  })

  it('with reduced motion shows the drooped pose at once, without animating', () => {
    renderScene(expiring, { reduced: true })
    for (const w of screen.getAllByTestId('kitchen-wilting')) {
      expect(w.getAttribute('opacity')).toBe('0.85')
      expect(w.getAttribute('data-pose')).toBe('drooped')
    }
  })
})
