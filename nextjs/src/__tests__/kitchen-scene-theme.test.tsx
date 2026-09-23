/**
 * Tests for `KitchenScene`'s `theme` prop (issue #523): decorations render
 * identically across themes, only the background differs, and an unset
 * `theme` prop defaults to `pastel` (pre-#523 callers keep working).
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
    render(<KitchenScene unlocked={[]} balance={0} />)
    expect(screen.getByTestId('kitchen-scene')).toHaveAttribute('data-kitchen-theme', 'pastel')
  })

  it.each(KITCHEN_THEMES)('renders every slot filled the same way under $key', (theme) => {
    render(<KitchenScene unlocked={unlocked} balance={0} theme={theme} />)

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
      <KitchenScene unlocked={unlocked} balance={0} theme={pastel} />,
    )
    const namesA = screen.getAllByRole('img').map((el) => el.getAttribute('aria-label'))
    unmount()

    const { container: containerB } = render(
      <KitchenScene unlocked={unlocked} balance={0} theme={nightKitchen} />,
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
})
