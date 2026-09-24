'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell } from '@phosphor-icons/react/dist/ssr'
import { useMotionConfig } from '@/lib/motion'
import { useInboxEntries } from '@/hooks/useInboxEntries'
import type { InboxEntry, InboxTier } from '@/lib/inbox-helpers'
import BubblesMascot from '@/components/ui/BubblesMascot'

/** Maps an entry's urgency tier onto the existing 3-tier expiry palette (globals.css). */
const TIER_STYLE: Record<InboxTier, { bg: string; text: string }> = {
  urgent: { bg: 'var(--color-expired)', text: 'var(--color-expired-text)' },
  warning: { bg: 'var(--color-expiring)', text: 'var(--color-expiring-text)' },
  info: { bg: 'var(--color-fresh)', text: 'var(--color-fresh-text)' },
}

/**
 * Header bell + dropdown for the lite notification center (#496, Spec B.4).
 *
 * Compute-on-load, no persistence, no read/unread: `useInboxEntries` derives
 * fresh entries every time the dropdown opens (`refresh()` below), and
 * nothing here is written to storage or the DB. Fixed trigger set — there is
 * no settings surface, by design (see the issue's "Decisions settled here").
 *
 * Rendered inside `BubblesHeader` itself (next to whatever `rightSlot` the
 * page passes, usually `ProfileHeaderButton`) so every page that already
 * uses the shared header gets the bell for free — this deliberately does not
 * assume anything about the home layout, which is still being reworked
 * separately (PR #597).
 */
export default function NotificationBell() {
  const { springs, reduced } = useMotionConfig()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { entries, overflowCount, loading, refresh } = useInboxEntries()
  // Fixed-position top offset, measured from the bell button each time it
  // opens. The dropdown is anchored to the *viewport's* right edge (see the
  // `right-4` below), not to the bell button's own edge — the bell usually
  // isn't the rightmost element in the header (a profile button or item
  // count sits further right), and anchoring a 300px-wide popover to a
  // button positioned mid-header pushed it off the left edge of the screen
  // on real mobile widths. Only `top` needs measuring; `right` is a fixed
  // screen-edge inset matching the header's own padding.
  const [dropdownTop, setDropdownTop] = useState(56)

  useEffect(() => {
    if (!open) return

    if (buttonRef.current) {
      setDropdownTop(Math.round(buttonRef.current.getBoundingClientRect().bottom) + 8)
    }

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

  const toggleOpen = () => {
    setOpen((o) => {
      const next = !o
      if (next) refresh()
      return next
    })
  }

  const count = entries.length + overflowCount

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <Bell size={22} className="text-[var(--color-primary)]" weight={count > 0 ? 'fill' : 'regular'} />
        {count > 0 && (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-surface)',
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={reduced ? { duration: 0.01 } : springs.snappy}
            className="fixed right-4 z-20 rounded-2xl overflow-hidden"
            style={{
              top: `${dropdownTop}px`,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-pop)',
              width: '300px',
              maxWidth: 'calc(100vw - 2rem)',
            }}
            role="menu"
            aria-label="Notifications"
          >
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <p className="text-sm font-bold text-[var(--color-text)]">Notifications</p>
            </div>

            <div className="max-h-[340px] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                  Loading…
                </div>
              ) : entries.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <BubblesMascot state="happy" size={56} animate={!reduced} />
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    Nothing to do right now
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    We&apos;ll let you know when something needs attention.
                  </p>
                </div>
              ) : (
                <ul>
                  {entries.map((entry) => (
                    <InboxRow key={entry.id} entry={entry} onNavigate={() => setOpen(false)} />
                  ))}
                </ul>
              )}
            </div>

            {overflowCount > 0 && (
              <div className="px-4 py-2 border-t border-[var(--color-border)] text-center">
                <p className="text-xs text-[var(--color-muted)]">and {overflowCount} more</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function InboxRow({ entry, onNavigate }: { entry: InboxEntry; onNavigate: () => void }) {
  const style = TIER_STYLE[entry.tier]

  const content = (
    <div className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[var(--color-bg)] transition-colors">
      <span
        aria-hidden="true"
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
        style={{ background: style.bg, color: style.text }}
      >
        {entry.emoji}
      </span>
      <span className="flex-1 text-sm text-[var(--color-text)]">{entry.copy}</span>
    </div>
  )

  if (!entry.href) {
    // Timer entries are dismiss-only in this "lite" ticket (Spec B.3 owns
    // dismissal); listing without a tap target is intentional, not a bug.
    return (
      <li role="menuitem">
        <div className="w-full">{content}</div>
      </li>
    )
  }

  return (
    <li role="menuitem">
      <Link href={entry.href} onClick={onNavigate} className="block min-h-[44px]">
        {content}
      </Link>
    </li>
  )
}
