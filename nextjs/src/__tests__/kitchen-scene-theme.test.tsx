/**
 * Tests for `KitchenScene`'s `theme` prop (issue #523): decorations render
 * identically across themes, only the wall's palette differs, and an unset
 * `theme` prop defaults to `pastel` (pre-#523 callers keep working). On the
 * pixel wall (#748) a theme recolours the wall palette and moves no decoration.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenScene from '@/components/kitchen/KitchenScene'
import { SLOTS } from '@/lib/kitchen/slots'
import { CATALOG } from '@/lib/kitchen/catalog'
import { KITCHEN_THEMES } from '@/lib/kitchen/themes'

const oneEntryPerSlot = SLOTS.map((slot) => CATALOG.find((d) => d.slot === slot.key)!)
const unlocked = oneEntryPerSlot.map((d) => ({ id: d.id, slot: d.slot }))

describe('KitchenScene — theme prop (#523)', () => {
  it('defaults to pastel when no theme prop is passed', () => {
    render(<KitchenScene unlocked={[]} onOpenPlace={jest.fn()} />)
    expect(screen.getByTestId('kitchen-scene')).toHaveAttribute('data-kitchen-theme', 'pastel')
  })

  it.each(KITCHEN_THEMES)('renders every slot filled the same way under $key', (theme) => {
    render(<KitchenScene unlocked={unlocked} onOpenPlace={jest.fn()} theme={theme} />)

    expect(screen.getByTestId('kitchen-scene')).toHaveAttribute('data-kitchen-theme', theme.key)
    for (const slot of SLOTS) {
      expect(screen.getByTestId(`kitchen-slot-${slot.key}`).getAttribute('data-filled')).toBe(
        'true',
      )
    }
    // Same accessible names regardless of theme — decorations don't change.
    expect(screen.getAllByRole('img')).toHaveLength(oneEntryPerSlot.length)
  })

  it('decorations render identically across two different themes', () => {
    const pastel = KITCHEN_THEMES.find((t) => t.key === 'pastel')!
    const nightKitchen = KITCHEN_THEMES.find((t) => t.key === 'night_kitchen')!

    const { unmount, container: containerA } = render(
      <KitchenScene unlocked={unlocked} onOpenPlace={jest.fn()} theme={pastel} />,
    )
    const namesA = screen.getAllByRole('img').map((el) => el.getAttribute('aria-label'))
    unmount()

    const { container: containerB } = render(
      <KitchenScene unlocked={unlocked} onOpenPlace={jest.fn()} theme={nightKitchen} />,
    )
    const namesB = screen.getAllByRole('img').map((el) => el.getAttribute('aria-label'))

    expect(namesB).toEqual(namesA)
    // The two scenes differ only in the theme's background — sanity-check
    // that the two themes actually declare different backgrounds, so this
    // assertion isn't vacuous.
    expect(pastel.background).not.toEqual(nightKitchen.background)
    void containerA
    void containerB
  })

  it('recolours the wall through its palette and moves no decoration (#748)', () => {
    const pastel = KITCHEN_THEMES.find((t) => t.key === 'pastel')!
    const night = KITCHEN_THEMES.find((t) => t.key === 'night_kitchen')!

    const { unmount } = render(<KitchenScene unlocked={unlocked} onOpenPlace={jest.fn()} theme={pastel} />)
    const wallA = screen.getByTestId('kitchen-wall')
    const baseA = wallA.style.getPropertyValue('--wall-base')
    const boxesA = SLOTS.map((s) => {
      const el = screen.getByTestId(`kitchen-slot-${s.key}`)
      return [el.style.left, el.style.top, el.style.width, el.style.height]
    })
    unmount()

    render(<KitchenScene unlocked={unlocked} onOpenPlace={jest.fn()} theme={night} />)
    const wallB = screen.getByTestId('kitchen-wall')
    const boxesB = SLOTS.map((s) => {
      const el = screen.getByTestId(`kitchen-slot-${s.key}`)
      return [el.style.left, el.style.top, el.style.width, el.style.height]
    })

    expect(wallB.style.getPropertyValue('--wall-base')).toBe(night.wall.base)
    expect(wallB.style.getPropertyValue('--wall-base')).not.toBe(baseA)
    expect(boxesB).toEqual(boxesA)
  })

  it.each(KITCHEN_THEMES)('gives $key a complete wall palette', (theme) => {
    const keys = ['base', 'stripe', 'trim', 'ink', 'soft', 'appliance', 'applianceDark', 'floor', 'floorTile', 'glass']
    expect(Object.keys(theme.wall).sort()).toEqual([...keys].sort())
    for (const k of keys) expect((theme.wall as unknown as Record<string, string>)[k]).toBeTruthy()
  })

  it('keeps the default wall on the app theme variables, so Sakura/Mint/... still tint it', () => {
    const pastel = KITCHEN_THEMES.find((t) => t.key === 'pastel')!
    expect(pastel.wall.base).toBe('var(--color-border)')
    expect(pastel.wall.ink).toBe('var(--color-text)')
  })
})
