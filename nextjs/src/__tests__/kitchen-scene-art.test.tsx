/**
 * `art` field coverage for `KitchenScene` (issue #521 review finding).
 *
 * Every entry in the real `CATALOG` today has no `art` set — placeholder
 * emoji only — so `kitchen-scene.test.tsx` never exercises the image branch.
 * Issue #527 is meant to fill `art` in as a pure data change, with no code
 * change in `KitchenScene`; this test mocks the catalog module (isolated to
 * this file, so the un-mocked suite in `kitchen-scene.test.tsx` is
 * unaffected) to prove that branch actually renders an `<img>` today.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenScene from '@/components/kitchen/KitchenScene'

jest.mock('@/lib/kitchen/catalog', () => {
  const actual = jest.requireActual('@/lib/kitchen/catalog')
  const [first, ...rest] = actual.CATALOG
  return {
    ...actual,
    CATALOG: [{ ...first, art: '/kitchen/shelf_mugs.png' }, ...rest],
  }
})

describe('KitchenScene — art field (#521)', () => {
  it("renders an <img> at the catalog entry's art path instead of the emoji", async () => {
    const { CATALOG } = await import('@/lib/kitchen/catalog')
    const decorated = CATALOG[0]
    render(<KitchenScene unlocked={[{ id: decorated.id, slot: decorated.slot }]} balance={0} />)

    const slotEl = screen.getByTestId(`kitchen-slot-${decorated.slot}`)
    const img = slotEl.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toContain('shelf_mugs.png')
    expect(slotEl.querySelector('[role="img"]')).toBeNull()
  })

  it('falls back to the emoji when a catalog entry has no art', async () => {
    const { CATALOG } = await import('@/lib/kitchen/catalog')
    const undecorated = CATALOG[1]
    render(<KitchenScene unlocked={[{ id: undecorated.id, slot: undecorated.slot }]} balance={0} />)

    const slotEl = screen.getByTestId(`kitchen-slot-${undecorated.slot}`)
    expect(slotEl.querySelector('img')).toBeNull()
    expect(slotEl.querySelector('[role="img"]')).not.toBeNull()
  })
})
