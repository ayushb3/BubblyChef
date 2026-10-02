'use client'

/**
 * Issue #652 — the swap/add-a-side row: three mini cards from
 * `POST /v1/meals/side-alternatives`, appearing under the side being swapped
 * (or under "Add a side"). Tapping one starts the expand-dish call; the
 * caller drives `state`/`pendingIndex` from its own fetch, this component
 * only renders what it's told. Shaped like `MealOptionCards`' tappable card
 * list (`role="list"` of `role="listitem"` buttons, a "Pick <name>"
 * accessible name) — no new visual language.
 */

import { motion } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'

export interface SideAlternative {
  name: string
  blurb: string
  key_ingredients: string[]
  est_total_minutes: number | null
  est_hands_on_minutes: number | null
}

export interface SideAlternativesRowProps {
  state: 'loading' | 'error' | 'ready'
  alternatives: SideAlternative[]
  /** Index of the card currently being expanded — disables the rest while set. */
  pendingIndex?: number | null
  errorMessage?: string
  onPick: (index: number) => void
  onRetry: () => void
  onCancel: () => void
}

export default function SideAlternativesRow({
  state,
  alternatives,
  pendingIndex = null,
  errorMessage,
  onPick,
  onRetry,
  onCancel,
}: SideAlternativesRowProps) {
  return (
    <div className="flex flex-col gap-2" data-testid="side-alternatives-row">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Alternatives
        </span>
        <button
          type="button"
          onClick={onCancel}
          // An expand already in flight can't be aborted, so Cancel waits for it.
          disabled={pendingIndex !== null}
          aria-label="Cancel choosing an alternative"
          className="text-xs font-semibold underline-offset-2 hover:underline px-1 py-1 disabled:opacity-40 disabled:no-underline"
          style={{ color: 'var(--color-muted)' }}
        >
          Cancel
        </button>
      </div>

      {state === 'loading' && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {/* Issue #887: Bubbles says what the wait is, over cards in the same
              slots the alternatives will land in. One polite status region. */}
          <div className="flex items-center gap-2">
            <span aria-hidden="true">
              <BubblesMascot state="thinking" size={32} />
            </span>
            <p role="status" className="text-xs font-bold" style={{ color: 'var(--color-muted)' }}>
              Bubbly is thinking of sides…
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Loading alternatives">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className="flex-shrink-0 w-40 rounded-2xl p-3 flex flex-col gap-2 min-h-[88px]"
                style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
                data-testid="side-alternative-skeleton"
              >
                {[['w-3/4', 'h-3'], ['w-full', 'h-2'], ['w-1/2', 'h-2']].map(([w, h], j) => (
                  <span
                    key={j}
                    className={`block rounded-full motion-safe:animate-pulse ${w} ${h}`}
                    style={{ background: 'var(--color-border)', animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {state === 'error' && (
        <div
          className="rounded-2xl p-3 flex flex-col gap-2"
          style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
          role="alert"
        >
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            {errorMessage ?? "Couldn't load alternatives."}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="self-start min-h-[44px] px-4 rounded-full text-sm font-bold"
            style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
          >
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            role="list"
            aria-label="Side alternatives — tap one to build it"
          >
            {alternatives.map((alt, i) => {
              const isPending = pendingIndex === i
              const isDisabled = pendingIndex != null && !isPending
              return (
                <motion.button
                  key={`${alt.name}-${i}`}
                  type="button"
                  role="listitem"
                  aria-label={isPending ? `Building ${alt.name}…` : `Pick ${alt.name}`}
                  aria-busy={isPending}
                  disabled={isDisabled || isPending}
                  onClick={() => onPick(i)}
                  whileTap={isDisabled || isPending ? undefined : { scale: 0.97 }}
                  className={[
                    'flex-shrink-0 w-40 text-left rounded-2xl p-3 flex flex-col gap-1 min-h-[44px]',
                    // The picked card stays at full strength (it is the one working);
                    // the others dim. Both are inert while a pick is in flight.
                    isPending
                      ? 'cursor-default'
                      : isDisabled
                        ? 'opacity-50 cursor-default'
                        : 'cursor-pointer hover:brightness-97 active:brightness-90',
                  ].join(' ')}
                  style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
                >
                  <span className="text-sm font-bold leading-snug" style={{ color: 'var(--color-text)' }}>
                    {alt.name}
                  </span>
                  {alt.blurb && (
                    <span className="text-xs line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                      {alt.blurb}
                    </span>
                  )}
                  {alt.est_total_minutes != null && (
                    <span className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>
                      ⏱ {alt.est_total_minutes} min
                    </span>
                  )}
                  {isPending && (
                    <span
                      data-testid="side-working"
                      aria-hidden="true"
                      className="flex items-center gap-1 text-[11px] font-semibold"
                      style={{ color: 'var(--color-primary-dark)' }}
                    >
                      <BubblesMascot state="thinking" size={28} />
                      Building…
                    </span>
                  )}
                </motion.button>
              )
            })}
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {pendingIndex != null ? `Building ${alternatives[pendingIndex]?.name ?? 'dish'}…` : ''}
          </span>
        </>
      )}
    </div>
  )
}
