/**
 * ThemeProvider tests
 *
 * These tests verify the React context + DOM integration layer for the theme
 * switcher. All four tests require a real DOM (localStorage, document.documentElement)
 * which is why we run them under jsdom (set globally in jest.config.js).
 *
 * We deliberately do NOT test internal state variables — only the two observable
 * side-effects: document.documentElement.dataset.theme and localStorage.
 */

import React from 'react'
import { render, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/components/ThemeProvider'

// Helper: a tiny consumer component that calls useTheme and exposes the result
// via a data attribute so we can assert on it without coupling to internals.
function ThemeConsumer() {
  const { theme, setTheme } = useTheme()
  return (
    <div
      data-testid="consumer"
      data-theme-value={theme}
      onClick={() => setTheme('mint')}
    />
  )
}

// Clear localStorage and reset data-theme before each test to avoid
// state leaking between tests.
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

// ─── Test 1: Default to sakura ───────────────────────────────────────────────
// WHY: When no theme is stored, the app should start with 'sakura' (the design
// default). This also verifies that ThemeProvider immediately sets data-theme on
// mount so the DOM and the flash-prevention script agree.
it('defaults to sakura when localStorage has no entry', () => {
  render(
    <ThemeProvider>
      <ThemeConsumer />
    </ThemeProvider>
  )

  expect(document.documentElement.dataset.theme).toBe('sakura')
})

// ─── Test 2: Restore from localStorage ───────────────────────────────────────
// WHY: If the user previously picked 'lavender', the page should load with that
// theme — no flash, no reset to default. ThemeProvider must read localStorage
// on mount and apply the stored key immediately.
it('restores theme from localStorage on mount', () => {
  localStorage.setItem('bubbly-theme', 'lavender')

  render(
    <ThemeProvider>
      <ThemeConsumer />
    </ThemeProvider>
  )

  expect(document.documentElement.dataset.theme).toBe('lavender')
})

// ─── Test 3: setTheme updates both DOM and localStorage synchronously ─────────
// WHY: When the user clicks the theme picker, the visual change must happen
// immediately (DOM attribute) AND persist across page reloads (localStorage).
// Both must happen in the same synchronous call — no micro-task split that
// could cause a frame of wrong theme.
it('setTheme updates document.documentElement.dataset.theme and localStorage', async () => {
  render(
    <ThemeProvider>
      <ThemeConsumer />
    </ThemeProvider>
  )

  // Initially sakura (no localStorage entry)
  expect(document.documentElement.dataset.theme).toBe('sakura')

  // ThemeConsumer's onClick calls setTheme('mint')
  const consumer = document.querySelector('[data-testid="consumer"]') as HTMLElement
  await act(async () => {
    consumer.click()
  })

  expect(document.documentElement.dataset.theme).toBe('mint')
  expect(localStorage.getItem('bubbly-theme')).toBe('mint')
})

// ─── Test 4: useTheme throws outside ThemeProvider ───────────────────────────
// WHY: A hook that silently returns null/undefined when called outside its
// provider causes cryptic runtime crashes elsewhere. A descriptive thrown error
// immediately tells the developer what went wrong and where to fix it.
// We suppress React's error boundary output with a spy to keep test output clean.
it('useTheme throws a descriptive error when called outside ThemeProvider', () => {
  function Orphan() {
    useTheme() // no provider wrapping this
    return null
  }

  // Suppress React's "An update to ... inside a test" noise
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

  expect(() => render(<Orphan />)).toThrow(
    /useTheme.*ThemeProvider/i
  )

  consoleSpy.mockRestore()
})
