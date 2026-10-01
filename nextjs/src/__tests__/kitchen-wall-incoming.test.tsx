/**
 * The +N badges (issue #753, board A3): while shopping waits to be put away,
 * each storage place's tag reads "<Place> +N" for what is headed there, with a
 * pair of pixel sparkles by it. Places with nothing coming keep their count.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenWall from '@/components/kitchen/KitchenWall'
import { summarizePlaces } from '@/lib/kitchen/places'
import { getDefaultKitchenTheme } from '@/lib/kitchen/themes'

const palette = getDefaultKitchenTheme().wall

function renderWall(incoming: React.ComponentProps<typeof KitchenWall>['incoming']) {
  return render(
    <KitchenWall
      palette={palette}
      places={summarizePlaces(
        [
          { location: 'fridge', expiry_date: null },
          { location: 'fridge', expiry_date: null },
          { location: 'pantry', expiry_date: null },
        ],
        '2026-10-01',
      )}
      onOpenPlace={jest.fn()}
      planDinnerHref="/chat"
      incoming={incoming}
    />,
  )
}

it('shows +N on each place that has shopping headed to it', () => {
  renderWall({ fridge: 5, freezer: 2, shelves: 2, basket: 2 })
  expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +5')
  expect(screen.getByRole('button', { name: /^Freezer/ })).toHaveTextContent('Freezer +2')
  expect(screen.getByRole('button', { name: /^Shelves/ })).toHaveTextContent('Shelves +2')
  expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket +2')
})

it('leaves a place with nothing coming on its count', () => {
  renderWall({ fridge: 3, freezer: 0, shelves: 0, basket: 0 })
  expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +3')
  expect(screen.getByRole('button', { name: /^Shelves/ })).toHaveTextContent('Shelves 1')
  expect(screen.getByRole('button', { name: /^Shelves/ })).not.toHaveTextContent('+')
})

it('says what is coming in the place button name, for screen readers', () => {
  renderWall({ fridge: 5, freezer: 0, shelves: 0, basket: 0 })
  expect(screen.getByRole('button', { name: 'Fridge, 2 items, 5 coming in' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Shelves, 1 item' })).toBeInTheDocument()
})

it('shows no badge and no sparkle when nothing is coming', () => {
  const { container } = renderWall(null)
  expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge 2')
  expect(container.querySelector('[data-testid="incoming-sparkles"]')).toBeNull()
})

it('draws a sparkle pair only by the places with something coming', () => {
  const { container } = renderWall({ fridge: 5, freezer: 0, shelves: 2, basket: 0 })
  const sparkles = Array.from(container.querySelectorAll('[data-testid="incoming-sparkles"]'))
  expect(sparkles.map((s) => s.getAttribute('data-place'))).toEqual(['fridge', 'shelves'])
})
