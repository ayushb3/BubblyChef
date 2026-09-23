'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import SpringButton from '@/components/ui/SpringButton'
import { TOUR_STEPS } from './steps'
import { useTour } from './TourProvider'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'

const PAD = 8
const RADIUS = 16
const TOOLTIP_WIDTH = 288

/**
 * Steps whose target is position:fixed and always visible — skip scrollIntoView
 * for these so the rect read is not stale after a scroll attempt.
 */
const FIXED_TARGET_IDS = new Set(['nav-pantry', 'nav-recipes', 'nav-chat', 'profile'])

interface SpotRect {
  x: number
  y: number
  width: number
  height: number
}

function emptyRect(): SpotRect {
  return { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * Measures the target element for a step, padding by PAD px.
 * Returns null if the element isn't in the DOM.
 * Skips scrollIntoView for fixed-position targets (bottom-nav, profile header).
 */
function measureTarget(selector: string, stepId: string, scroll = true): SpotRect | null {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return null
  if (scroll && !FIXED_TARGET_IDS.has(stepId)) {
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
  const r = el.getBoundingClientRect()
  return {
    x: r.left - PAD,
    y: r.top - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  }
}

function sameRect(a: SpotRect, b: SpotRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * How often the open tour re-reads its target's position. The home screen
 * settles after the tour opens: FadeInView slides content in and the hero
 * bubble grows from its loading skeleton to the real message once pantry data
 * lands. Nothing fires resize/scroll for that, so a one-off measure leaves the
 * spotlight on a stale box. One getBoundingClientRect per tick is cheap, and
 * state only changes when the box actually moved.
 */
const SETTLE_POLL_MS = 250

/** How long a step waits for its target to appear before auto-skipping it. */
export const TARGET_WAIT_MS = 1500
const TARGET_POLL_MS = 100

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

export function TourOverlay() {
  const { isOpen: tourOpen, stepIndex, goNext, goBack, closeTour, totalSteps } = useTour()
  // Every step targets the home screen. "Take the tour" on /profile opens the
  // tour and then navigates to '/'; if the overlay ran while still on
  // /profile, it would find no hero/quick-actions and auto-skip them, so the
  // replay started at step 3. It only shows (and measures, and skips) on '/'.
  const pathname = usePathname()
  const isOpen = tourOpen && pathname === '/'
  const step = TOUR_STEPS[stepIndex]
  const isLast = stepIndex === totalSteps - 1

  const [rect, setRect] = useState<SpotRect>(emptyRect())
  const [vp, setVp] = useState({ w: 0, h: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const prefersReduced = useReducedMotion()

  // Track which stepIndex we have already attempted auto-skip for, to prevent
  // a transient missing target from firing goNext() more than once per step.
  const skippedStepRef = useRef<number | null>(null)

  // --- (a) Initial measure-for-step — MAY auto-skip, but at most once per stepIndex ---
  // A target missing on the first frame is not proof the step is gone: arriving
  // on '/' via "Take the tour" shows app/loading.tsx before the home screen, so
  // the hero isn't in the DOM yet. Keep looking for TARGET_WAIT_MS before
  // treating the target as absent and skipping the step.
  useEffect(() => {
    if (!isOpen || !step) return
    const started = performance.now()
    let rafId = 0
    let timeoutId: number | undefined
    const tick = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight })
      const r = measureTarget(step.selector, step.id)
      if (r) {
        setRect(r)
        return
      }
      if (performance.now() - started < TARGET_WAIT_MS) {
        timeoutId = window.setTimeout(() => {
          rafId = requestAnimationFrame(tick)
        }, TARGET_POLL_MS)
        return
      }
      // Guard: only skip once per stepIndex to prevent re-entrancy loops.
      if (skippedStepRef.current === stepIndex) return
      skippedStepRef.current = stepIndex
      if (stepIndex < totalSteps - 1) {
        void goNext()
      } else {
        void closeTour()
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
      window.clearTimeout(timeoutId)
    }
  }, [isOpen, stepIndex, step, totalSteps, goNext, closeTour])

  // --- (b) Re-measure on resize/scroll — ONLY updates the existing rect, never skips ---
  const remeasureOnly = useCallback(() => {
    if (!step) return
    requestAnimationFrame(() => {
      setVp({ w: window.innerWidth, h: window.innerHeight })
      const r = measureTarget(step.selector, step.id)
      if (r) setRect(r)
      // Missing target on resize/scroll is transient (e.g. in-progress animation);
      // do NOT auto-skip here — the step-change effect handles the authoritative skip.
    })
  }, [step])

  // --- (c) Follow layout shifts while open — no scrolling, never skips ---
  useEffect(() => {
    if (!isOpen || !step) return
    const id = window.setInterval(() => {
      const r = measureTarget(step.selector, step.id, false)
      if (r) setRect((prev) => (sameRect(prev, r) ? prev : r))
      setVp((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev
          : { w: window.innerWidth, h: window.innerHeight },
      )
    }, SETTLE_POLL_MS)
    return () => window.clearInterval(id)
  }, [isOpen, step])

  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('resize', remeasureOnly, { passive: true })
    window.addEventListener('scroll', remeasureOnly, { passive: true, capture: true })
    return () => {
      window.removeEventListener('resize', remeasureOnly)
      window.removeEventListener('scroll', remeasureOnly, { capture: true } as EventListenerOptions)
    }
  }, [isOpen, remeasureOnly])

  // Reset the auto-skip guard when the tour closes, so a re-opened tour (e.g.
  // via the profile "Take the tour" button) can auto-skip a missing target at a
  // stepIndex that was already skipped in a prior run instead of freezing on it.
  useEffect(() => {
    if (!isOpen) skippedStepRef.current = null
  }, [isOpen])

  // Keyboard / focus trap — Esc = Skip.
  useModalFocusTrap(isOpen, closeTour, tooltipRef as React.RefObject<HTMLElement | null>)

  // Tooltip vertical position: above or below the spotlight. 'above' anchors
  // the tooltip's bottom edge to the spotlight's top via `bottom` rather than a
  // translateY(-100%): the tooltip is a motion.div animating `y`, and framer
  // motion owns `transform`, so a transform in `style` gets overwritten and the
  // tooltip drops below the bottom nav, off-screen.
  const tooltipVertical =
    step?.placement === 'above'
      ? { bottom: Math.max(vp.h - rect.y + 8, 8) }
      : { top: rect.y + rect.height + 8 }

  // Horizontal centre — clamp inside viewport.
  const tooltipLeft = Math.min(
    Math.max((vp.w - TOOLTIP_WIDTH) / 2, 8),
    vp.w - TOOLTIP_WIDTH - 8,
  )

  const tooltipVariants = {
    hidden: { opacity: 0, y: prefersReduced ? 0 : (step?.placement === 'above' ? 8 : -8) },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: prefersReduced ? 0 : (step?.placement === 'above' ? 8 : -8) },
  }

  const maskId = 'tour-spotlight-mask'

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/*
           * Full-viewport pointer-events-capturing backdrop (z-[60]).
           * Sits above BottomNav (z-50) and swallows ALL clicks including
           * those on the spotlight cutout — the cutout is visual only.
           * This prevents the user from accidentally navigating away
           * by tapping dimmed bottom-nav tabs or other interactive elements.
           */}
          <div
            className="fixed inset-0 z-[60]"
            aria-hidden="true"
            onClick={(e) => e.stopPropagation()}
          />

          {/* SVG dim overlay with spotlight cutout (pointer-events-none; backdrop above captures) */}
          <svg
            className="fixed inset-0 z-[61] pointer-events-none"
            width={vp.w || '100%'}
            height={vp.h || '100%'}
            aria-hidden="true"
          >
            <defs>
              <mask id={maskId}>
                {/* White = show dim; black = transparent (the spotlight hole) */}
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  rx={RADIUS}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="black"
              opacity={0.55}
              mask={`url(#${maskId})`}
            />
          </svg>

          {/* Spotlight border ring (decorative) */}
          <svg
            className="fixed inset-0 z-[62] pointer-events-none"
            width={vp.w || '100%'}
            height={vp.h || '100%'}
            aria-hidden="true"
          >
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={RADIUS}
              fill="none"
              stroke="white"
              strokeWidth={2}
              strokeOpacity={0.5}
            />
          </svg>

          {/* Tooltip — z-[63] so it is above backdrop + dim overlay */}
          <motion.div
            ref={tooltipRef}
            key={`tour-tooltip-${stepIndex}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Onboarding tour step ${stepIndex + 1} of ${totalSteps}`}
            className="fixed z-[63]"
            style={{
              ...tooltipVertical,
              left: tooltipLeft,
              width: TOOLTIP_WIDTH,
            }}
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={tooltipVariants}
            transition={{ duration: prefersReduced ? 0 : 0.2 }}
          >
            <div
              className="rounded-2xl p-4 shadow-xl border border-white/20"
              style={{ background: 'var(--color-surface)' }}
            >
              {/* Step copy */}
              <p className="text-sm font-medium text-[var(--color-text)] leading-snug mb-3">
                {step?.copy}
              </p>

              {/* Step dots */}
              <div className="flex items-center gap-1.5 mb-3" aria-hidden="true">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <span
                    key={i}
                    className="rounded-full transition-all duration-200"
                    style={{
                      width: i === stepIndex ? 16 : 6,
                      height: 6,
                      background:
                        i === stepIndex
                          ? 'var(--color-primary)'
                          : 'var(--color-border)',
                    }}
                  />
                ))}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                {stepIndex > 0 && (
                  <SpringButton
                    onClick={goBack}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] bg-transparent"
                  >
                    Back
                  </SpringButton>
                )}
                <div className="flex-1" />
                <SpringButton
                  onClick={() => void closeTour()}
                  className="text-xs font-medium text-[var(--color-muted)] bg-transparent px-2 py-1.5"
                >
                  Skip
                </SpringButton>
                <SpringButton
                  onClick={() => void goNext()}
                  className="text-xs font-semibold px-4 py-1.5 rounded-full text-white"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {isLast ? 'Done' : 'Next'}
                </SpringButton>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
