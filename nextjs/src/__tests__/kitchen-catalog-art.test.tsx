/**
 * Every decoration in the catalog renders recognisable art (issue #748).
 *
 * The old rug entries were coloured-square emoji (🟪 🟦), which draw as a bare
 * block and read as a decoration whose art failed to load. Pixel art for each
 * entry is issue #751; until then every entry must at least have art or a real
 * emoji, and must render in its slot under its own name.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import KitchenScene from '@/components/kitchen/KitchenScene'
import { CATALOG } from '@/lib/kitchen/catalog'

// Bare coloured-block emoji and geometric squares.
const BLOCK_EMOJI = /^(?:🟥|🟧|🟨|🟩|🟦|🟪|🟫|⬛|⬜|◼️|◻️|■|□)$/u

describe('CATALOG art renders (#748)', () => {
  it.each(CATALOG.map((d) => [d.id, d] as const))('%s has art a user can recognise', (_id, d) => {
    expect(d.art || d.emoji).toBeTruthy()
    if (!d.art) expect(d.emoji).not.toMatch(BLOCK_EMOJI)
  })

  it.each(CATALOG.map((d) => [d.id, d] as const))('%s renders in its slot, named', (_id, d) => {
    render(<KitchenScene unlocked={[{ id: d.id, slot: d.slot }]} onOpenPlace={jest.fn()} />)
    const slot = screen.getByTestId(`kitchen-slot-${d.slot}`)
    expect(slot.getAttribute('data-filled')).toBe('true')
    const img = screen.getByRole('img', { name: d.name })
    expect(slot).toContainElement(img)
    // Either an <img> with art, or a non-empty emoji glyph.
    expect(img.tagName === 'IMG' || (img.textContent ?? '').length > 0).toBe(true)
  })
})
