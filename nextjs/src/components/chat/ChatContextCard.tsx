'use client'

import { motion } from 'framer-motion'
import { useMotionConfig } from '@/lib/motion'

interface ChatContextCardProps {
  /** Decorative glyph — the card's label carries the meaning. */
  emoji: string
  /** Small uppercase eyebrow, e.g. "Today's tip". */
  label: string
  title: string
  subtitle?: string
  /** Accessible name for the dismiss control. */
  dismissLabel: string
  onDismiss: () => void
}

/**
 * Generic deep-link context banner for the chat thread — shows what the
 * conversation was opened *about* (a tip, an expiring ingredient) so the user
 * can see the handoff without scrolling back to their auto-sent first message.
 *
 * Same shape and tokens as `CookingContextCard`, which stays as-is because the
 * cook flow's copy is bespoke; if a third variant appears, fold that one in here.
 * Dismissible because the handoff is a convenience, not a mode to be stuck in.
 */
export default function ChatContextCard({
  emoji,
  label,
  title,
  subtitle,
  dismissLabel,
  onDismiss,
}: ChatContextCardProps) {
  const { springs } = useMotionConfig()

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={springs.snappy}
      className="mb-4 rounded-2xl px-4 py-3 flex items-start gap-3"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      <span aria-hidden="true" className="text-lg leading-none mt-0.5">
        {emoji}
      </span>

      <div className="flex-1 min-w-0">
        <p
          className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)]"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          {label}
        </p>
        <p
          className="text-sm font-extrabold text-[var(--color-text)] leading-snug"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          {title}
        </p>
        {subtitle && (
          <p
            className="text-xs text-[var(--color-muted)] mt-0.5"
            style={{ fontFamily: 'Nunito, sans-serif' }}
          >
            {subtitle}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-full text-[var(--color-muted)] hover:text-[var(--color-text)] active:scale-95 transition-transform"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ✕
        </span>
      </button>
    </motion.div>
  )
}
