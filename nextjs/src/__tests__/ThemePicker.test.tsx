/**
 * ThemePicker tests.
 *
 * Why real-ThemeProvider over jest.mock('useTheme')?
 *
 * The mock approach isolates the component but has a critical blind spot: it
 * cannot verify that clicking a swatch actually propagates through the real
 * context and lands on document.documentElement.dataset.theme. If the wiring
 * between ThemePicker → useTheme → ThemeProvider → DOM is broken, a mock test
 * would pass right through the breakage because it replaced the real wiring with
 * a stub. The real-provider approach tests the full integration path — the same
 * path users actually exercise — so a regression in ThemeProvider.setTheme would
 * surface here instead of silently being masked. The trade-off is a slightly
 * heavier test (needs a provider wrapper), but that overhead is trivial in jsdom.
 *
 * The picker is a trigger + popover (see the component for why), so each test
 * opens the popover first. `within(...)` scopes palette queries to the popover
 * so the trigger button is never counted as an option.
 */

import React from 'react'
import { render, screen, within, act, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import ThemePicker from '@/components/ui/ThemePicker'

// Reset DOM + localStorage before each test so state does not leak.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

/** Render the picker and open its popover, returning the popover element. */
async function renderAndOpen(): Promise<HTMLElement> {
  render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>
  )

  const trigger = screen.getByRole('button', { name: /change theme/i })
  await act(async () => {
    trigger.click()
  })

  return screen.getByRole('group', { name: /theme picker/i })
}

// ─── Test 1: Renders exactly five palette options ────────────────────────────
// WHY: The spec calls for exactly five palettes — one per ThemeKey. Too few
// means palettes are missing; too many means spurious buttons were added. An
// exact count is the tightest assertion that catches both errors.
it('renders exactly five theme options when opened', async () => {
  const popover = await renderAndOpen()

  const options = within(popover).getAllByRole('button')
  expect(options).toHaveLength(5)
})

// ─── Test 2: Trigger meets the 44×44 tap-target guidance ─────────────────────
// WHY: this component exists in its current shape specifically to satisfy WCAG
// 2.5.5. The previous inline-dot version used 28×28 targets. Asserting the
// sizing classes here stops a future restyle from silently regressing it.
it('exposes a 44x44 trigger and keeps the popover closed initially', () => {
  render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>
  )

  const trigger = screen.getByRole('button', { name: /change theme/i })
  expect(trigger).toHaveClass('w-11', 'h-11') // Tailwind w-11/h-11 === 44px
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('group', { name: /theme picker/i })).not.toBeInTheDocument()
})

// ─── Test 3: Active option has aria-current, no other option does ────────────
// WHY: aria-current="true" is the accessible signal that screen readers use to
// announce which palette is selected. If the wrong button (or multiple buttons)
// carry this attribute, AT users get incorrect feedback. We assert:
//   (a) the expected palette's button has aria-current="true"
//   (b) no other option has the attribute at all (not even aria-current="false")
//
// We pre-set localStorage to 'mint' before rendering so ThemeProvider hydrates
// with 'mint' as the initial theme — this lets us test a non-default active state.
it('marks only the active theme option with aria-current="true"', async () => {
  localStorage.setItem('bubbly-theme', 'mint')

  const popover = await renderAndOpen()

  const mintButton = within(popover).getByRole('button', { name: /switch to mint theme/i })
  expect(mintButton).toHaveAttribute('aria-current', 'true')

  const otherButtons = within(popover)
    .getAllByRole('button')
    .filter((b) => b !== mintButton)
  for (const btn of otherButtons) {
    expect(btn).not.toHaveAttribute('aria-current')
  }
})

// ─── Test 4: Click triggers setTheme via real ThemeProvider ──────────────────
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
it('clicking a non-active option updates document.documentElement[data-theme]', async () => {
  const popover = await renderAndOpen()

  // Verify initial state
  expect(document.documentElement.dataset.theme).toBe('sakura')

  const lavenderButton = within(popover).getByRole('button', {
    name: /switch to lavender theme/i,
  })

  await act(async () => {
    lavenderButton.click()
  })

  // The DOM attribute must have updated synchronously through the real context
  expect(document.documentElement.dataset.theme).toBe('lavender')
  // localStorage must also be updated (persistence)
  expect(localStorage.getItem('bubbly-theme')).toBe('lavender')
})

// ─── Test 5: Selecting an option dismisses the popover ───────────────────────
// WHY: leaving the popover open after a choice would obscure the very theme
// change the user just made.
it('closes the popover after a theme is chosen', async () => {
  const popover = await renderAndOpen()

  await act(async () => {
    within(popover).getByRole('button', { name: /switch to yuzu theme/i }).click()
  })

  // aria-expanded flips synchronously with state, so it is asserted directly.
  // The popover element itself lingers for the AnimatePresence exit transition,
  // so that one needs waitFor rather than an immediate check.
  expect(screen.getByRole('button', { name: /change theme/i })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await waitFor(() =>
    expect(screen.queryByRole('group', { name: /theme picker/i })).not.toBeInTheDocument()
  )
})
