/**
 * Issue #147 — no visible focus indicator anywhere in the app.
 *
 * Mirrors the theme-safety guard in `loading-ui.test.tsx`: the whole point of
 * `--color-focus-ring` aliasing `--color-text` (rather than hardcoding a hex)
 * is that it must re-resolve correctly under all five `[data-theme="*"]`
 * blocks. A literal hex anywhere in the focus-ring token/utility definitions
 * would defeat that and silently break four of the five themes.
 *
 * Two halves:
 *  1. `globals.css` defines the token + both ring utilities, with no hex
 *     literal in that block.
 *  2. The components this issue named (shared atoms + the confirmed
 *     `focus:outline-none` sites) actually apply `focus-ring`/`focus-ring-inset`
 *     — not just that the utility exists somewhere unused.
 */
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import Chip from '@/components/ui/Chip'
import SpringButton from '@/components/ui/SpringButton'
import BottomNav from '@/components/layout/BottomNav'

// Any 6- or 3-digit hex colour literal.
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

function globalsCss(): string {
  return fs.readFileSync(
    path.join(__dirname, '../app/globals.css'),
    'utf8'
  )
}

/**
 * The token declaration is a single line inside `:root`, textually *before*
 * the five `[data-theme="*"]` blocks (which legitimately contain hex literals
 * for the palettes) — so it's checked as its own line, not a wider slice that
 * would sweep those theme blocks in too.
 */
function focusRingTokenLine(css: string): string {
  const line = css
    .split('\n')
    .find((l) => l.includes('--color-focus-ring:'))
  expect(line).toBeDefined()
  return line as string
}

/**
 * The utility rules live in their own `@layer utilities` block at the bottom
 * of the file, entirely after every `[data-theme="*"]` block — so slicing
 * from its start to EOF is safe and doesn't need to dodge palette hex values.
 */
function focusRingUtilityBlock(css: string): string {
  const start = css.indexOf('@layer utilities {')
  expect(start).toBeGreaterThan(-1)
  return css.slice(start)
}

describe('globals.css focus-ring definition', () => {
  const css = globalsCss()

  it('aliases --color-text via var(), not a hardcoded hex', () => {
    const line = focusRingTokenLine(css)
    expect(line).toMatch(/--color-focus-ring:\s*var\(--color-text\)/)
    expect(line).not.toMatch(HEX_COLOR)
  })

  it('defines both the outward and inset utility classes', () => {
    expect(css).toMatch(/\.focus-ring\s*\{/)
    expect(css).toMatch(/\.focus-ring:focus-visible\s*\{/)
    expect(css).toMatch(/\.focus-ring-inset\s*\{/)
    expect(css).toMatch(/\.focus-ring-inset:focus-visible\s*\{/)
  })

  it('only styles :focus-visible, not :focus (no ring on mouse click)', () => {
    const block = focusRingUtilityBlock(css)
    // outline-color is only ever set inside a :focus-visible block.
    const outlineColorLines = block
      .split('\n')
      .filter((l) => l.includes('outline-color'))
    expect(outlineColorLines.length).toBe(2) // .focus-ring + .focus-ring-inset
  })

  it('contains no hardcoded hex colour in the utility rule bodies', () => {
    expect(focusRingUtilityBlock(css)).not.toMatch(HEX_COLOR)
  })
})

describe('focus-ring applied to shared design-system atoms', () => {
  it('Chip always carries focus-ring, even with a custom className', () => {
    render(<Chip onClick={() => {}} className="extra-class">Snack</Chip>)
    const chip = screen.getByRole('button', { name: 'Snack' })
    expect(chip.className).toMatch(/\bfocus-ring\b/)
    expect(chip.className).not.toMatch(HEX_COLOR)
  })

  it('SpringButton carries focus-ring under both the default and a custom className', () => {
    const { rerender } = render(<SpringButton>Default</SpringButton>)
    expect(screen.getByRole('button', { name: 'Default' }).className).toMatch(/\bfocus-ring\b/)

    rerender(<SpringButton className="totally-custom">Custom</SpringButton>)
    expect(screen.getByRole('button', { name: 'Custom' }).className).toMatch(/\bfocus-ring\b/)
  })

  it('BottomNav tabs carry a focus ring (inset — pinned to the viewport edge)', () => {
    render(<BottomNav />)
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toMatch(/\bfocus-ring-inset\b/)
    }
  })
})
