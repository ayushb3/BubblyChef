/**
 * Tests for `KitchenScene` (issue #521, carried onto the pixel wall in #748):
 * empty / partially-filled / fully-filled states, and that malformed `unlocked`
 * rows (an id not in the catalog, or a slot not in SLOTS) are dropped silently
 * rather than thrown on.
 *
 * Rewritten in #748: the scene no longer draws the bubbles balance or the
 * streak (they moved to the header and the toolbar, tested in
 * `kitchen-home.test.tsx`), and empty slots are no
 * longer dashed placeholder boxes (on the wall they would read as clutter).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenScene, { type KitchenSceneProps } from '@/components/kitchen/KitchenScene'
import { SLOTS } from '@/lib/kitchen/slots'
import { CATALOG } from '@/lib/kitchen/catalog'

function renderScene(props: Partial<KitchenSceneProps> = {}) {
  return render(<KitchenScene unlocked={[]} onOpenPlace={jest.fn()} {...props} />)
}

describe('KitchenScene (#521, #748)', () => {
  it('renders the 12 slots, all empty, when nothing is unlocked', () => {
    renderScene()

    expect(screen.getByTestId('kitchen-scene')).toBeInTheDocument()
    expect(screen.getByTestId('kitchen-wall')).toBeInTheDocument()
    for (const slot of SLOTS) {
      const el = screen.getByTestId(`kitchen-slot-${slot.key}`)
      expect(el.getAttribute('data-filled')).toBe('false')
    }
  })

  it('renders some filled and some empty slots when partially unlocked', () => {
    // Two entries in different slots: CATALOG[0] and CATALOG[1] are both
    // wall_shelf, so the second would overwrite the first.
    const first = CATALOG[0]
    const second = CATALOG.find((d) => d.slot !== first.slot)!
    renderScene({
      unlocked: [
        { id: first.id, slot: first.slot },
        { id: second.id, slot: second.slot },
      ],
    })

    const filledKeys = new Set([first.slot, second.slot])
    for (const slot of SLOTS) {
      const el = screen.getByTestId(`kitchen-slot-${slot.key}`)
      expect(el.getAttribute('data-filled')).toBe(filledKeys.has(slot.key) ? 'true' : 'false')
    }
  })

  it('renders every slot filled when one catalog entry per slot is unlocked', () => {
    // One entry per slot key — CATALOG guarantees at least one exists
    // (kitchen-catalog.test.ts), so pick the first match per slot.
    const oneEntryPerSlot = SLOTS.map((slot) => CATALOG.find((d) => d.slot === slot.key)!)
    renderScene({ unlocked: oneEntryPerSlot.map((d) => ({ id: d.id, slot: d.slot })) })

    for (const slot of SLOTS) {
      expect(screen.getByTestId(`kitchen-slot-${slot.key}`).getAttribute('data-filled')).toBe('true')
    }
  })

  it('positions every slot with its percent box on the wall', () => {
    renderScene()
    for (const slot of SLOTS) {
      const el = screen.getByTestId(`kitchen-slot-${slot.key}`)
      expect(el.style.left).toBe(`${slot.x}%`)
      expect(el.style.top).toBe(`${slot.y}%`)
      expect(el.style.width).toBe(`${slot.w}%`)
      expect(el.style.height).toBe(`${slot.h}%`)
    }
  })

  it('hides empty slots from screen readers and names filled ones after the decoration', () => {
    const first = CATALOG[0]
    renderScene({ unlocked: [{ id: first.id, slot: first.slot }] })

    for (const slot of SLOTS) {
      const el = screen.getByTestId(`kitchen-slot-${slot.key}`)
      if (slot.key === first.slot) {
        expect(el).not.toHaveAttribute('aria-hidden')
      } else {
        expect(el).toHaveAttribute('aria-hidden', 'true')
      }
    }
    // Only the one filled slot reaches the accessibility tree as an image (the
    // wall's SVG is decorative), under the decoration's own name.
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: first.name })).toBeInTheDocument()
  })

  it('lets a tap through a decoration to the place under it', () => {
    const first = CATALOG[0]
    renderScene({ unlocked: [{ id: first.id, slot: first.slot }] })
    expect(screen.getByTestId(`kitchen-slot-${first.slot}`).className).toContain('pointer-events-none')
  })

  it('ignores an unlocked row whose id is not in CATALOG, without throwing', () => {
    expect(() => renderScene({ unlocked: [{ id: 'not_a_real_id', slot: 'wall_shelf' }] })).not.toThrow()
    expect(screen.getByTestId('kitchen-slot-wall_shelf').getAttribute('data-filled')).toBe('false')
  })

  it('ignores an unlocked row whose slot is not in SLOTS, without throwing', () => {
    const real = CATALOG[0]
    expect(() => renderScene({ unlocked: [{ id: real.id, slot: 'not_a_real_slot' }] })).not.toThrow()
    // The real catalog entry's actual slot stays empty because the row
    // claimed a different (bogus) slot than the one the catalog assigns it.
    expect(screen.getByTestId(`kitchen-slot-${real.slot}`).getAttribute('data-filled')).toBe('false')
  })

  it('renders the wall at its final size and the empty slots while loading', () => {
    renderScene({ loading: true })

    expect(screen.getByTestId('kitchen-wall').className).toContain('aspect-[96/80]')
    for (const slot of SLOTS) {
      expect(screen.getByTestId(`kitchen-slot-${slot.key}`).getAttribute('data-filled')).toBe('false')
    }
  })

  it('does not paint slots from already-held unlocked data while still loading', () => {
    // Same shape as the "every slot filled" case above, but with `loading`
    // set — this is the one case that actually exercises the `if (!loading)`
    // guard in KitchenScene. A test that pairs `loading` with an empty
    // `unlocked` array can't tell the guard apart from simply having no data
    // to render; passing real, resolvable rows here means the assertions
    // below only pass because the guard suppresses them, not because there
    // was nothing to show.
    const oneEntryPerSlot = SLOTS.map((slot) => CATALOG.find((d) => d.slot === slot.key)!)
    renderScene({
      unlocked: oneEntryPerSlot.map((d) => ({ id: d.id, slot: d.slot })),
      loading: true,
    })

    for (const slot of SLOTS) {
      expect(screen.getByTestId(`kitchen-slot-${slot.key}`).getAttribute('data-filled')).toBe('false')
    }
  })

  it('passes the place tap and the plan-dinner link through to the wall', () => {
    const onOpenPlace = jest.fn()
    renderScene({ onOpenPlace, planDinnerHref: '/chat?x=1' })
    screen.getByRole('button', { name: 'Fridge' }).click()
    expect(onOpenPlace).toHaveBeenCalledWith('fridge')
    expect(screen.getByRole('link', { name: 'Plan dinner' })).toHaveAttribute('href', '/chat?x=1')
  })
})
