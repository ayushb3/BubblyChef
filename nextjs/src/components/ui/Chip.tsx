'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { springs } from '@/lib/motion'

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
  /** Visual only (filled primary). Not announced to assistive tech; see `pressed`. */
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
}

const TONE_BG: Record<ChipTone, string> = {
  primary: 'var(--color-primary)',
  accent: 'var(--color-accent)',
  fresh: 'var(--color-fresh)',
  expiring: 'var(--color-expiring)',
  expired: 'var(--color-expired)',
  muted: 'var(--color-bg)',
}

const TONE_TEXT: Record<ChipTone, string> = {
  primary: 'var(--color-text)',
  accent: 'var(--color-text)',
  fresh: 'var(--color-fresh-text)',
  expiring: 'var(--color-expiring-text)',
  expired: 'var(--color-expired-text)',
  muted: 'var(--color-muted)',
}

const SIZE_CLASS: Record<NonNullable<ChipProps['size']>, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1.5 text-xs',
}

export default function Chip({
  tone = 'muted',
  size = 'md',
  selected = false,
  pressed,
  emoji,
  onClick,
  children,
  ariaLabel,
  className,
  title,
}: ChipProps) {
  const baseClass = `inline-flex items-center gap-1 ${SIZE_CLASS[size]} rounded-full font-semibold whitespace-nowrap transition-colors border border-[var(--color-border)]`
  const merged = className ? `${baseClass} ${className}` : baseClass
  // `min-w-0` lets this shrink below its content's max-content width inside
  // a constrained flex row (needed for `truncate` below to ever bite);
  // `truncate` (overflow-hidden + text-ellipsis + whitespace-nowrap) clips
  // long labels with an ellipsis instead of forcing the row to overflow.
  const labelClass = 'min-w-0 truncate'

  const style = {
    background: selected ? 'var(--color-primary)' : TONE_BG[tone],
    color: selected ? '#fff' : TONE_TEXT[tone],
  } as const

  if (onClick) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={pressed}
        title={title}
        whileTap={{ scale: 0.95 }}
        transition={springs.snappy}
        className={merged}
        style={style}
      >
        {emoji && <span aria-hidden>{emoji}</span>}
        <span className={labelClass}>{children}</span>
      </motion.button>
    )
  }

  return (
    <span className={merged} style={style} aria-label={ariaLabel} title={title}>
      {emoji && <span aria-hidden>{emoji}</span>}
      <span className={labelClass}>{children}</span>
    </span>
  )
}
