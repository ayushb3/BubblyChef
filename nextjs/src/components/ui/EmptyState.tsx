'use client'

import BubblesMascot from './BubblesMascot'

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
          <button
            type="button"
            onClick={cta.onClick}
            className="mt-1 px-5 py-2.5 rounded-full text-sm font-bold text-white active:scale-95 transition-transform"
            style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
          >
            {cta.emoji && <span className="mr-1">{cta.emoji}</span>}
            {cta.label}
          </button>
        )}
      </div>
    </div>
  )
}
