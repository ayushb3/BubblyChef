'use client'

/**
 * PixelSheet: the one bottom sheet (signature component #1, issue #742).
 *
 * Owns everything a sheet used to hand-roll: the scrim (`--color-backdrop`),
 * the focus trap (`useModalFocusTrap`: focus in on open, Tab cycles inside,
 * Escape closes, focus back to the opener), closing on a scrim tap, body scroll
 * lock with the sheet's own body scrolling, the grab handle with
 * drag-to-dismiss, a title row and a round 44 px close button.
 *
 * Drawn to the Signature "Panel" board (sheet anatomy, sheet over a dimmed
 * scene): a theme-background sheet, 24 px rounded top with a 3 px ink edge.
 * Colours are theme variables only.
 *
 * Motion (board note): springs up (stiffness 380, damping 34, about 280 ms),
 * scrim fades in 200 ms. Reduced motion: sheet and scrim fade in 150 ms, no
 * slide. Drag the handle down past 30% of the sheet, or flick, to close; it
 * springs back if let go early.
 *
 * Contract for `frontend`:
 *  - `open` / `onClose`: controlled. `onClose` is what Escape, a scrim tap,
 *    the close button and a drag-dismiss all call, so a caller that must guard
 *    closing (a request in flight) guards it once, there.
 *  - `title` (+ optional `subtitle`, `icon`): the header row. `titleId` keeps a
 *    caller's existing heading id; the dialog is labelled by the title, unless
 *    `ariaLabel` gives it a fuller accessible name.
 *  - `closeLabel` (default "Close"), `closeDisabled`: the built-in close button.
 *  - `subheader`: fixed content under the title row (tabs, search).
 *  - `children`: the scrolling body. `footer`: fixed content under it (the
 *    action row).
 *  - `initialFocus`: CSS selector of the element to focus on open instead of
 *    the first focusable (the close button).
 *  - `testId` / `backdropTestId`: on the dialog and on the scrim container.
 *
 * Mounts-to-open callers pass `open` as a constant `true`.
 *
 *  - `layer`: stacking layer. `'sheet'` (default, z 60) for page sheets;
 *    `'cook'` (z 9998) for a sheet opened over the full-screen cook surface.
 *
 * `PixelModalLayer` (issue #743) is the sheet's backdrop and focus handling
 * on its own: the fixed layer, the optional scrim, the trap, Escape, scrim-tap
 * and scroll lock, with the caller drawing the panel. PixelSheet is built on
 * it; the onboarding tour uses it directly because its panel is a positioned
 * tooltip beside a spotlight cut-out, not a bottom sheet.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'
import { useMotionConfig } from '@/lib/motion'
import { PIXEL_INK } from './PixelPanel'

export interface PixelSheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  titleId?: string
  /** Overrides the dialog's accessible name (default: labelled by the title). */
  ariaLabel?: string
  subtitle?: ReactNode
  /** Pixel thumbnail for the title row (the only pixel art in it). */
  icon?: ReactNode
  closeLabel?: string
  closeDisabled?: boolean
  subheader?: ReactNode
  footer?: ReactNode
  initialFocus?: string
  /** Stacking layer: `'cook'` sits above the full-screen cook surface. */
  layer?: PixelLayer
  testId?: string
  backdropTestId?: string
  children?: ReactNode
}

export type PixelLayer = 'sheet' | 'cook'

// Literal class names so Tailwind sees them.
const LAYER_CLASS: Record<PixelLayer, string> = {
  sheet: 'z-[60]',
  cook: 'z-[9998]',
}

// Board motion note: stiffness 380, damping 34, about 280 ms.
const SHEET_SPRING = { type: 'spring', stiffness: 380, damping: 34 } as const
const FADE = { duration: 0.15 } as const

// Drag-to-dismiss thresholds: past 30% of the sheet, or a flick (px per ms).
const DRAG_CLOSE_RATIO = 0.3
const FLICK_VELOCITY = 0.5

