/**
 * The pixel kitchen wall (issue #748): the storage places as real buttons with
 * pixel-lettered tags and counts, the chalkboard link, the inline-SVG scene and
 * its empty / loading states.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import KitchenWall from '@/components/kitchen/KitchenWall'
import { emptyPlaceSummaries, summarizePlaces, type PlaceSummaries } from '@/lib/kitchen/places'
import { getDefaultKitchenTheme } from '@/lib/kitchen/themes'

const palette = getDefaultKitchenTheme().wall

const TODAY = '2026-10-01'

function places(): PlaceSummaries {
  const items = [
    ...Array.from({ length: 23 }, (_, i) => ({
      location: 'fridge',
      // three of them expire within 3 days
      expiry_date: i < 3 ? '2026-10-02' : '2026-12-01',
    })),
    ...Array.from({ length: 6 }, () => ({ location: 'freezer', expiry_date: null })),
    ...Array.from({ length: 31 }, () => ({ location: 'pantry', expiry_date: null })),
    ...Array.from({ length: 5 }, () => ({ location: 'counter', expiry_date: null })),
  ]
  return summarizePlaces(items, TODAY)
}

function renderWall(over: Partial<React.ComponentProps<typeof KitchenWall>> = {}) {
  const onOpenPlace = jest.fn()
  const utils = render(
    <KitchenWall
      palette={palette}
      places={places()}
      onOpenPlace={onOpenPlace}
      planDinnerHref="/chat?seed=plan"
      {...over}
    />,
  )
  return { onOpenPlace, ...utils }
}

describe('KitchenWall places (#748)', () => {
  it('makes each place a real button named with its count and how many to use soon', () => {
    renderWall()
    expect(screen.getByRole('button', { name: 'Fridge, 23 items, 3 to use soon' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Freezer, 6 items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shelves, 31 items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Basket, 5 items' })).toBeInTheDocument()
  })

  it('draws the label and the count on the tag, in text rather than as an image', () => {
    renderWall()
    const fridge = screen.getByRole('button', { name: /^Fridge/ })
    expect(fridge).toHaveTextContent('Fridge 23')
    expect(fridge.querySelector('img')).toBeNull()
  })

  it('opens the tapped place', () => {
    const { onOpenPlace } = renderWall()
    fireEvent.click(screen.getByRole('button', { name: /^Freezer/ }))
    expect(onOpenPlace).toHaveBeenCalledWith('freezer')
    fireEvent.click(screen.getByRole('button', { name: /^Basket/ }))
    expect(onOpenPlace).toHaveBeenCalledWith('basket')
    fireEvent.click(screen.getByRole('button', { name: /^Shelves/ }))
    expect(onOpenPlace).toHaveBeenCalledWith('shelves')
    fireEvent.click(screen.getByRole('button', { name: /^Fridge/ }))
    expect(onOpenPlace).toHaveBeenLastCalledWith('fridge')
  })

  it('opens a place when its tag is tapped, not just the object', () => {
    const { onOpenPlace } = renderWall()
    fireEvent.click(screen.getByText('Shelves'))
    expect(onOpenPlace).toHaveBeenCalledWith('shelves')
  })

  it('shows names only while the pantry is loading, never a made-up zero', () => {
    renderWall({ places: null })
    for (const name of ['Fridge', 'Freezer', 'Shelves', 'Basket']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveTextContent(new RegExp(`^${name}$`))
    }
  })

  it('shows names with no number for an empty kitchen (board A5) and says "empty"', () => {
    renderWall({ places: emptyPlaceSummaries() })
    const fridge = screen.getByRole('button', { name: 'Fridge, empty' })
    expect(fridge).toHaveTextContent(/^Fridge$/)
    expect(screen.getByRole('button', { name: 'Basket, empty' })).toBeInTheDocument()
  })

  it('keeps tapping a place working with no data yet', () => {
    const { onOpenPlace } = renderWall({ places: null })
    fireEvent.click(screen.getByRole('button', { name: 'Fridge' }))
    expect(onOpenPlace).toHaveBeenCalledWith('fridge')
  })
})

describe('KitchenWall chalkboard (#748)', () => {
  it('is the existing plan-dinner link', () => {
    renderWall({ planDinnerHref: '/chat?seed=plan-dinner' })
    const link = screen.getByRole('link', { name: 'Plan dinner' })
    expect(link).toHaveAttribute('href', '/chat?seed=plan-dinner')
    expect(link).toHaveTextContent('Plan dinner')
  })
})

describe('KitchenWall scene (#748)', () => {
  it('is inline SVG with no image request, and hidden from screen readers (the places carry the names)', () => {
    const { container } = renderWall()
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 96 80')
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('image')).toBeNull()
  })

  it('is at the board proportion from the first render, loading or loaded', () => {
    const loading = renderWall({ places: null })
    expect(screen.getByTestId('kitchen-wall').className).toContain('aspect-[96/80]')
    loading.unmount()
    renderWall()
    expect(screen.getByTestId('kitchen-wall').className).toContain('aspect-[96/80]')
  })

  it('writes the palette to --wall-* custom properties', () => {
    renderWall()
    const wall = screen.getByTestId('kitchen-wall')
    expect(wall.style.getPropertyValue('--wall-base')).toBe(palette.base)
    expect(wall.style.getPropertyValue('--wall-ink')).toBe(palette.ink)
    expect(wall.style.getPropertyValue('--wall-appliance')).toBe(palette.appliance)
  })

  it('draws the static stock only for places that have items (first visit matches board A5)', () => {
    const empty = renderWall({ places: emptyPlaceSummaries() })
    const emptyPaths = empty.container.querySelectorAll('svg path').length
    empty.unmount()

    const loading = renderWall({ places: null })
    expect(loading.container.querySelectorAll('svg path').length).toBe(emptyPaths)
    loading.unmount()

    const stocked = renderWall()
    expect(stocked.container.querySelectorAll('svg path').length).toBeGreaterThan(emptyPaths)
  })

  it('draws a place’s stock only when that place has items', () => {
    const onlyFridge = emptyPlaceSummaries()
    onlyFridge.fridge.count = 4
    const a = renderWall({ places: onlyFridge })
    const withFridge = a.container.querySelectorAll('svg path').length
    a.unmount()

    const onlyShelves = emptyPlaceSummaries()
    onlyShelves.shelves.count = 4
    const b = renderWall({ places: onlyShelves })
    const withShelves = b.container.querySelectorAll('svg path').length
    b.unmount()

    const none = renderWall({ places: emptyPlaceSummaries() })
    const base = none.container.querySelectorAll('svg path').length
    expect(withFridge).toBeGreaterThan(base)
    expect(withShelves).toBeGreaterThan(base)
    // Different places draw different stock.
    expect(withFridge).not.toBe(withShelves)
  })

  it('renders the hooks for the sprite and Bubbles tickets inside the SVG', () => {
    const { container } = renderWall({
      spritesLayer: <g data-testid="sprites" />,
      bubblesLayer: <g data-testid="bubbles" />,
    })
    const svg = container.querySelector('svg')!
    expect(within(svg as unknown as HTMLElement).getByTestId('sprites')).toBeInTheDocument()
    expect(within(svg as unknown as HTMLElement).getByTestId('bubbles')).toBeInTheDocument()
  })

  it('renders decorations passed as children under the places, so they never cover a tag', () => {
    renderWall({ children: <div data-testid="decoration" /> })
    const wall = screen.getByTestId('kitchen-wall')
    const kids = Array.from(wall.children)
    const deco = kids.indexOf(screen.getByTestId('decoration'))
    const fridge = kids.indexOf(screen.getByRole('button', { name: /^Fridge/ }))
    expect(deco).toBeGreaterThan(-1)
    expect(deco).toBeLessThan(fridge)
  })
})

describe('KitchenWall tour target (#750)', () => {
  // The onboarding tour's pantry step points at the fridge now that the Pantry
  // tab is gone; a missing target would make the tour skip the step.
  it('marks the fridge, and only the fridge, as the tour target', () => {
    renderWall()
    const targets = document.querySelectorAll('[data-tour="fridge"]')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toBe(screen.getByRole('button', { name: /^Fridge/ }))
  })
})
