/**
 * Tests for `KitchenScene` (issue #521): empty / partially-filled / fully-
 * filled states, the balance pill, and that malformed `unlocked` rows (an
 * id not in the catalog, or a slot not in SLOTS) are dropped silently
 * rather than thrown on.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenScene from '@/components/kitchen/KitchenScene'
import { SLOTS } from '@/lib/kitchen/slots'
import { CATALOG } from '@/lib/kitchen/catalog'

describe('KitchenScene (#521)', () => {
  it('renders 12 dashed-outline placeholders and the balance when nothing is unlocked', () => {
    render(<KitchenScene unlocked={[]} balance={0} />)

    expect(screen.getByTestId('kitchen-scene')).toBeInTheDocument()
    for (const slot of SLOTS) {
      const el = screen.getByTestId(`kitchen-slot-${slot.key}`)
      expect(el.getAttribute('data-filled')).toBe('false')
    }
    expect(screen.getByTestId('kitchen-bubbles-balance')).toHaveTextContent('🫧 0')
  })

  it('renders some filled and some empty slots when partially unlocked', () => {
    const first = CATALOG[0]
    const second = CATALOG[1]
    render(
      <KitchenScene
        unlocked={[
          { id: first.id, slot: first.slot },
          { id: second.id, slot: second.slot },
        ]}
        balance={7}
      />,
    )

    const filledKeys = new Set([first.slot, second.slot])
    for (const slot of SLOTS) {
      const el = screen.getByTestId(`kitchen-slot-${slot.key}`)
      expect(el.getAttribute('data-filled')).toBe(filledKeys.has(slot.key) ? 'true' : 'false')
    }
    expect(screen.getByTestId('kitchen-bubbles-balance')).toHaveTextContent('🫧 7')
  })

  it('renders every slot filled when one catalog entry per slot is unlocked', () => {
    // One entry per slot key — CATALOG guarantees at least one exists
    // (kitchen-catalog.test.ts), so pick the first match per slot.
    const oneEntryPerSlot = SLOTS.map(
      (slot) => CATALOG.find((d) => d.slot === slot.key)!,
    )
    render(
      <KitchenScene
        unlocked={oneEntryPerSlot.map((d) => ({ id: d.id, slot: d.slot }))}
        balance={42}
      />,
    )

    for (const slot of SLOTS) {
      expect(screen.getByTestId(`kitchen-slot-${slot.key}`).getAttribute('data-filled')).toBe(
        'true',
      )
    }
  })

  it('ignores an unlocked row whose id is not in CATALOG, without throwing', () => {
    expect(() =>
      render(<KitchenScene unlocked={[{ id: 'not_a_real_id', slot: 'wall_shelf' }]} balance={0} />),
    ).not.toThrow()
    expect(screen.getByTestId('kitchen-slot-wall_shelf').getAttribute('data-filled')).toBe('false')
  })

  it('ignores an unlocked row whose slot is not in SLOTS, without throwing', () => {
    const real = CATALOG[0]
    expect(() =>
      render(<KitchenScene unlocked={[{ id: real.id, slot: 'not_a_real_slot' }]} balance={0} />),
    ).not.toThrow()
    // The real catalog entry's actual slot stays empty because the row
    // claimed a different (bogus) slot than the one the catalog assigns it.
    expect(screen.getByTestId(`kitchen-slot-${real.slot}`).getAttribute('data-filled')).toBe(
      'false',
    )
  })

  it('renders the aspect-ratio wrapper and empty slot outlines while loading', () => {
    render(<KitchenScene unlocked={[]} balance={0} loading />)

    expect(screen.getByTestId('kitchen-scene')).toBeInTheDocument()
    for (const slot of SLOTS) {
      expect(screen.getByTestId(`kitchen-slot-${slot.key}`).getAttribute('data-filled')).toBe(
        'false',
      )
    }
  })
})
