'use client'

/**
 * Issue #495 — Spec B.3 cooking-session timer dock.
 *
 * A floating bar above the bottom nav, visible on every route while at
 * least one timer is running or freshly completed. Stacks each timer as a
 * badge with remaining time, pause/resume and dismiss; tapping a badge
 * expands the stack. Mounted once at the layout level (`app/layout.tsx`)
 * so it survives route changes (`/pantry`, `/chat`, ...) the same way the
 * timer store itself does.
 *
 * Completion feedback: a badge turns urgent and pulses, a screen-reader
 * announcement, and vibration where the browser supports it. Sound is OFF by
 * default (the signature PRD's "no sound in v1", issue #783). Only when the
 * user turns on "Timer sound" in Profile (issue #848, `lib/timer-alerts.ts`)
 * does a finish also play a short WebAudio chime, repeated up to 3 times until
 * the timer is dismissed, and show a system Notification if the browser
 * granted permission (asked for when the toggle is turned on, never here).
 *
 * The dock reserves its own space (issue #848): it publishes its height as the
 * `--timer-dock-h` CSS variable on the document root, which the root layout's
 * `<main>` (and the chat surface) add to their bottom padding, so a timer never
 * covers the chat input, a confirmation or Start cooking.
 *
 * A chip links back to the cook it belongs to (`lib/timer-cook-link.ts`).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { getActiveCookSession, type ActiveCookSession } from '@/lib/cook-session'
import { getActiveMealCookSession, type MealCookSession } from '@/lib/meal-cook-session'
import { subscribeCookSessionChanges } from '@/lib/cook-session-signal'
import { timerCookHref } from '@/lib/timer-cook-link'
import { isTimerSoundEnabled, notifyTimerDone, startChime } from '@/lib/timer-alerts'
import {
  useCookingTimers,
  TIMER_STARTED_EVENT,
  TIMER_COMPLETED_EVENT,
  type CookingTimer,
} from '@/lib/useCookingTimers'
import { formatDuration } from '@/lib/timers'
import { useMotionConfig } from '@/lib/motion'
import { HATCHED } from '@/components/meal/dish-style'
import { useTimerDockRaised } from './TimerDockLayer'

/** Best-effort haptic nudge; a no-op where `navigator.vibrate` is unsupported. */
function vibrateOnComplete() {
  try {
    navigator.vibrate?.([120, 60, 120])
  } catch {
    // Best effort only.
  }
}

/** Every tappable control inside the dock: never shrinks, never wraps its
 * text (issue #664 — "+2 min" used to break onto two lines) and meets the
 * 44px touch target. */
const CONTROL_BASE =
  'group flex-shrink-0 whitespace-nowrap min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-1 text-xs font-bold text-[color:var(--color-text)] rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1'

/** Issue #745 (signature): a dock control reads as a small keycap — ink edge,
 * 2px key shadow, sinks on press — inside its 44px hit area. */
const KEY_FACE =
  'inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] px-2.5 shadow-[0_2px_0_var(--color-text)] transition-transform duration-[60ms] group-active:translate-y-[1px] group-active:shadow-[0_1px_0_var(--color-text)] motion-reduce:transition-none motion-reduce:group-active:translate-y-0 motion-reduce:group-active:brightness-90'

