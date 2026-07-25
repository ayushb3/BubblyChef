/**
 * ThemePicker tests — TDD suite written BEFORE implementation.
 *
 * Why real-ThemeProvider over jest.mock('useTheme')?
 *
 * The mock approach isolates the component but has a critical blind spot: it
 * cannot verify that clicking a circle actually propagates through the real
 * context and lands on document.documentElement.dataset.theme. If the wiring
 * between ThemePicker → useTheme → ThemeProvider → DOM is broken, a mock test
 * would pass right through the breakage because it replaced the real wiring with
 * a stub. The real-provider approach tests the full integration path — the same
 * path users actually exercise — so a regression in ThemeProvider.setTheme would
 * surface here instead of silently being masked. The trade-off is a slightly
 * heavier test (needs a provider wrapper), but that overhead is trivial in jsdom.
 */

import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import ThemePicker from '@/components/ui/ThemePicker'

// Reset DOM + localStorage before each test so state does not leak.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

// ─── Test 1: Renders exactly five circles ────────────────────────────────────
// WHY: The spec calls for exactly five palette circles — one per ThemeKey.
// Too few means palettes are missing; too many means spurious buttons were
// added. An exact count is the tightest assertion that catches both errors.
it('renders exactly five theme-picker buttons', () => {
  render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>
  )

  // getAllByRole('button') finds ALL buttons in the subtree. Because ThemePicker
  // is a small, focused component with no other buttons, this gives us a clean
  // count of the circle buttons only.
  const buttons = screen.getAllByRole('button')
  expect(buttons).toHaveLength(5)
})

// ─── Test 2: Active circle has aria-current, no other circle does ────────────
// WHY: aria-current="true" is the accessible signal that screen readers use to
// announce which palette is selected. If the wrong button (or multiple buttons)
// carry this attribute, AT users get incorrect feedback. We assert:
//   (a) exactly one button has aria-current="true"
//   (b) that button belongs to the expected palette
//   (c) no other button has the attribute at all (not even aria-current="false")
//
// We pre-set localStorage to 'mint' before rendering so ThemeProvider hydrates
// with 'mint' as the initial theme — this lets us test a non-default active state.
it('marks only the active theme button with aria-current="true"', () => {
  localStorage.setItem('bubbly-theme', 'mint')

  render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>
  )

  // Find the mint button by its aria-label (the spec mandates this label pattern)
  const mintButton = screen.getByRole('button', { name: /switch to mint theme/i })
  expect(mintButton).toHaveAttribute('aria-current', 'true')

  // All other buttons must NOT have aria-current at all
  const allButtons = screen.getAllByRole('button')
  const otherButtons = allButtons.filter((b) => b !== mintButton)
  for (const btn of otherButtons) {
    expect(btn).not.toHaveAttribute('aria-current')
  }
})

// ─── Test 3: Click triggers setTheme via real ThemeProvider ──────────────────
// WHY: We use the real ThemeProvider here (not a mock) to test the full
// integration path. If we mocked useTheme, a broken wiring between ThemePicker
// and ThemeProvider would go undetected. By asserting on
// document.documentElement.dataset.theme — the same observable side-effect that
// the browser sees — we verify the complete chain:
//   button click → setTheme('lavender') → ThemeProvider state update
//   → document.documentElement.setAttribute('data-theme', 'lavender')
//
// Starting theme is 'sakura' (no localStorage entry), so we can prove the change
// from default rather than asserting a no-op.
it('clicking a non-active circle updates document.documentElement[data-theme]', async () => {
  render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>
  )

  // Verify initial state
  expect(document.documentElement.dataset.theme).toBe('sakura')

  // Click the lavender circle
  const lavenderButton = screen.getByRole('button', { name: /switch to lavender theme/i })

  await act(async () => {
    lavenderButton.click()
  })

  // The DOM attribute must have updated synchronously through the real context
  expect(document.documentElement.dataset.theme).toBe('lavender')
  // localStorage must also be updated (persistence)
  expect(localStorage.getItem('bubbly-theme')).toBe('lavender')
})
