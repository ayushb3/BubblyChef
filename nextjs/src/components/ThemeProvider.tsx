'use client'

import { createContext, useContext, useEffect, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThemeKey = 'sakura' | 'mint' | 'lavender' | 'yuzu' | 'bluebell'

interface ThemeContextValue {
  theme: ThemeKey
  setTheme: (key: ThemeKey) => void
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_THEMES: ThemeKey[] = ['sakura', 'mint', 'lavender', 'yuzu', 'bluebell']
const STORAGE_KEY = 'bubbly-theme'
const DEFAULT_THEME: ThemeKey = 'sakura'

function isValidTheme(value: string): value is ThemeKey {
  return (VALID_THEMES as string[]).includes(value)
}

// ─── Context ─────────────────────────────────────────────────────────────────

// We use null as the sentinel value so useTheme() can detect "called outside
// provider" and throw a helpful error rather than silently returning undefined.
const ThemeContext = createContext<ThemeContextValue | null>(null)

// ─── Provider ────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start with DEFAULT_THEME so server and client render identically.
  // WHY: reading localStorage in a lazy initialiser causes a hydration mismatch
  // because the server always sees DEFAULT_THEME while the client may see a
  // stored value — React flags the divergence. We correct to the stored value
  // in the effect below, after hydration.
  const [theme, setThemeState] = useState<ThemeKey>(DEFAULT_THEME)

  // On mount: read localStorage and apply the stored theme.
  // WHY split from useState: this runs only on the client after hydration, so
  // both passes agree on DEFAULT_THEME and there is no mismatch.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const resolved = stored !== null && isValidTheme(stored) ? stored : DEFAULT_THEME
    // Deliberate: localStorage isn't readable during SSR, so the only way to
    // correct the theme after the (mandatory) DEFAULT_THEME-on-both-passes
    // first render is in an effect, once we know we've hydrated. There's no
    // prop/derived-value this could be computed from during render — moving
    // it there would either reintroduce the server/client mismatch this
    // avoids, or read localStorage during SSR (which doesn't exist). See the
    // WHY comment on `theme` above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [])

  const setTheme = (key: ThemeKey) => {
    setThemeState(key)
    localStorage.setItem(STORAGE_KEY, key)
    // Synchronous setAttribute avoids a one-frame flash; React state catches up next render.
    document.documentElement.setAttribute('data-theme', key)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx === null) {
    throw new Error(
      'useTheme must be called inside a <ThemeProvider>. ' +
        'Wrap your component tree with <ThemeProvider> before calling useTheme().'
    )
  }
  return ctx
}