function TimerBadge({
  timer,
  expanded,
  href,
}: {
  timer: CookingTimer
  expanded: boolean
  /** The cook this timer belongs to, or null when it has none. */
  href: string | null
}) {
  const { pause, resume, dismiss, extend } = useCookingTimers()
  const { reduced } = useMotionConfig()
  const isCompleted = timer.status === 'completed'
  const isPaused = timer.status === 'paused'

  const badgeFace = (
    <>
      <span aria-hidden="true" className="flex-shrink-0 text-sm">
        {isCompleted ? '⏰' : isPaused ? '⏸️' : '⏱️'}
      </span>
      {/* Issue #802 — a finished chip keeps its label ("Rice · done") in the
          collapsed row too, so two finished timers can be told apart. A running
          or paused chip shows the countdown instead and names itself only in
          the expanded stack. */}
      {(expanded || isCompleted) && (
        <span
          className={`min-w-0 truncate text-xs font-bold ${expanded ? 'flex-1' : 'max-w-[10rem]'}`}
        >
          {isCompleted ? `${timer.label} · done` : timer.label}
        </span>
      )}
      {!isCompleted && (
        <span className="flex-shrink-0 whitespace-nowrap text-xs font-extrabold tabular-nums">
          {formatDuration(timer.remainingSeconds)}
        </span>
      )}
    </>
  )

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={
        isCompleted && !reduced
          ? { opacity: 1, y: 0, scale: [1, expanded ? 1.02 : 1.05, 1] }
          : { opacity: 1, y: 0, scale: 1 }
      }
      exit={{ opacity: 0, scale: 0.9 }}
      transition={
        isCompleted && !reduced
          ? {
              // Only the pulse repeats. A bare `repeat: Infinity` also applied
              // to the `layout` animation, so expanding the dock with finished
              // chips made them swing sideways forever (issue #802 verify).
              layout: { type: 'spring', stiffness: 500, damping: 30 },
              default: { repeat: Infinity, duration: 1.1, ease: 'easeInOut' },
            }
          : { type: 'spring', stiffness: 500, damping: 30 }
      }
      // Issue #757 — a finished chip clears when tapped (the other way it
      // goes is the cook moving past the step that owns it). Running and
      // paused chips are not tappable: they have their own controls.
      onClick={isCompleted ? () => dismiss(timer.id) : undefined}
      // Collapsed: a compact pill in the dock's single scrolling row, which
      // must not shrink (issue #664). Expanded: one full-width row per timer.
      // Issue #745 — the timeline's language: a running timer is "just
      // cooking" (surface, ink edge), a paused one is hatched with a dashed
      // edge, and a finished one is solid primary (it needs you now).
      className={`${
        expanded
          ? 'flex items-center gap-2 rounded-full pl-3 pr-1 py-1 w-full min-w-0'
          : 'flex flex-shrink-0 items-center gap-2 rounded-full px-3 py-2'
      } text-[color:var(--color-text)] ${
        isCompleted
          ? 'border-2 border-solid border-[color:var(--color-text)] bg-[var(--color-primary)] shadow-[0_2px_0_var(--color-text)]'
          : isPaused
            ? HATCHED
            : 'border-2 border-solid border-[color:var(--color-text)] bg-[var(--color-surface)] shadow-[0_2px_0_var(--color-text)]'
      }`}
      // Not `role="status"` / a live region: the countdown text inside
      // changes every second, and a live region announces every change —
      // one polite screen-reader interruption per timer per second, on
      // every route. Meaningful events (a timer starting, a timer
      // finishing) are announced instead through the dedicated live region
      // below, driven by `TIMER_STARTED_EVENT` / `TIMER_COMPLETED_EVENT`
      // rather than the ticking render.
      role="group"
      aria-label={
        isCompleted
          ? `${timer.label} timer finished`
          : `${timer.label} timer, ${formatDuration(timer.remainingSeconds)} remaining${isPaused ? ', paused' : ''}`
      }
      data-testid={`timer-badge-${timer.id}`}
      data-status={timer.status}
    >
      {/* Issue #848 — the chip's face (icon, label, countdown) leads back to the
          cook it belongs to; the controls beside it keep their own taps. A
          finished chip still clears itself when tapped (#757), and a link also
          clears it on the way, so it does not sit there after you return. */}
      {href ? (
        <Link
          href={href}
          onClick={isCompleted ? () => dismiss(timer.id) : undefined}
          aria-label={`${timer.label}: back to cooking`}
          data-testid={`timer-link-${timer.id}`}
          className="flex min-h-[32px] min-w-0 flex-shrink-0 items-center gap-2 rounded-full text-[color:var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          {badgeFace}
        </Link>
      ) : (
        badgeFace
      )}
      {expanded && !isCompleted && (
        <button
          type="button"
          onClick={() => (isPaused ? resume(timer.id) : pause(timer.id))}
          aria-label={isPaused ? `Resume ${timer.label} timer` : `Pause ${timer.label} timer`}
          className={CONTROL_BASE}
        >
          <span className={KEY_FACE}>{isPaused ? '▶' : '⏸'}</span>
        </button>
      )}
      {expanded && !isCompleted && (
        <button
          type="button"
          onClick={() => extend?.(timer.id, 120)}
          aria-label={`Add 2 minutes to ${timer.label} timer`}
          className={CONTROL_BASE}
          data-testid={`timer-extend-${timer.id}`}
        >
          <span className={KEY_FACE}>+2 min</span>
        </button>
      )}
      {expanded && (
        <button
          type="button"
          onClick={() => dismiss(timer.id)}
          aria-label={`Dismiss ${timer.label} timer`}
          className={CONTROL_BASE}
        >
          <span className={KEY_FACE}>✕</span>
        </button>
      )}
    </motion.div>
  )
}

