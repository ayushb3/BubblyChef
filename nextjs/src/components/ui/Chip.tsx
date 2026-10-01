'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { reactionVariants, springs, useMotionConfig } from '@/lib/motion'
import { expiryTag } from '@/lib/food-tag'

export type ChipTone =
  | 'primary'
  | 'accent'
  | 'fresh'
  | 'expiring'
  | 'expired'
  | 'muted'

export interface ChipProps {
  tone?: ChipTone
  size?: 'sm' | 'md'
  /** Visual only (filled primary, ink edge and a tick). Not announced to assistive tech; see `pressed`. */
  selected?: boolean
  /**
   * ARIA toggle state (issue #665). Set it only on chips that really are
   * toggles; `aria-pressed` renders only when this is defined, so one-shot
   * chips are announced as plain buttons.
   */
  pressed?: boolean
  emoji?: string
  onClick?: () => void
  children: ReactNode
  ariaLabel?: string
  className?: string
  /**
   * Native tooltip carrying the untruncated label (issue #651). The label
   * itself always renders with `truncate`, so a caller in a narrow flex row
   * (e.g. `PostMessageChips`, at 375px) can also constrain this chip's own
   * width via `className` (`min-w-0 max-w-full`) without losing the full
   * text — it's one hover/long-press away instead of causing sideways
   * scroll.
   */
  title?: string
  /**
   * Food tag mode (issue #741): days until the food expires. Sets the tone
   * (fresh / expiring / expired, on the theme-invariant expiry tokens) and
   * appends the short label after the name ("Romaine · Today"). Overrides
   * `tone`. `null` / `undefined` leaves the chip as a plain chip. An
   * expiring tag droops and fades once when it first appears, then holds
   * (not at all under reduced motion).
   */
  expiresInDays?: number | null
}

const TONE_BG: Record<ChipTone, string> = {
  primary: 'var(--color-primary)',
  accent: 'var(--color-accent)',
  fresh: 'var(--color-fresh)',
  expiring: 'var(--color-expiring)',
  expired: 'var(--color-expired)',
  muted: 'var(--color-surface)',
}

// Ink text on every fill (board: never white on primary).
const TONE_TEXT: Record<ChipTone, string> = {
  primary: 'var(--color-text)',
  accent: 'var(--color-text)',
  fresh: 'var(--color-fresh-text)',
  expiring: 'var(--color-expiring-text)',
  expired: 'var(--color-expired-text)',
  muted: 'var(--color-text)',
}

// Hairline edge for display chips: the tone's text colour thinned into its fill.
const TONE_EDGE: Record<ChipTone, string> = {
  primary: 'var(--color-border)',
  accent: 'var(--color-border)',
  fresh: 'color-mix(in srgb, var(--color-fresh-text) 30%, var(--color-fresh))',
  expiring: 'color-mix(in srgb, var(--color-expiring-text) 35%, var(--color-expiring))',
  expired: 'color-mix(in srgb, var(--color-expired-text) 25%, var(--color-expired))',
  muted: 'var(--color-border)',
}

const SIZE_CLASS: Record<NonNullable<ChipProps['size']>, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'py-[3px] pl-1.5 pr-2.5 text-[13px] leading-[18px]',
}

function Tick() {
  const { reduced } = useMotionConfig()
  return (
    <motion.svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="chip-tick"
      className="shrink-0"
      initial={reduced ? false : { scale: 0.8 }}
      animate={{ scale: 1 }}
      transition={springs.pop}
    >
      <path d="M5 12l5 5 9-10" />
    </motion.svg>
  )
}

export default function Chip({
  tone: toneProp = 'muted',
  size = 'md',
  selected = false,
  pressed,
  emoji,
  onClick,
  children,
  ariaLabel,
  className,
  title,
  expiresInDays,
}: ChipProps) {
  const { reduced } = useMotionConfig()
  const tag = expiresInDays !== undefined ? expiryTag(expiresInDays) : null
  const tone: ChipTone = tag ? tag.tone : toneProp
  // The droop belongs to expiring *food*, not to every yellow chip (recipe
  // meta chips use the expiring tone for cook time), so it's keyed to the tag.
  const droops = tag?.tone === 'expiring'
  // "Today" gets a 2px edge, tomorrow and later a hairline.
  const urgent = tag?.label === 'Today'

  // Controls grow to a 44px target with an ink edge; display chips stay 24px.
  const clickable = Boolean(onClick)
  const baseClass = [
    'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none',
    clickable ? 'py-0 pl-2.5 pr-3.5 text-sm' : SIZE_CLASS[size],
    clickable
      ? 'min-h-[44px] border-2 border-[color:var(--color-text)]'
      : urgent
        ? 'border-2'
        : 'border',
  ].join(' ')
  const merged = className ? `${baseClass} ${className}` : baseClass
  // `min-w-0` lets this shrink below its content's max-content width inside
  // a constrained flex row (needed for `truncate` below to ever bite);
  // `truncate` (overflow-hidden + text-ellipsis + whitespace-nowrap) clips
  // long labels with an ellipsis instead of forcing the row to overflow.
  const labelClass = 'min-w-0 truncate'

  const style = {
    background: selected ? 'var(--color-primary)' : TONE_BG[tone],
    color: selected ? 'var(--color-text)' : TONE_TEXT[tone],
    ...(clickable ? {} : { borderColor: urgent ? TONE_TEXT[tone] : TONE_EDGE[tone] }),
    ...(droops ? { transformOrigin: 'top left' } : {}),
  } as const

  const reaction = droops
    ? ({ variants: reactionVariants(reduced).droop, initial: 'idle', animate: 'play' } as const)
    : {}

  const content = (
    <>
      {selected && <Tick />}
      {emoji && <span aria-hidden>{emoji}</span>}
      <span className={labelClass}>
        {children}
        {tag && <b className="font-extrabold"> · {tag.label}</b>}
      </span>
    </>
  )

  if (onClick) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={pressed}
        title={title}
        whileTap={reduced ? undefined : { scale: 0.95 }}
        transition={springs.snappy}
        className={merged}
        style={style}
        {...reaction}
      >
        {content}
      </motion.button>
    )
  }

  return (
    <motion.span
      className={merged}
      style={style}
      aria-label={ariaLabel}
      title={title}
      data-tone={tone}
      {...reaction}
    >
      {content}
    </motion.span>
  )
}
