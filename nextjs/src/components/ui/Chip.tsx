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
  selected?: boolean
  emoji?: string
  onClick?: () => void
  children: ReactNode
  ariaLabel?: string
  className?: string
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
  emoji,
  onClick,
  children,
  ariaLabel,
  className,
}: ChipProps) {
  const baseClass = `focus-ring inline-flex items-center gap-1 ${SIZE_CLASS[size]} rounded-full font-semibold whitespace-nowrap transition-colors border border-[var(--color-border)]`
  const merged = className ? `${baseClass} ${className}` : baseClass

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
        aria-pressed={selected}
        whileTap={{ scale: 0.95 }}
        transition={springs.snappy}
        className={merged}
        style={style}
      >
        {emoji && <span aria-hidden>{emoji}</span>}
        <span>{children}</span>
      </motion.button>
    )
  }

  return (
    <span className={merged} style={style} aria-label={ariaLabel}>
      {emoji && <span aria-hidden>{emoji}</span>}
      <span>{children}</span>
    </span>
  )
}
