'use client'

/**
 * Issue #653 — the cook-along's Now card: the one thing to do right now.
 * Presentational only — props in, callbacks out, no clock read, no timers.
 * Built on the same pill-button and rounded-card shell as
 * `GuidedCookFlow`/`MealDishCard` — no new visual language. The dish colour
 * tag is never the only signal for which dish a step belongs to: the dish
 * title is always printed next to it (see `DishTag`).
 *
 * `card.kind === 'finished'` renders nothing — the page shows
 * `MealCookFinished` instead (contract §6).
 *
 * Review round 1: the outer `<section>` is the same element across every
 * card kind (a single return, branching only on what's *inside* it) and
 * carries `aria-live="polite"` — so it never unmounts/remounts on a kind
 * change or a step change, and every transition (upcoming → active, one
 * active step to the next, active → waiting) mutates already-mounted text
 * that a screen reader is already watching, the same reason `TimerDock`'s
 * live region is always rendered rather than inserted pre-populated.
 */

import { COLUMN_COLORS } from './MealTimelineTable'
import MealRunningStrip from './MealRunningStrip'
import type { NowCard, StreamStep } from '@/lib/meal-cook-stream'

export type { NowCard }

export interface MealNowCardProps {
  card: NowCard
  clockLabel: (offsetMinutes: number) => string
  onDone: () => void
  onExtend: () => void
  onSkip: () => void
  onStartEarly: () => void
  disabled?: boolean
  /**
   * Opens the per-dish Ask Bubbles overlay, pinned to this card's dish
   * (issue #654 PR B). Rendered as a pill on `active` and `upcoming` cards
   * only — `waiting` has no single dish to pin. Omitted entirely when this
   * prop is left out, so every existing render is unchanged.
   */
  onAskBubbles?: () => void
}

const PILL_BASE =
  'min-h-[44px] px-4 rounded-full text-sm font-bold active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed'

const PILL_PRIMARY = { background: 'var(--color-primary)', color: 'var(--color-text)' } as const
const PILL_SECONDARY = {
  background: 'var(--color-surface)',
  border: '1.5px solid var(--color-border)',
  color: 'var(--color-text)',
} as const

function AskBubblesPill({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={PILL_BASE}
      style={{ background: 'var(--color-accent)', color: 'var(--color-text)' }}
      aria-label="Ask Bubbles about this dish"
      data-testid="meal-now-card-ask-bubbles"
    >
      💬 Ask Bubbles
    </button>
  )
}

function DishTag({ step }: { step: StreamStep }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"
      style={{ color: 'var(--color-muted)' }}
      data-testid="meal-now-card-dish-tag"
    >
      <span
        aria-hidden="true"
        className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
        style={{ background: COLUMN_COLORS[step.column] }}
      />
      {step.dish_title}
    </span>
  )
}

export default function MealNowCard({
  card,
  clockLabel,
  onDone,
  onExtend,
  onSkip,
  onStartEarly,
  disabled = false,
  onAskBubbles,
}: MealNowCardProps) {
  if (card.kind === 'finished') return null

  return (
    <section
      className="rounded-3xl p-5"
      style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', fontFamily: 'Nunito, sans-serif' }}
      data-testid="meal-now-card"
      aria-label="Now"
      aria-live="polite"
      aria-atomic="true"
    >
      {card.kind === 'waiting' && (
        <>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }} data-testid="meal-now-card-waiting-copy">
            Nothing to do right now.
          </p>
          {/* Soonest end first — sorted defensively here rather than trusting
              caller order, since that's this card's own rendering contract. */}
          <div className="mt-3">
            <MealRunningStrip
              steps={[...card.running].sort((a, b) => a.end - b.end)}
              clockLabel={clockLabel}
            />
          </div>
        </>
      )}

      {card.kind === 'upcoming' && (
        <>
          <DishTag step={card.step} />
          <p className="text-sm font-bold mt-2" style={{ color: 'var(--color-text)' }} data-testid="meal-now-card-upcoming-timing">
            Next at {clockLabel(card.step.start)} (in {card.starts_in_minutes} min)
          </p>
          {card.waiting_on && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }} data-testid="meal-now-card-waiting-on">
              after {card.waiting_on.label}
            </p>
          )}
          <p className="text-lg font-extrabold mt-3" style={{ color: 'var(--color-text)' }}>
            {card.step.label}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>
            {card.step.text}
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              type="button"
              onClick={onStartEarly}
              disabled={disabled}
              className={PILL_BASE}
              style={PILL_PRIMARY}
              aria-label="Start now"
            >
              Start now
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={disabled}
              className={PILL_BASE}
              style={PILL_SECONDARY}
              aria-label="Skip"
            >
              Skip
            </button>
            {onAskBubbles && <AskBubblesPill onClick={onAskBubbles} disabled={disabled} />}
          </div>
        </>
      )}

      {card.kind === 'active' && (
        <>
          <div className="flex items-center justify-between gap-2">
            <DishTag step={card.step} />
            <span
              className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text)' }}
              data-testid="meal-now-card-badge"
            >
              {card.step.hands_on ? 'Hands-on' : 'Hands-off'}
            </span>
          </div>
          <p className="text-xl font-extrabold mt-3" style={{ color: 'var(--color-text)' }}>
            {card.step.label}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>
            {card.step.text}
          </p>
          <p className="text-xs font-semibold mt-2" style={{ color: 'var(--color-muted)' }}>
            {card.step.duration_minutes} min
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {card.step.hands_on ? (
              <>
                <button type="button" onClick={onDone} disabled={disabled} className={PILL_BASE} style={PILL_PRIMARY} aria-label="Done">
                  Done
                </button>
                <button
                  type="button"
                  onClick={onExtend}
                  disabled={disabled}
                  className={PILL_BASE}
                  style={PILL_SECONDARY}
                  aria-label="Add 2 minutes"
                >
                  +2 min
                </button>
                <button type="button" onClick={onSkip} disabled={disabled} className={PILL_BASE} style={PILL_SECONDARY} aria-label="Skip">
                  Skip
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onDone}
                  disabled={disabled}
                  className={PILL_BASE}
                  style={PILL_PRIMARY}
                  aria-label="Start timer"
                >
                  Start timer
                </button>
                <button type="button" onClick={onSkip} disabled={disabled} className={PILL_BASE} style={PILL_SECONDARY} aria-label="Skip">
                  Skip
                </button>
              </>
            )}
            {onAskBubbles && <AskBubblesPill onClick={onAskBubbles} disabled={disabled} />}
          </div>
        </>
      )}
    </section>
  )
}