/** Minimum time (ms) the live region sits cleared before the real message
 * lands. PR #620 review finding: setting the *same* announcement text twice
 * in a row (e.g. two "Prep timer started", since the quick-set's labels are
 * fixed) is a React no-op — the DOM node's text never actually changes, so a
 * screen reader has nothing to notice. Clearing first, then setting the real
 * text on a following tick, forces a real mutation every time regardless of
 * whether the new message happens to match the last one. */
const ANNOUNCE_RESET_DELAY_MS = 50

export default function TimerDock() {
  const { timers } = useCookingTimers()
  const [expanded, setExpanded] = useState(false)
  // Issue #657: a full-screen layer (guided cook) can hold the dock raised
  // above itself. Default (no holder) is the normal z-40 above the nav.
  const raised = useTimerDockRaised()
  // What the visually-hidden live region below currently says. Only ever
  // set from `announce()` below (via the `TIMER_STARTED_EVENT` /
  // `TIMER_COMPLETED_EVENT` listeners) — never from the per-tick `timers`
  // update — so a screen reader hears "X timer started" and "X timer
  // finished" and nothing in between.
  const [announcement, setAnnouncement] = useState('')
  // The cook sessions on record, for the chips' links back to a cook.
  const [sessions, setSessions] = useState<{
    meal: MealCookSession | null
    recipe: ActiveCookSession | null
  }>({ meal: null, recipe: null })
  // The chime still repeating for each finished timer, to stop when it is dismissed.
  const chimes = useRef(new Map<string, () => void>())
  const dockRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const read = () => setSessions({ meal: getActiveMealCookSession(), recipe: getActiveCookSession() })
    read()
    return subscribeCookSessionChanges(read)
  }, [])

  // A chime runs until its timer is dismissed (or it has played 3 times).
  useEffect(() => {
    for (const [id, stop] of chimes.current) {
      if (!timers.some((t) => t.id === id)) {
        stop()
        chimes.current.delete(id)
      }
    }
  }, [timers])
  useEffect(() => {
    const active = chimes.current
    return () => {
      for (const stop of active.values()) stop()
      active.clear()
    }
  }, [])

  // The dock reserves its own space (issue #848): its height goes out as
  // `--timer-dock-h` for the root layout and chat to pad their bottoms by. While
  // the stack is expanded the last collapsed height stays (the stack floats over
  // content for the moment you manage timers rather than shrinking the page).
  // 12px = the 8px between the nav's top (80px) and the dock's bottom (88px),
  // plus its 3px hard shadow and a pixel of air.
  const hasTimers = timers.length > 0
  useLayoutEffect(() => {
    const root = document.documentElement
    const el = dockRef.current
    if (!hasTimers || !el) {
      root.style.setProperty('--timer-dock-h', '0px')
      return
    }
    const publish = () => {
      if (expanded) return
      root.style.setProperty('--timer-dock-h', `${(el.offsetHeight || 64) + 12}px`)
    }
    publish()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [hasTimers, expanded])
  useEffect(() => {
    return () => document.documentElement.style.setProperty('--timer-dock-h', '0px')
  }, [])

  // Completion feedback (vibration, the live-region announcement) is
  // driven by the store's own `TIMER_COMPLETED_EVENT` rather than by
  // watching `timers` for a `status === 'completed'` transition. The event
  // is the store's single source of truth for "this timer just completed,
  // exactly once, ever" (including across a reload); re-deriving that here
  // from `timers` would need its own persisted fired-flag to avoid the same
  // replay-on-reload bug the store itself had to fix.
  useEffect(() => {
    let resetTimeout: ReturnType<typeof setTimeout> | null = null

    function announce(text: string) {
      if (resetTimeout !== null) clearTimeout(resetTimeout)
      setAnnouncement('')
      resetTimeout = setTimeout(() => setAnnouncement(text), ANNOUNCE_RESET_DELAY_MS)
    }
    function handleStarted(event: Event) {
      const { label } = (event as CustomEvent<{ id: string; label: string }>).detail
      announce(`${label} timer started`)
    }
    function handleCompleted(event: Event) {
      const { id, label } = (event as CustomEvent<{ id: string; label: string }>).detail
      announce(`${label} timer finished`)
      vibrateOnComplete()
      // Opt-in only (Profile > Timer sound): off, nothing below runs, no audio
      // context is ever created and no notification is shown.
      if (isTimerSoundEnabled()) {
        notifyTimerDone(label)
        chimes.current.get(id)?.()
        chimes.current.set(id, startChime())
      }
    }
    window.addEventListener(TIMER_STARTED_EVENT, handleStarted)
    window.addEventListener(TIMER_COMPLETED_EVENT, handleCompleted)
    return () => {
      window.removeEventListener(TIMER_STARTED_EVENT, handleStarted)
      window.removeEventListener(TIMER_COMPLETED_EVENT, handleCompleted)
      if (resetTimeout !== null) clearTimeout(resetTimeout)
    }
  }, [])

  return (
    <>
      {/* The only live region in the dock — announces starts and
          completions, never the ticking countdown. Visually hidden;
          screen-reader-only. Rendered unconditionally, including while the
          dock has no timers: a live region must already exist, empty and
          idle, in the DOM *before* its first real message — inserting it
          already populated (e.g. only once `timers.length > 0`) means a
          screen reader never sees the "mutation" that makes it announce. */}
      <div aria-live="polite" role="status" data-testid="timer-live-region" className="sr-only">
        {announcement}
      </div>
      {timers.length > 0 && (
        <div
          ref={dockRef}
          className={`fixed left-0 right-0 ${raised ? 'z-[9991]' : 'z-40'} flex flex-col items-center gap-2 px-3 pointer-events-none`}
          // Raised: clears guided cook's ~76px Back/Next footer (no bottom nav
          // there). z-[9991] sits above the guided root (9990) and below
          // BubblePop (9999). Otherwise it sits above the bottom nav: 88px =
          // the nav's 79px (3px border + 8px top pad + 56px key + 12px bottom
          // pad), the dock's 3px hard shadow, and a 6px gap — issue #802: at
          // 64px the nav covered the dock's bottom edge and clipped its shadow.
          style={{
            bottom: `calc(${raised ? 96 : 88}px + env(safe-area-inset-bottom, 0px))`,
          }}
          data-testid="timer-dock"
          data-raised={raised ? 'true' : 'false'}
        >
          <motion.div
            layout
            className={
              expanded
                ? 'pointer-events-auto flex flex-col items-stretch gap-2 rounded-3xl p-2 w-full max-w-md max-h-[50vh] overflow-y-auto'
                : 'pointer-events-auto flex items-center gap-2 rounded-full px-2 py-2 max-w-full overflow-x-auto'
            }
            data-testid="timer-dock-list"
            data-layout={expanded ? 'stack' : 'row'}
            // Issue #745 — a pixel-framed bar: ink edge and the hard offset
            // shadow in the theme's primary-dark.
            style={{
              background: 'var(--color-bg)',
              border: '2px solid var(--color-text)',
              boxShadow: '3px 3px 0 var(--color-primary-dark)',
            }}
          >
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse timers' : 'Expand timers'}
              className={`group flex-shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-sm text-[color:var(--color-text)] rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${expanded ? 'self-start' : ''}`}
            >
              <span className={KEY_FACE}>{expanded ? '▾' : '▸'}</span>
            </button>
            <AnimatePresence initial={false}>
              {timers.map((t) => (
                <TimerBadge
                  key={t.id}
                  timer={t}
                  expanded={expanded}
                  href={timerCookHref(t.id, sessions.meal, sessions.recipe)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </>
  )
}
