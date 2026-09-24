'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell } from '@phosphor-icons/react/dist/ssr'
import { useMotionConfig } from '@/lib/motion'
import { useInboxEntries } from '@/hooks/useInboxEntries'
import { useCookingTimers } from '@/lib/useCookingTimers'
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
  const { entries, overflowCount, loading, error, refresh } = useInboxEntries()
  // Issue #496's tap-target table: "timer → dismiss". Dismissal goes through
  // the real Spec B.3 store directly — dismissing here also clears the
  // timer from the dock (`TimerDock.tsx`), since both read the same store.
  const { dismiss: dismissTimer } = useCookingTimers()
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

  // `error` intentionally overrides `count`, not just the badge's numeral:
  // React Query keeps the *previous* successful `data` around while a
  // refetch is in flight or has failed (so the dropdown doesn't flash empty
  // between opens), which means `entries`/`overflowCount` can still be the
  // stale pre-error values here. Asserting that stale number in the badge —
  // or even just hiding the digits but keeping `count > 0`'s truthiness —
  // would claim a state the app no longer knows to be true. A failed
  // refresh must show a neutral "we don't know" badge, matching the
  // dropdown's own "Couldn't check right now" panel, not a confident
  // (and possibly wrong) leftover count (#496 review round 4).
  const count = entries.length + overflowCount
  const showBadge = !error && count > 0

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        // "unread" would imply persisted read state, which this lite inbox
        // deliberately doesn't have (#496: "No persistence, no read/unread").
        aria-label={
          error
            ? 'Notifications, could not check for updates'
            : count > 0
              ? `Notifications, ${count} item${count === 1 ? '' : 's'}`
              : 'Notifications'
        }
        aria-expanded={open}
        aria-controls="notification-bell-dropdown"
        data-testid="notification-bell"
        className="relative w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <Bell size={22} className="text-[var(--color-primary)]" weight={showBadge ? 'fill' : 'regular'} />
        {error ? (
          <span
            aria-hidden="true"
            data-testid="notification-badge-error"
            className="absolute -top-1 -right-1 w-[10px] h-[10px] rounded-full"
            style={{ background: 'var(--color-muted)', border: '1px solid var(--color-surface)' }}
          />
        ) : (
          showBadge && (
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
          )
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id="notification-bell-dropdown"
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
            // Plain list semantics, not an ARIA menu (#496 round 2). A
            // role is still required for `aria-labelledby` to attach —
            // without one, a bare <div> isn't a labellable element and
            // assistive tech announces the popover as anonymous content
            // (#496 round 3). `role="region"` fits: a labelled section of
            // the page, not a modal/menu widget with its own focus/keyboard
            // contract.
            role="region"
            aria-labelledby="notification-bell-heading"
          >
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <p id="notification-bell-heading" className="text-sm font-bold text-[var(--color-text)]">
                Notifications
              </p>
            </div>

            <div className="max-h-[340px] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                  Loading…
                </div>
              ) : error ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    Couldn&apos;t check right now
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Something went wrong loading your notifications. Try again in a moment.
                  </p>
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
                    <InboxRow
                      key={entry.id}
                      entry={entry}
                      onNavigate={() => setOpen(false)}
                      onDismissTimer={dismissTimer}
                    />
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

function InboxRow({
  entry,
  onNavigate,
  onDismissTimer,
}: {
  entry: InboxEntry
  onNavigate: () => void
  /** `useCookingTimers().dismiss` — only called for `kind: 'timer'` rows. */
  onDismissTimer: (id: string) => void
}) {
  const style = TIER_STYLE[entry.tier]

  const icon = (
    <span
      aria-hidden="true"
      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
      style={{ background: style.bg, color: style.text }}
    >
      {entry.emoji}
    </span>
  )

  if (!entry.href) {
    // Issue #496's tap-target table: "timer → dismiss" — a real button, not
    // a static row. `timerId` is only absent if a non-timer entry somehow
    // ships with `href: null`, which nothing in `inbox-helpers.ts` does
    // today; guarded rather than asserted so a future no-href, no-dismiss
    // kind doesn't crash here.
    return (
      <li>
        <button
          type="button"
          onClick={() => entry.timerId && onDismissTimer(entry.timerId)}
          disabled={!entry.timerId}
          aria-label={`Dismiss: ${entry.copy}`}
          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[var(--color-bg)] transition-colors min-h-[44px]"
        >
          {icon}
          <span className="flex-1 text-sm text-[var(--color-text)]">{entry.copy}</span>
          <span className="text-xs font-semibold text-[var(--color-muted)] flex-shrink-0">Dismiss</span>
        </button>
      </li>
    )
  }

  return (
    <li>
      <Link href={entry.href} onClick={onNavigate} className="block min-h-[44px]">
        <div className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[var(--color-bg)] transition-colors">
          {icon}
          <span className="flex-1 text-sm text-[var(--color-text)]">{entry.copy}</span>
        </div>
      </Link>
    </li>
  )
}
