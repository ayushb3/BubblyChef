'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMotionConfig } from '@/lib/motion'

export interface FacetOption {
  value: string
  label: string
  emoji?: string
}

export interface FacetDropdownProps {
  options: FacetOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Accessible name for the trigger + popover. Always announced, even when `iconOnly`. */
  ariaLabel: string
  /** Visible label next to the trigger emoji. Omitted for `iconOnly` triggers. */
  triggerLabel?: string
  triggerEmoji?: string
  /** Compact 44×44 circular trigger with no visible text — used for the location facet. */
  iconOnly?: boolean
}

/**
 * Multi-select facet trigger + popover, following `ThemePicker`'s
 * click-outside/Escape-to-dismiss popover pattern (#228) so the pantry filter
 * bar's three facets (location, category, expiry) share one implementation
 * instead of three near-duplicates.
 *
 * Selection is OR-within-facet by design: toggling an option adds/removes it
 * from `selected`, and an empty `selected` means "no constraint" — the caller
 * (`itemMatchesFacets` in `lib/pantry-helpers`) is what encodes that semantic,
 * this component only reports which options are checked.
 */
export default function FacetDropdown({
  options,
  selected,
  onChange,
  ariaLabel,
  triggerLabel,
  triggerEmoji,
  iconOnly = false,
}: FacetDropdownProps) {
  const { springs } = useMotionConfig()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click or Escape — same handler shape as `ThemePicker`.
  useEffect(() => {
    if (!open) return

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const toggleValue = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const hasSelection = selected.length > 0

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        className={
          iconOnly
            ? 'relative w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform'
            : 'relative min-h-[44px] px-4 rounded-full flex items-center gap-1.5 text-sm font-semibold active:scale-95 transition-transform whitespace-nowrap'
        }
        style={{
          background: hasSelection ? 'var(--color-primary)' : 'var(--color-bg)',
          color: hasSelection ? '#fff' : 'var(--color-text)',
          border: '1px solid var(--color-border)',
        }}
      >
        {triggerEmoji && <span aria-hidden="true">{triggerEmoji}</span>}
        {!iconOnly && triggerLabel && <span>{triggerLabel}</span>}
        {hasSelection && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-surface)',
            }}
          >
            {selected.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={springs.snappy}
            className="absolute left-0 top-12 z-20 rounded-2xl overflow-hidden overflow-y-auto"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-pop)',
              minWidth: '180px',
              maxHeight: '260px',
            }}
            role="group"
            aria-label={ariaLabel}
          >
            {options.map(({ value, label, emoji }) => {
              const isActive = selected.includes(value)
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggleValue(value)}
                  // py-3 keeps rows at 44px tall, matching ThemePicker.
                  className="w-full px-4 py-3 flex items-center gap-3 text-left text-sm font-semibold hover:bg-[var(--color-bg)] transition-colors"
                  style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
                >
                  {emoji && <span aria-hidden="true">{emoji}</span>}
                  <span className="flex-1">{label}</span>
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
