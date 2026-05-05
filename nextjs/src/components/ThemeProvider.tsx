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
  // Initialise from localStorage on first render.
  // WHY lazy initialiser: avoids reading localStorage on every re-render.
  const [theme, setThemeState] = useState<ThemeKey>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored !== null && isValidTheme(stored) ? stored : DEFAULT_THEME
  })

  // On mount, sync document.documentElement with the resolved theme.
  // WHY: The flash-prevention inline script in layout.tsx reads localStorage
  // and sets data-theme before React hydrates. After hydration, we need to
  // ensure the attribute stays in sync with our React state (they should
  // already agree, but this is the authoritative handshake).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = (key: ThemeKey) => {
    // Update React state (triggers re-render and the useEffect above)
    setThemeState(key)
    // Write to localStorage so the choice persists across page loads
    localStorage.setItem(STORAGE_KEY, key)
    // Update the DOM attribute synchronously — we do this here AND in
    // useEffect so the visual change is instantaneous, not deferred to the
    // next paint. This avoids a one-frame flash when the user picks a theme.
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
