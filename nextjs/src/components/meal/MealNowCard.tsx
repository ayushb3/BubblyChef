'use client'

/**
 * Issue #653 — the cook-along's Now card: the one thing to do right now.
 * Presentational only — props in, callbacks out, no clock read, no timers.
 *
 * Issue #745 (signature): the card is a `PixelPanel`; the dish tag wears the
 * dish's pastel (the dish title is always printed in it, so the colour is
 * never the only signal); the actions are keycaps (Done / +2 min / Skip); a
 * hands-off step is drawn hatched, a hands-on one solid; and an optional
 * per-dish progress strip closes the card. Behaviour is unchanged.
 *
 * `card.kind === 'finished'` renders nothing — the page shows
 * `MealCookFinished` instead (contract §6).
 *
 * Review round 1: the outer panel is the same element across every card kind
 * (a single return, branching only on what's *inside* it) and carries
 * `aria-live="polite"` — so it never unmounts/remounts on a kind change or a
 * step change, and every transition (upcoming → active, one active step to
 * the next, active → waiting) mutates already-mounted text that a screen
 * reader is already watching, the same reason `TimerDock`'s live region is
 * always rendered rather than inserted pre-populated.
 */

import PixelPanel from '@/components/ui/PixelPanel'
import SpringButton from '@/components/ui/SpringButton'
import HandsChip from './HandsChip'
import MealProgressStrip from './MealProgressStrip'
import MealRunningStrip from './MealRunningStrip'
import { DISH_BG, SOLID_EDGE } from './dish-style'
import type { DishProgress } from './dish-progress'
import { canStartEarly, type NowCard, type StreamStep } from '@/lib/meal-cook-stream'

export type { NowCard }

export interface MealNowCardProps {
  card: NowCard
  clockLabel: (offsetMinutes: number) => string
  onDone: () => void
  onExtend: () => void
  onSkip: () => void
  onStartEarly: () => void
  /**
   * Issue #890 — marks the running step this `upcoming` card is waiting on as
   * done now ("Done early": the oven is ready). Rendered only on a card with
   * `waiting_on`, and omitted entirely when this prop is left out.
   */
  onFinishWaiting?: () => void
  disabled?: boolean
  /**
   * Opens the per-dish Ask Bubbles overlay, pinned to this card's dish
   * (issue #654 PR B). Rendered as a key on `active` and `upcoming` cards
   * only — `waiting` has no single dish to pin. Omitted entirely when this
   * prop is left out, so every existing render is unchanged.
   */
  onAskBubbles?: () => void
  /**
   * Issue #745 — per-dish progress for the strip along the card's foot (build
   * it with `dishProgress`). Omitted or empty: no strip.
   */
  progress?: DishProgress[]
  /**
   * Issue #849 — the scaled ingredients this card's step uses, as display
   * labels ("2 tbsp butter"; build them with `ingredientsForStep`). Drawn as a
   * row of chips under the step text on `active` and `upcoming` cards. Empty
   * or omitted: no row (a step that names nothing shows none; never a guess).
   */
  stepIngredients?: string[]
}

function StepIngredientChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ingredients for this step" data-testid="meal-now-card-ingredients">
      {labels.map((label) => (
        <li
          key={label}
          className={`rounded-full bg-[color:var(--color-surface)] px-3 py-1 text-base leading-6 font-bold text-[color:var(--color-text)] ${SOLID_EDGE}`}
        >
          {label}
        </li>
      ))}
    </ul>
  )
}

function AskBubblesKey({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <SpringButton
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      aria-label="Ask Bubbles about this dish"
      data-testid="meal-now-card-ask-bubbles"
    >
      💬 Ask Bubbles
    </SpringButton>
  )
}

