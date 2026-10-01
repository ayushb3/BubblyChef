/**
 * The landing bounce (issue #754, board A3's confirmation animation): as the
 * put-away flight lands items, the place they land in does the landing bounce
 * and its +N badge ticks up. Only the places that were landed on move; under
 * reduced motion the badge still ticks but nothing moves.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenWall from '@/components/kitchen/KitchenWall'
import { reactionVariants } from '@/lib/motion'
import { summarizePlaces, type PlaceKey } from '@/lib/kitchen/places'
import { getDefaultKitchenTheme } from '@/lib/kitchen/themes'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

const palette = getDefaultKitchenTheme().wall
const none = { fridge: 0, freezer: 0, shelves: 0, basket: 0 }

function wall(landed: Record<PlaceKey, number>) {
  return (
    <KitchenWall
      palette={palette}
      places={summarizePlaces([{ location: 'fridge', expiry_date: null }], '2026-10-01')}
      onOpenPlace={jest.fn()}
      planDinnerHref="/chat"
      incoming={landed}
      bounce={landed}
    />
  )
}

function bounces(place: RegExp) {
  return screen.getByRole('button', { name: place }).querySelector('[data-bounces]')?.getAttribute('data-bounces')
}

beforeEach(() => {
  mockReduced = false
})

it('bounces a place each time something lands in it, and only that place', () => {
  const { rerender } = render(wall(none))
  expect(bounces(/^Fridge/)).toBe('0')

  rerender(wall({ ...none, fridge: 1 }))
  expect(bounces(/^Fridge/)).toBe('1')
  expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +1')
  expect(bounces(/^Basket/)).toBe('0')

  rerender(wall({ ...none, fridge: 2, basket: 1 }))
  expect(bounces(/^Fridge/)).toBe('2')
  expect(bounces(/^Basket/)).toBe('1')
  expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +2')
})

it('does not bounce on its own: a wall with no landings holds still', () => {
  render(
    <KitchenWall palette={palette} places={null} onOpenPlace={jest.fn()} planDinnerHref="/chat" incoming={{ ...none, fridge: 3 }} />,
  )
  expect(bounces(/^Fridge/)).toBe('0')
})

it('the bounce is the world reaction: a stepped 2 px hop, and still under reduced motion', () => {
  const live = reactionVariants(false).bounce.play as { y: number[] }
  expect(live.y).toEqual([0, -2, 0])
  const reduced = reactionVariants(true).bounce.play as { y: number }
  expect(reduced.y).toBe(0)
})
