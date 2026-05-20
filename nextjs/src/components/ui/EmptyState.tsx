'use client'

import BubblesMascot from './BubblesMascot'
import Chip from './Chip'

interface EmptyStateProps {
  mascotState: 'happy' | 'thinking' | 'surprised'
  headerLabel: string
  headline: string
  subline?: string
  cta?: { label: string; emoji?: string; onClick: () => void }
}

export default function EmptyState({
  mascotState,
  headerLabel,
  headline,
  subline,
  cta,
}: EmptyStateProps) {
  return (
    <div
      className="bg-[var(--color-surface)] rounded-3xl overflow-hidden border border-[var(--color-border)]"
      style={{ boxShadow: 'var(--shadow-soft)' }}
    >
      <div className="chowder-panel px-5 py-3">
        <p className="text-white font-semibold text-sm">{headerLabel}</p>
      </div>
      <div className="flex flex-col items-center py-12 px-6 text-center gap-3">
        <BubblesMascot state={mascotState} size={100} />
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
      </div>
    </div>
  )
}
