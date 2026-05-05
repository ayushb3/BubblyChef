'use client'

import { useTheme } from '@/components/ThemeProvider'
import type { ThemeKey } from '@/components/ThemeProvider'

// ─── Static palette data ──────────────────────────────────────────────────────
// WHY static hex values instead of CSS variables: we need each dot to always
// display its own hue regardless of which theme is currently active on the page.
// If we used var(--color-primary) the dot would show the *active* theme's primary
// colour for every circle, making all five dots look the same and defeating the
// entire purpose of the picker.

const PALETTES: Array<{ key: ThemeKey; hex: string; label: string }> = [
  { key: 'sakura',    hex: '#FFB7C5', label: 'Switch to sakura theme' },
  { key: 'mint',      hex: '#B5EAD7', label: 'Switch to mint theme' },
  { key: 'lavender',  hex: '#C9B5E8', label: 'Switch to lavender theme' },
  { key: 'yuzu',      hex: '#FFDAB3', label: 'Switch to yuzu theme' },
  { key: 'bluebell',  hex: '#B5D5F5', label: 'Switch to bluebell theme' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function ThemePicker() {
  const { theme, setTheme } = useTheme()

  return (
    // A compact horizontal row of circles. `gap-1.5` gives 6px between 28px dots,
    // keeping the row narrow enough to sit comfortably in the BubblesHeader rightSlot.
    <div className="flex items-center gap-1.5" role="group" aria-label="Theme picker">
      {PALETTES.map(({ key, hex, label }) => {
        const isActive = theme === key
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            // aria-current="true" on the active item is the accessible signal used
            // by screen readers to announce which palette is currently selected.
            // We only set the attribute on the active button — omitting it entirely
            // on inactive buttons (rather than aria-current="false") is the
            // recommended ARIA pattern; "false" adds noise to AT output.
            {...(isActive ? { 'aria-current': 'true' as const } : {})}
            onClick={() => {
              if (!isActive) setTheme(key)
            }}
            style={{
              // Minimum 28×28px for mobile tap targets (WCAG 2.5.5 advisory)
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: hex,
              // White ring around the active circle.
              // outline (not border) so the ring sits outside the element without
              // affecting layout or making the circle appear larger to sighted users.
              outline: isActive ? '2px solid white' : 'none',
              outlineOffset: isActive ? '2px' : '0',
              // A subtle border so pale circles are still visible on white backgrounds.
              border: '1px solid rgba(0,0,0,0.08)',
              cursor: isActive ? 'default' : 'pointer',
              // Tap feedback via transform — keeps the interactive feel consistent
              // with other tappable elements in the design system.
              transition: 'transform 0.1s ease, outline 0.15s ease',
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}
