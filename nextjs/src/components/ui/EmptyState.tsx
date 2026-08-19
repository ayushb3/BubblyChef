'use client'

import { motion } from 'framer-motion'
import BubblesMascot from './BubblesMascot'
import Chip from './Chip'
import { useMotionConfig } from '@/lib/motion'

export type EmptyStateMascot = 'happy' | 'thinking' | 'surprised'

export interface EmptyStateProps {
  /** Which Bubbles expression to show. */
  mascotState?: EmptyStateMascot
  /** Label rendered inside the chowder-panel header strip. */
  headerLabel?: string
  /**
   * Header strip treatment. 'default' is the original understated
   * chowder-panel used by pantry/profile; 'chat' is the richer
   * diagonal-gradient + visible-crosshatch variant (#173) for the chat
   * empty state's "Chef Bubbly" header. Defaults to 'default' so existing
   * callers are unaffected.
   */
  headerVariant?: 'default' | 'chat'
  /** Primary line — what's missing. */
  headline: string
  /** Secondary line — what to do about it. */
  subline?: string
  /** Optional call-to-action; renders as a primary Chip when `onCta` is set. */
  ctaLabel?: string
  ctaEmoji?: string
  onCta?: () => void
  /** Extra classes on the card root (e.g. horizontal margin at the call site). */
  className?: string
}

/**
 * Shared empty-state card: chowder-panel header + animated mascot + copy + CTA.
 *
 * Replaces the hand-rolled empty states that had drifted apart across pages.
 * Colours come entirely from design tokens so all five themes work.
 */
export default function EmptyState({
  mascotState = 'happy',
  headerLabel,
  headerVariant = 'default',
  headline,
  subline,
  ctaLabel,
  ctaEmoji,
  onCta,
  className,
}: EmptyStateProps) {
  const { springs, reduced } = useMotionConfig()

  const rootClass = [
    'bg-[var(--color-surface)] rounded-3xl overflow-hidden border border-[var(--color-border)]',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <motion.div
      className={rootClass}
      style={{ boxShadow: 'var(--shadow-soft)' }}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springs.soft}
    >
      {headerLabel && (
        <div
          className={`${headerVariant === 'chat' ? 'chowder-panel-chat' : 'chowder-panel'} px-5 py-3`}
        >
          <p className="text-white font-semibold text-sm">{headerLabel}</p>
        </div>
      )}

      <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
        {/* `animate={false}` under prefers-reduced-motion — the mascot's idle
            float is an infinite loop, not a one-shot transition. */}
        <BubblesMascot state={mascotState} size={100} animate={!reduced} />

        <p className="font-bold text-[var(--color-text)]">{headline}</p>

        {subline && (
          <p className="text-sm max-w-xs text-[var(--color-muted)]">{subline}</p>
        )}

        {ctaLabel && onCta && (
          <Chip tone="primary" size="md" emoji={ctaEmoji} onClick={onCta}>
            {ctaLabel}
          </Chip>
        )}
      </div>
    </motion.div>
  )
}