// Scroll lock is reference counted so stacked sheets (one opening from
// another) don't release the page while one is still up.
let scrollLocks = 0
let scrollBefore = ''
function lockScroll() {
  if (scrollLocks++ === 0) {
    scrollBefore = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}
function unlockScroll() {
  if (--scrollLocks === 0) document.body.style.overflow = scrollBefore
}

export interface PixelModalLayerProps {
  open: boolean
  onClose: () => void
  /** The element the focus trap wraps (the sheet panel, the tour tooltip). */
  panelRef: RefObject<HTMLElement | null>
  /** Draw the `--color-backdrop` scrim. The tour draws its own cut-out dim. */
  scrim?: boolean
  /** A tap on the layer itself (outside the panel) closes. Off: it is swallowed. */
  dismissOnScrimTap?: boolean
  /** Lock page scroll while open. */
  lockPageScroll?: boolean
  /** Bottom-align the children (a sheet). Off: children position themselves. */
  alignEnd?: boolean
  layer?: PixelLayer
  testId?: string
  children?: ReactNode
}

export function PixelModalLayer({
  open,
  onClose,
  panelRef,
  scrim = true,
  dismissOnScrimTap = true,
  lockPageScroll = true,
  alignEnd = true,
  layer = 'sheet',
  testId,
  children,
}: PixelModalLayerProps) {
  const { reduced } = useMotionConfig()

  useModalFocusTrap(open, onClose, panelRef)

  useEffect(() => {
    if (!open || !lockPageScroll) return
    lockScroll()
    return unlockScroll
  }, [open, lockPageScroll])

  return (
    <AnimatePresence>
      {open && (
        <div
          className={`fixed inset-0 ${LAYER_CLASS[layer]}${alignEnd ? ' flex items-end justify-center' : ''}`}
          data-testid={testId}
          // Taps on the container itself (the scrim area around the panel)
          // close; taps inside the dialog bubble up with another target.
          onClick={(e: React.MouseEvent<HTMLDivElement>) => {
            if (e.target !== e.currentTarget) return
            if (dismissOnScrimTap) onClose()
            else e.stopPropagation()
          }}
        >
          {scrim && (
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{ background: 'var(--color-backdrop)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.15 : 0.2 }}
            />
          )}
          {children}
        </div>
      )}
    </AnimatePresence>
  )
}

export default function PixelSheet({
  open,
  onClose,
  title,
  titleId,
  ariaLabel,
  subtitle,
  icon,
  closeLabel = 'Close',
  closeDisabled = false,
  subheader,
  footer,
  initialFocus,
  layer,
  testId,
  backdropTestId,
  children,
}: PixelSheetProps) {
  const { reduced } = useMotionConfig()
  const autoId = useId()
  const headingId = titleId ?? `pixel-sheet-title-${autoId}`
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus a named field instead of the first focusable. A layout effect runs
  // before the trap's passive effect, which leaves focus alone when something
  // inside the panel already has it (same path as a native `autoFocus`).
  useLayoutEffect(() => {
    if (!open || !initialFocus) return
    panelRef.current?.querySelector<HTMLElement>(initialFocus)?.focus()
  }, [open, initialFocus])

  // ---- drag to dismiss (handle only) ------------------------------------
  // Written with plain pointer events and the CSS `translate` property rather
  // than framer's drag: `translate` composes with the `transform` framer is
  // animating for the open/close spring, so the two never fight.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  const drag = useRef<{
    startY: number
    lastY: number
    lastT: number
    v: number
    dy: number
  } | null>(null)

  const setDrag = (dy: number, animate: boolean) => {
    const el = panelRef.current
    if (!el) return
    el.style.transition =
      animate && !reduced ? 'translate 220ms cubic-bezier(0.34, 1.4, 0.64, 1)' : 'none'
    el.style.translate = dy ? `0 ${dy}px` : ''
  }

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (closeDisabled) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, dy: 0 }
    setDrag(0, false)
  }
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dt = Math.max(1, e.timeStamp - d.lastT)
    d.v = (e.clientY - d.lastY) / dt
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    d.dy = Math.max(0, e.clientY - d.startY)
    setDrag(d.dy, false)
  }
  const onHandleUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const height = panelRef.current?.offsetHeight || 1
    if (d.dy > height * DRAG_CLOSE_RATIO || (d.dy > 0 && d.v > FLICK_VELOCITY)) {
      onClose()
      // A guarded `onClose` may refuse; if the sheet is still open a tick
      // later, spring back instead of leaving it half-dragged.
      setTimeout(() => {
        if (openRef.current) setDrag(0, true)
      }, 60)
    } else {
      setDrag(0, true)
    }
  }

  const sheetMotion = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: FADE,
      }
    : {
        initial: { y: '100%' },
        animate: { y: 0 },
        exit: { y: '100%' },
        transition: SHEET_SPRING,
      }

  return (
    <PixelModalLayer
      open={open}
      onClose={onClose}
      panelRef={panelRef}
      layer={layer}
      testId={backdropTestId}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : headingId}
        tabIndex={-1}
        data-testid={testId}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-[24px] border-solid border-t-[3px] outline-none sm:border-x-[3px]"
        style={{
          background: 'var(--color-bg)',
          color: PIXEL_INK,
          borderColor: PIXEL_INK,
        }}
        {...sheetMotion}
      >
        {/* Grab handle: decorative; the close button is the real control. */}
        <div
          data-testid="pixel-sheet-handle"
          aria-hidden="true"
          className="flex shrink-0 cursor-grab touch-none justify-center pb-2 pt-2.5 active:cursor-grabbing"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <div
            className="h-[5px] w-10 rounded-full"
            style={{ background: 'var(--color-border)' }}
          />
        </div>

        {/* Title row */}
        <div className="flex shrink-0 items-center gap-3 px-4 pb-2">
          {icon && (
            <div
              aria-hidden="true"
              className="flex shrink-0 items-center justify-center rounded-[10px] border-2"
              style={{
                width: 44,
                height: 44,
                borderColor: PIXEL_INK,
                background: 'var(--color-surface)',
              }}
            >
              {icon}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <h2
              id={headingId}
              className="text-xl font-bold leading-[26px]"
              style={{ color: PIXEL_INK }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className="line-clamp-1 text-[13px] font-bold leading-[18px]"
                style={{ color: PIXEL_INK }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label={closeLabel}
            className="flex shrink-0 items-center justify-center rounded-full border-2 focus-visible:rounded-full! focus-visible:outline-[3px]! focus-visible:outline-offset-[3px]! disabled:opacity-50"
            style={{
              width: 44,
              height: 44,
              borderColor: PIXEL_INK,
              background: 'var(--color-surface)',
              color: PIXEL_INK,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {subheader && <div className="shrink-0 px-4 pb-3">{subheader}</div>}

        {/* Body: the only part that scrolls. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
          // With no footer the body is the bottom edge: clear the home bar.
          style={
            footer ? undefined : { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }
          }
        >
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 px-4 py-3"
            style={{
              background: 'var(--color-surface)',
              borderTop: `3px solid ${PIXEL_INK}`,
              paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
            }}
          >
            {footer}
          </div>
        )}
      </motion.div>
    </PixelModalLayer>
  )
}