function DishTag({ step }: { step: StreamStep }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs leading-4 font-extrabold text-[color:var(--color-text)] ${SOLID_EDGE} ${DISH_BG[step.column]}`}
      data-testid="meal-now-card-dish-tag"
    >
      <span className="truncate">{step.dish_title}</span>
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
  onFinishWaiting,
  disabled = false,
  onAskBubbles,
  progress,
  stepIngredients,
}: MealNowCardProps) {
  if (card.kind === 'finished') return null

  return (
    <PixelPanel
      as="section"
      contentClassName="p-5"
      data-testid="meal-now-card"
      aria-label="Now"
      aria-live="polite"
      aria-atomic="true"
    >
      {card.kind === 'waiting' && (
        <>
          <p className="text-sm font-bold text-[color:var(--color-text)]" data-testid="meal-now-card-waiting-copy">
            Nothing to do right now.
          </p>
          {/* Soonest end first — sorted defensively here rather than trusting
              caller order, since that's this card's own rendering contract. */}
          <div className="mt-3">
            <MealRunningStrip steps={[...card.running].sort((a, b) => a.end - b.end)} clockLabel={clockLabel} />
          </div>
        </>
      )}

      {card.kind === 'upcoming' && (
        <>
          <DishTag step={card.step} />
          <p className="mt-2 text-sm font-bold text-[color:var(--color-text)]" data-testid="meal-now-card-upcoming-timing">
            Next at {clockLabel(card.step.start)} (in {card.starts_in_minutes} min)
          </p>
          {card.waiting_on && (
            <p className="mt-1 text-xs text-[color:var(--color-text)]" data-testid="meal-now-card-waiting-on">
              Waiting on {card.waiting_on.label}
              {card.waiting_on.hands_on ? '' : ' (timer)'}. You can start now.
            </p>
          )}
          <p className="mt-3 text-2xl leading-tight font-extrabold text-[color:var(--color-text)]">{card.step.label}</p>
          <p className="mt-1 text-xl leading-snug text-[color:var(--color-text)]" data-testid="meal-now-card-step-text">
            {card.step.text}
          </p>
          <StepIngredientChips labels={stepIngredients ?? []} />
          <div className="mt-4 flex flex-wrap gap-2.5">
            {/* Issue #890: Start now is always there, even while a step this
                one follows is still running (the line above says why it is
                waiting, and the one below that the running step carries on). */}
            {canStartEarly(card) && (
              <SpringButton variant="primary" onClick={onStartEarly} disabled={disabled} aria-label="Start now">
                Start now
              </SpringButton>
            )}
            <SpringButton variant="secondary" onClick={onSkip} disabled={disabled} aria-label="Skip">
              Skip
            </SpringButton>
            {card.waiting_on && onFinishWaiting && (
              <SpringButton
                variant="secondary"
                onClick={onFinishWaiting}
                disabled={disabled}
                aria-label={`Mark ${card.waiting_on.label} done early`}
                data-testid="meal-now-card-done-early"
              >
                Done early
              </SpringButton>
            )}
            {onAskBubbles && <AskBubblesKey onClick={onAskBubbles} disabled={disabled} />}
          </div>
          {card.waiting_on && (
            <p className="mt-2 text-xs text-[color:var(--color-text)]" data-testid="meal-now-card-keeps-running">
              {card.waiting_on.label} keeps running.
            </p>
          )}
        </>
      )}

      {card.kind === 'active' && (
        <>
          <div className="flex items-center justify-between gap-2">
            <DishTag step={card.step} />
            <HandsChip
              handsOn={card.step.hands_on}
              fillClass={DISH_BG[card.step.column]}
              testId="meal-now-card-badge"
            />
          </div>
          <p className="mt-3 text-2xl leading-tight font-extrabold text-[color:var(--color-text)]">{card.step.label}</p>
          <p className="mt-1 text-xl leading-snug text-[color:var(--color-text)]" data-testid="meal-now-card-step-text">
            {card.step.text}
          </p>
          <StepIngredientChips labels={stepIngredients ?? []} />
          <p className="mt-2 text-xs font-bold text-[color:var(--color-text)] tabular-nums">
            {card.step.duration_minutes} min
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {card.step.hands_on ? (
              <>
                <SpringButton variant="primary" onClick={onDone} disabled={disabled} aria-label="Done">
                  Done
                </SpringButton>
                <SpringButton variant="secondary" onClick={onExtend} disabled={disabled} aria-label="Add 2 minutes">
                  +2 min
                </SpringButton>
                <SpringButton variant="secondary" onClick={onSkip} disabled={disabled} aria-label="Skip">
                  Skip
                </SpringButton>
              </>
            ) : (
              <>
                <SpringButton variant="primary" onClick={onDone} disabled={disabled} aria-label="Start timer">
                  Start timer
                </SpringButton>
                <SpringButton variant="secondary" onClick={onSkip} disabled={disabled} aria-label="Skip">
                  Skip
                </SpringButton>
              </>
            )}
            {onAskBubbles && <AskBubblesKey onClick={onAskBubbles} disabled={disabled} />}
          </div>
        </>
      )}

      {progress && progress.length > 0 && (
        <div className="mt-4 border-t-2 border-[color:var(--color-border)] pt-3">
          <MealProgressStrip progress={progress} />
        </div>
      )}
    </PixelPanel>
  )
}
