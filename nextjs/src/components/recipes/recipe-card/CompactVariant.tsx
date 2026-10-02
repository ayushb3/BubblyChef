'use client'

/**
 * Recipe card, `compact` variant: the meal as one row (issues #650 / #744). It
 * is the saved-meal row in the library and the meal card in chat. A pastel tile
 * with an emoji, the title, one meta line (dishes, servings, "N to buy") and the
 * expiring badge only if something is expiring. The whole row is the control: a
 * link when given `href`, otherwise a button calling `onOpen` (min 72 px tall).
 *
 * In chat it can carry a Save meal key under the row (`onSave`):
 * - **Open** posts a draft meal and routes to `/meals/[id]`;
 * - **Save meal** posts a saved meal, or promotes the draft if the meal was
 *   already opened from this card (the caller decides, from whether a meal id
 *   exists for the message).
 * Both disable once acted on, so a second tap can never create a second meal.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import BubblesMascot from '@/components/ui/BubblesMascot'
import SpringButton from '@/components/ui/SpringButton'
import { useMotionConfig } from '@/lib/motion'
import { CARD_FRAME, CARD_KEY_SHADOW, ChevronIcon, ExpiringBadge, KEY_LAYOUT, TITLE_FONT } from './parts'

export interface CompactCardProps {
  title: string
  /** Emoji on the pastel tile. */
  emoji?: string
  /** Dish names, main first. */
  dishes?: string[]
  servings?: number | null
  /** Missing ingredients. Omit when unknown: the "N to buy" part is hidden, not "0". */
  toBuy?: string[]
  /** Names of expiring food the meal uses; the badge hides when empty. */
  expiring?: string[]
  /** Makes the whole row a link. */
  href?: string
  /** Makes the whole row a button (ignored when `href` is set). */
  onOpen?: () => void
  /** 'pending' while the draft POST is in flight; 'opened' once the meal exists and `/meals/[id]` was opened. */
  openState?: 'idle' | 'pending' | 'opened'
  /** Shows the Save meal key under the row when set. */
  onSave?: () => void
  saveState?: 'idle' | 'saving' | 'saved' | 'error'
  /**
   * Bumped by the page when the "Save this meal" pill is tapped. On each change
   * to a non-zero value: scroll the Save meal key into view, focus it and
   * highlight it (a ring) for ~2 s. A no-op while that key is disabled.
   */
  focusSaveToken?: number
}

const ROW =
  'flex min-h-[72px] w-full items-center gap-3 p-3 text-left disabled:cursor-default'

export default function CompactVariant({
  title,
  emoji = '🍽️',
  dishes = [],
  servings,
  toBuy,
  expiring = [],
  href,
  onOpen,
  openState = 'idle',
  onSave,
  saveState = 'idle',
  focusSaveToken = 0,
}: CompactCardProps) {
  const { reduced } = useMotionConfig()
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const [saveHighlighted, setSaveHighlighted] = useState(false)
  const saveDisabled = saveState === 'saving' || saveState === 'saved'

  // The "Save this meal" pill bumps this token rather than writing anything
  // itself: the card's own Save meal key stays the one confirm. A no-op while
  // that key is disabled, so a stale pill tap after the meal is saved can't
  // yank focus onto a dead control.
  useEffect(() => {
    if (focusSaveToken === 0 || saveDisabled) return
    const button = saveButtonRef.current
    if (!button) return
    button.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    button.focus()
    setSaveHighlighted(true)
    const timer = setTimeout(() => setSaveHighlighted(false), 2000)
    return () => clearTimeout(timer)
    // Reacts only to the token changing; `reduced` / `saveDisabled` are read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSaveToken])

  const metaParts: string[] = []
  if (servings && servings > 0) metaParts.push(`Serves ${servings}`)

  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--color-text)] bg-[var(--color-primary)] text-[26px]"
      >
        {emoji}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`${TITLE_FONT} text-[17px] leading-[22px] font-bold`}>{title}</span>
        {dishes.length > 0 && (
          <span className="line-clamp-2 text-xs leading-4 font-bold">{dishes.join(' · ')}</span>
        )}
        {(metaParts.length > 0 || toBuy !== undefined) && (
          <span className="text-xs leading-4 font-bold tabular-nums">
            {metaParts.join(' · ')}
            {toBuy !== undefined && (
              <>
                {metaParts.length > 0 && ' · '}
                {toBuy.length === 0 ? (
                  'Nothing to buy'
                ) : (
                  <>
                    <b>{toBuy.length} to buy</b>: {toBuy.join(', ')}
                  </>
                )}
              </>
            )}
          </span>
        )}
        <ExpiringBadge names={expiring} />
      </span>
    </>
  )

  const opening = openState !== 'idle'
  const trailing =
    openState === 'pending' ? (
      // The flip-book Bubbles beside the word (issue #887); the button's own
      // aria-label already says "Opening…", so the image is decorative here.
      <span className="flex shrink-0 items-center gap-1 text-xs font-extrabold">
        <span aria-hidden="true">
          <BubblesMascot state="thinking" size={32} />
        </span>
        Opening…
      </span>
    ) : openState === 'opened' ? (
      <span className="shrink-0 text-xs font-extrabold">✓ Opened</span>
    ) : (
      <span aria-hidden="true">
        <ChevronIcon />
      </span>
    )

  // With a Save key under the row, only the row's own tint reacts to a press; on its
  // own the whole card presses like a keycap.
  const pressFrame = onSave
    ? ''
    : 'transition-[translate,box-shadow] duration-[180ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] has-[a:active,button:active:enabled]:duration-[60ms] motion-safe:has-[a:active,button:active:enabled]:translate-y-[2px] motion-safe:has-[a:active,button:active:enabled]:shadow-[0_1px_0_var(--color-text)] motion-reduce:transition-none motion-reduce:has-[a:active,button:active:enabled]:brightness-90'
  const rowPress = onSave ? 'active:enabled:bg-[var(--color-bg)]' : ''

  return (
    <div
      className={`${CARD_FRAME} ${CARD_KEY_SHADOW} ${pressFrame} w-full overflow-hidden`}
      data-testid="recipe-card-compact"
    >
      {href ? (
        <Link href={href} className={`${ROW} ${rowPress}`}>
          {body}
          {trailing}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          disabled={opening || !onOpen}
          aria-label={
            openState === 'pending' ? 'Opening…' : openState === 'opened' ? '✓ Opened' : `Open meal: ${title}`
          }
          className={`${ROW} ${rowPress}`}
        >
          {body}
          {trailing}
        </button>
      )}

      {onSave && (
        <div className="border-t-2 border-[var(--color-text)] px-3 py-2.5">
          <SpringButton
            ref={saveButtonRef}
            variant="secondary"
            fullWidth
            onClick={onSave}
            disabled={saveDisabled}
            className={`${KEY_LAYOUT} transition-shadow motion-reduce:transition-none${
              saveHighlighted ? ' ring-2 ring-[var(--color-primary-dark)] ring-offset-2' : ''
            }`}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved!' : 'Save meal'}
          </SpringButton>
        </div>
      )}
    </div>
  )
}
