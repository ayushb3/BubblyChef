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
 * Completion feedback is visual-first (a badge turns urgent and pulses) —
 * sound/vibration are best-effort additions, never the only signal, so a
 * muted phone or a browser that blocks audio autoplay still surfaces a
 * finished timer.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCookingTimers, type CookingTimer } from '@/lib/useCookingTimers'
import { formatDuration } from '@/lib/timers'
import { useMotionConfig } from '@/lib/motion'

/** Best-effort completion beep — a short two-tone chime via WebAudio. Never
 * throws: browsers that block audio without a user gesture, or don't
 * support WebAudio at all, just get no sound (the dock badge still shows).
 */
function playCompletionChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.16
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.2)
    })
    setTimeout(() => void ctx.close(), 500)
  } catch {
    // Best effort only.
  }
}

function vibrateOnComplete() {
  try {
    navigator.vibrate?.([120, 60, 120])
  } catch {
    // Best effort only.
  }
}

function TimerBadge({ timer, expanded }: { timer: CookingTimer; expanded: boolean }) {
  const { pause, resume, dismiss } = useCookingTimers()
  const { reduced } = useMotionConfig()
  const isCompleted = timer.status === 'completed'
  const isPaused = timer.status === 'paused'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={
        isCompleted && !reduced
          ? { opacity: 1, y: 0, scale: [1, 1.05, 1] }
          : { opacity: 1, y: 0, scale: 1 }
      }
      exit={{ opacity: 0, scale: 0.9 }}
      transition={
        isCompleted && !reduced
          ? { repeat: Infinity, duration: 1.1, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 500, damping: 30 }
      }
      className="flex items-center gap-2 rounded-full px-3 py-2 min-w-0"
      style={{
        background: isCompleted ? 'var(--color-coral)' : 'var(--color-surface)',
        border: `1.5px solid ${isCompleted ? 'var(--color-coral)' : 'var(--color-border)'}`,
        boxShadow: 'var(--shadow-soft)',
      }}
      role="status"
      aria-label={
        isCompleted
          ? `${timer.label} timer finished`
          : `${timer.label} timer, ${formatDuration(timer.remainingSeconds)} remaining${isPaused ? ', paused' : ''}`
      }
      data-testid={`timer-badge-${timer.id}`}
      data-status={timer.status}
    >
      <span aria-hidden="true" className="text-sm">
        {isCompleted ? '⏰' : isPaused ? '⏸️' : '⏱️'}
      </span>
      {expanded && (
        <span
          className="text-xs font-bold truncate max-w-[90px]"
          style={{ color: isCompleted ? '#fff' : 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
        >
          {timer.label}
        </span>
      )}
      <span
        className="text-xs font-extrabold tabular-nums"
        style={{ color: isCompleted ? '#fff' : 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
      >
        {isCompleted ? 'Done!' : formatDuration(timer.remainingSeconds)}
      </span>
      {expanded && !isCompleted && (
        <button
          type="button"
          onClick={() => (isPaused ? resume(timer.id) : pause(timer.id))}
          aria-label={isPaused ? `Resume ${timer.label} timer` : `Pause ${timer.label} timer`}
          className="text-xs font-bold active:scale-95 transition-transform"
          style={{ color: 'var(--color-primary-dark)' }}
        >
          {isPaused ? '▶' : '⏸'}
        </button>
      )}
      {expanded && (
        <button
          type="button"
          onClick={() => dismiss(timer.id)}
          aria-label={`Dismiss ${timer.label} timer`}
          className="text-xs font-bold active:scale-95 transition-transform"
          style={{ color: isCompleted ? '#fff' : 'var(--color-muted)' }}
        >
          ✕
        </button>
      )}
    </motion.div>
  )
}

export default function TimerDock() {
  const { timers } = useCookingTimers()
  const [expanded, setExpanded] = useState(false)
  const announcedRef = useRef<Set<string>>(new Set())

  // Best-effort completion feedback — fires once per timer, driven by the
  // dock's own view of `timers` rather than the store (keeps the store free
  // of side effects and easy to unit test in isolation).
  useEffect(() => {
    for (const t of timers) {
      if (t.status === 'completed' && !announcedRef.current.has(t.id)) {
        announcedRef.current.add(t.id)
        playCompletionChime()
        vibrateOnComplete()
      }
    }
  }, [timers])

  if (timers.length === 0) return null

  return (
    <div
      className="fixed left-0 right-0 z-40 flex justify-center px-3 pointer-events-none"
      style={{ bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
      data-testid="timer-dock"
    >
      <motion.div
        layout
        className="pointer-events-auto flex items-center gap-2 rounded-full px-2 py-2 max-w-full overflow-x-auto"
        style={{
          background: 'color-mix(in srgb, var(--color-surface) 92%, transparent)',
          backdropFilter: 'blur(6px)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse timers' : 'Expand timers'}
          className="flex-shrink-0 text-sm active:scale-95 transition-transform"
        >
          {expanded ? '▾' : '▸'}
        </button>
        <AnimatePresence initial={false}>
          {timers.map((t) => (
            <TimerBadge key={t.id} timer={t} expanded={expanded} />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
