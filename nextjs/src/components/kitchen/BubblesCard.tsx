'use client'

/**
 * The Bubbles card (issue #755, Goal 2 of the signature PRD): one card under the
 * kitchen scene that says the single most useful thing right now. Board "Bubbles
 * card · the five cases" of the Kitchen Home canvas.
 *
 * Presentation only: `lib/kitchen/home-card.ts` decides which card there is and
 * `HomeCardSlot` wires its actions; this draws one.
 *
 * Anatomy, from the board: a PixelPanel holding the illustrated Bubbles, one line
 * of copy and the cross (Not now, hides the nudge until something changes), then
 * the answers as keycaps: the options as outlined keys in a column, a divider, and
 * the one filled primary key.
 *
 *  - A key with an `href` is a link (a chat seed or a route), so it behaves like any
 *    link; a key with an `action` is a button the slot answers.
 *  - Every key and the cross are 44 px tall (the cross is drawn at 32 px inside a
 *    44 px hit area). Long copy wraps; a long option label wraps inside its key
 *    rather than overflowing the card.
 *  - Discard the scan asks first, in the card ("Discard this scan?", Yes or Keep it),
 *    because a parsed scan cost a model call to make.
 *  - Reduced motion: the panel's entrance is a plain fade (PixelPanel owns that).
 */
import { useState } from 'react'
import Link from 'next/link'
import BubblesMascot, { type BubblesState } from '@/components/ui/BubblesMascot'
import PixelPanel from '@/components/ui/PixelPanel'
import SpringButton from '@/components/ui/SpringButton'
import { KEYCAP_LINK, KEY_LAYOUT } from '@/components/recipes/recipe-card/parts'
import type { HomeCard, HomeCardAction, HomeCardActionId } from '@/lib/kitchen/home-card'

export interface BubblesCardProps {
  card: HomeCard
  /** Bubbles' face on the card (#593): worried, surprised, thinking or happy. */
  mood?: BubblesState
  /** A key with an `action` was pressed. */
  onAction: (action: HomeCardActionId) => void
  /** The cross (Not now). */
  onDismiss: () => void
}

/** The options' look: outlined keys that fill the column, label to the left. */
const OPTION_CLASS = `${KEYCAP_LINK} w-full justify-start! text-left whitespace-normal!`
/** The primary: a link key in the theme's primary fill, label centred. */
const PRIMARY_CLASS = `${KEYCAP_LINK} w-full bg-[var(--color-primary)]! whitespace-normal!`

function Key({
  action,
  primary,
  onAction,
}: {
  action: HomeCardAction
  primary?: boolean
  onAction: (id: HomeCardActionId) => void
}) {
  if (action.href) {
    return (
      <Link href={action.href} className={primary ? PRIMARY_CLASS : OPTION_CLASS}>
        {action.label}
      </Link>
    )
  }
  return (
    <SpringButton
      variant={primary ? 'primary' : 'secondary'}
      className={`${KEY_LAYOUT} w-full whitespace-normal! ${primary ? '' : 'justify-start! text-left'}`}
      onClick={() => action.action && onAction(action.action)}
    >
      {action.label}
    </SpringButton>
  )
}

export default function BubblesCard({ card, mood = 'happy', onAction, onDismiss }: BubblesCardProps) {
  // Per card: a new card (a different fingerprint) starts without a question open.
  const [confirming, setConfirming] = useState<string | null>(null)
  const askingToDiscard = confirming === card.fingerprint

  return (
    <PixelPanel entrance data-testid="bubbles-card" data-card-kind={card.kind} contentClassName="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <BubblesMascot state={mood} size={44} animate={false} className="shrink-0" />
          <p
            className="min-w-0 flex-1 text-[15px] leading-[22px] font-semibold text-[color:var(--color-text)]"
            data-testid="bubbles-card-message"
          >
            {askingToDiscard ? 'Discard this scan?' : card.message}
          </p>
          <button
            type="button"
            aria-label="Not now"
            onClick={onDismiss}
            className="-mt-2 -mr-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] text-[color:var(--color-text)]">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
          </button>
        </div>

        {askingToDiscard ? (
          <div className="flex flex-col gap-2">
            <SpringButton
              variant="danger"
              className={`${KEY_LAYOUT} w-full justify-start! text-left`}
              onClick={() => {
                setConfirming(null)
                onAction('discard-scan')
              }}
            >
              Yes, discard it
            </SpringButton>
            <SpringButton
              variant="secondary"
              className={`${KEY_LAYOUT} w-full justify-start! text-left`}
              onClick={() => setConfirming(null)}
            >
              Keep it
            </SpringButton>
          </div>
        ) : (
          <>
            {card.options.length > 0 && (
              <div className="flex flex-col gap-2">
                {card.options.map((option) =>
                  option.action === 'discard-scan' ? (
                    <SpringButton
                      key={option.label}
                      variant="secondary"
                      className={`${KEY_LAYOUT} w-full justify-start! text-left`}
                      onClick={() => setConfirming(card.fingerprint)}
                    >
                      {option.label}
                    </SpringButton>
                  ) : (
                    <Key key={option.label} action={option} onAction={onAction} />
                  ),
                )}
              </div>
            )}
            <div className="my-1 h-0.5 bg-[var(--color-border)]" aria-hidden="true" />
            <Key action={card.primary} primary onAction={onAction} />
          </>
        )}
      </div>
    </PixelPanel>
  )
}

/**
 * The card's place while the home loads: the same panel with a Bubbles-sized block
 * and two pulsing lines, the height of a one-answer card, so nothing shifts when
 * the card lands. Not announced: the loading state is the whole home's.
 */
export function BubblesCardSkeleton() {
  return (
    <PixelPanel data-testid="bubbles-card-skeleton" aria-hidden="true">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="block h-[46px] w-11 shrink-0 animate-pulse rounded-2xl bg-[var(--color-border)] motion-reduce:animate-none" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <span className="block h-3 w-11/12 animate-pulse rounded bg-[var(--color-border)] motion-reduce:animate-none" />
            <span className="block h-3 w-2/3 animate-pulse rounded bg-[var(--color-border)] motion-reduce:animate-none" />
          </div>
        </div>
        <span className="block h-11 w-full animate-pulse rounded-full bg-[var(--color-border)] motion-reduce:animate-none" />
      </div>
    </PixelPanel>
  )
}
