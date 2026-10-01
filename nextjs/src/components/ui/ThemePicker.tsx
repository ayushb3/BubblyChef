'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '@/components/ThemeProvider'
import type { ThemeKey } from '@/components/ThemeProvider'
import { useMotionConfig } from '@/lib/motion'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'

// ─── Static palette data ──────────────────────────────────────────────────────
// Each swatch must always display its own theme's hue regardless of which theme
// is active on the page, so a bare var(--color-primary) would paint all five the
// same. Instead each swatch carries `data-theme={key}`: globals.css scopes the
// palette variables to `[data-theme="..."]`, so on that element (and only that
// element) --color-primary resolves to that theme's primary. No hex here.

const PALETTES: Array<{ key: ThemeKey; name: string; label: string }> = [
  { key: 'sakura',   name: 'Sakura',   label: 'Switch to sakura theme' },
  { key: 'mint',     name: 'Mint',     label: 'Switch to mint theme' },
  { key: 'lavender', name: 'Lavender', label: 'Switch to lavender theme' },
  { key: 'yuzu',     name: 'Yuzu',     label: 'Switch to yuzu theme' },
  { key: 'bluebell', name: 'Bluebell', label: 'Switch to bluebell theme' },
]

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Theme picker as a single trigger + popover.
 *
 * WHY a popover rather than the inline row of dots this replaced: WCAG 2.5.5
 * wants 44×44 CSS px tap targets, and five of those in a row needs ~220px. The
 * header this sits in is ~330px of usable width on a 360px phone, shared with
 * the mascot and title — so an inline row can only meet the size guidance by
 * overflowing. Collapsing to one 44×44 trigger keeps the header compact, gives
 * every option a full-height row, and lets each palette carry a visible name
 * instead of relying on colour alone (which never worked for colour-blind users
 * in the dots version).
 */
export default function ThemePicker() {
  const { theme, setTheme } = useTheme()
  const { springs } = useMotionConfig()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const active = PALETTES.find((p) => p.key === theme) ?? PALETTES[0]

  // Dismiss on outside click. Escape-to-close, Tab-trap-while-open, and
  // focus-restore-to-trigger are now handled by the shared hook (issue
  // #291) — this popover keeps its own `role="group"` / `aria-label`
  // (below) rather than `role="dialog"`, since it's a lightweight anchored
  // menu with no backdrop, not a page-blocking dialog; the trap/Escape/
  // restore behaviour is what's shared, not the ARIA role.
  useEffect(() => {
    if (!open) return

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [open])

  useModalFocusTrap(open, () => setOpen(false), panelRef)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        aria-label={`Change theme, current theme ${active.name}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {/* The visible swatch stays 24px; the 44×44 button around it is the tap target. */}
        <span
          aria-hidden="true"
          data-theme={active.key}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: 'var(--color-primary)',
            border: '1px solid rgba(0,0,0,0.08)',
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={springs.snappy}
            className="absolute right-0 top-12 z-20 rounded-2xl overflow-hidden outline-none"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-pop)',
              minWidth: '160px',
            }}
            role="group"
            aria-label="Theme picker"
            tabIndex={-1}
          >
            {PALETTES.map(({ key, name, label }) => {
              const isActive = theme === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  // aria-current="true" on the active item is the accessible signal
                  // screen readers use to announce which palette is selected. We set
                  // it only on the active button — omitting it entirely on inactive
                  // ones (rather than aria-current="false") is the recommended ARIA
                  // pattern; "false" adds noise to AT output.
                  {...(isActive ? { 'aria-current': 'true' as const } : {})}
                  onClick={() => {
                    if (!isActive) setTheme(key)
                    setOpen(false)
                  }}
                  // py-3 + 20px swatch puts each row at 44px tall.
                  className="font-sans w-full px-4 py-3 flex items-center gap-3 text-left text-sm font-semibold hover:bg-[var(--color-bg)] transition-colors"
                  style={{ color: 'var(--color-text)' }}
                >
                  <span
                    aria-hidden="true"
                    data-theme={key}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
                      border: '1px solid rgba(0,0,0,0.08)',
                      flexShrink: 0,
                    }}
                  />
                  <span className="flex-1">{name}</span>
                  {isActive && <span aria-hidden="true">✓</span>}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
