'use client'

import type { ReactNode } from 'react'
import BubblesMascot from './BubblesMascot'
import Chip from './Chip'

type EmptyStateMascotState = 'happy' | 'surprised' | 'thinking'

export interface EmptyStateCta {
  label: string
  emoji?: string
  onClick: () => void
}

interface EmptyStateProps {
  /** Bubbles mascot pose — reuses the same states as BubblesMascot. */
  state: EmptyStateMascotState
  /** Text shown in the chowder-panel header bar at the top of the card. */
  header: string
  headline: string
  subline?: string
  cta?: EmptyStateCta
  /** Extra content rendered below the CTA (e.g. page-specific suggestion chips). */
  children?: ReactNode
  className?: string
}

export default function EmptyState({
  state,
  header,
  headline,
  subline,
  cta,
  children,
  className,
}: EmptyStateProps) {
  const rootClass = [
    'bg-[var(--color-surface)] rounded-3xl overflow-hidden border border-[var(--color-border)]',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass} style={{ boxShadow: 'var(--shadow-soft)' }}>
      <div className="chowder-panel px-5 py-3">
        <p className="text-white font-semibold text-sm">{header}</p>
      </div>
      <div className="flex flex-col items-center py-12 px-6 text-center gap-3">
        <BubblesMascot state={state} size={100} />
        <p className="font-bold" style={{ color: 'var(--color-text)' }}>
          {headline}
        </p>
        {subline && (
          <p className="text-sm max-w-xs" style={{ color: 'var(--color-muted)' }}>
            {subline}
          </p>
        )}
        {cta && (
          <Chip tone="primary" size="md" emoji={cta.emoji} onClick={cta.onClick}>
            {cta.label}
          </Chip>
        )}
        {children}
      </div>
    </div>
  )
}
