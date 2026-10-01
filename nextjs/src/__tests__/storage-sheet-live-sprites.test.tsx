/**
 * The storage sheet's header icon draws the place's live sprites (issue #794):
 * the same sprite kinds the wall draws for that place, for the same pantry, and
 * the empty room for an empty place. It used to be cropped from the wall's fixed
 * placeholder stock (milk and cheese in every fridge).
 */
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import KitchenScene from '@/components/kitchen/KitchenScene'
import StorageSheet from '@/components/kitchen/StorageSheet'
import {
  kitchenStock,
  summarizePlaces,
  type PlaceKey,
  type StoredItem,
} from '@/lib/kitchen/places'
import { getDefaultKitchenTheme } from '@/lib/kitchen/themes'

const TODAY = '2026-10-01'
const palette = getDefaultKitchenTheme().wall

function item(id: string, name: string, location: string, extra: Partial<StoredItem> = {}): StoredItem {
  return {
    id,
    name,
    location,
    category: 'produce',
    quantity: 1,
    unit: 'item',
    expiry_date: '2026-12-01',
    ...extra,
  }
}

// Fridge: milk and eggs (category sprites) and romaine about to wilt. Shelves: rice.
// The freezer and the basket are empty.
const PANTRY: StoredItem[] = [
  item('rom', 'romaine', 'fridge', { expiry_date: '2026-10-01' }),
  item('milk', 'milk', 'fridge', { category: 'dairy' }),
  item('egg', 'eggs', 'fridge', { category: 'dairy' }),
  item('rice', 'rice', 'pantry', { category: 'dry_goods' }),
]

function openSheet(place: PlaceKey, items: StoredItem[] | null = PANTRY) {
  render(
    <StorageSheet
      open
      place={place}
      view="scene"
      items={items}
      status={items ? 'ready' : 'loading'}
      palette={palette}
      today={TODAY}
      onPlaceChange={jest.fn()}
      onViewChange={jest.fn()}
      onClose={jest.fn()}
      onEdit={jest.fn()}
      onAdd={jest.fn()}
      onMove={jest.fn()}
      onResolve={jest.fn()}
      onRetry={jest.fn()}
    />,
  )
  const dialog = screen.getByRole('dialog')
  // The header's icon is the first place sprite in the sheet.
  return within(dialog).getAllByTestId('place-sprite')[0]
}

const kindsIn = (root: HTMLElement) =>
  [
    ...root.querySelectorAll('[data-testid="kitchen-sprite"], [data-testid="kitchen-wilting"]'),
  ]
    .map((g) => `${g.getAttribute('data-kind')}${g.getAttribute('data-testid') === 'kitchen-wilting' ? '*' : ''}`)
    .sort()

function wallKinds(place: PlaceKey, items: StoredItem[]): string[] {
  const { container } = render(
    <KitchenScene
      unlocked={[]}
      places={summarizePlaces(items, TODAY)}
      stock={kitchenStock(items, TODAY)}
      onOpenPlace={jest.fn()}
    />,
  )
  const wall = container.querySelector('[data-testid="kitchen-wall"]') as HTMLElement
  return [
    ...wall.querySelectorAll(
      `[data-testid="kitchen-sprite"][data-place="${place}"], [data-testid="kitchen-wilting"][data-place="${place}"]`,
    ),
  ]
    .map((g) => `${g.getAttribute('data-kind')}${g.getAttribute('data-testid') === 'kitchen-wilting' ? '*' : ''}`)
    .sort()
}

describe('storage sheet header icon (#794)', () => {
  it.each<PlaceKey>(['fridge', 'shelves'])(
    'draws the same sprite kinds as the wall does for the %s',
    (place) => {
      const expected = wallKinds(place, PANTRY)
      expect(expected.length).toBeGreaterThan(0)
      cleanup()
      expect(kindsIn(openSheet(place))).toEqual(expected)
    },
  )

  it('draws the wilting item drooped, as the wall does, and still', () => {
    const icon = openSheet('fridge')
    const wilting = icon.querySelectorAll('[data-testid="kitchen-wilting"]')
    expect(wilting).toHaveLength(1)
    expect(wilting[0]).toHaveAttribute('data-pose', 'drooped')
    expect(wilting[0]).toHaveAttribute('data-item-id', 'rom')
    // No arrival animation in a 44px icon: it is at the held pose from the first paint.
    expect(wilting[0]).toHaveAttribute('opacity', '0.85')
  })

  it('shows the empty room for an empty place, not the placeholder stock', () => {
    const icon = openSheet('freezer')
    expect(kindsIn(icon)).toEqual([])
    // The old crop painted the board's frozen bags (#9fd3f0) into every freezer.
    expect(icon.innerHTML.toLowerCase()).not.toMatch(/#9fd3f0|159, 211, 240/)
  })

  it('does not paint the fridge placeholder stock into a stocked fridge', () => {
    const icon = openSheet('fridge')
    // Cheese (#ffd98c) and the meat parcel (#f4a3a8) belong to the old static crop.
    expect(icon.innerHTML.toLowerCase()).not.toMatch(/#ffd98c|255, 217, 140|#f4a3a8|244, 163, 168/)
  })

  it('draws no stock while the pantry is unknown', () => {
    const icon = openSheet('fridge', null)
    expect(kindsIn(icon)).toEqual([])
  })

  it('keeps the 44px icon box and stays decorative', () => {
    const icon = openSheet('fridge')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('data-place', 'fridge')
  })
})
