'use client'

import { motion } from 'framer-motion'
import { useMotionConfig } from '@/lib/motion'

interface CookingContextCardProps {
  title: string
  ingredientCount: number
  onDismiss: () => void
}

/**
 * Shown at the top of the chat thread after the user starts cooking a recipe,
 * so they can see what Bubbles is answering about without scrolling back.
 *
 * Dismissible because the handoff is a convenience, not a mode the user should
 * be stuck in — dismissing also drops the ?cooking= param so a refresh does not
 * bring the card back.
 */
export default function CookingContextCard({
  title,
  ingredientCount,
  onDismiss,
}: CookingContextCardProps) {
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
        🍳
      </span>

      <div className="flex-1 min-w-0">
        <p
          className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)]"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          Cooking now
        </p>
        <p
          className="truncate text-sm font-extrabold text-[var(--color-text)] leading-snug"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          {title}
        </p>
        {ingredientCount > 0 && (
          <p
            className="text-xs text-[var(--color-muted)] mt-0.5"
            style={{ fontFamily: 'Nunito, sans-serif' }}
          >
            {ingredientCount} {ingredientCount === 1 ? 'ingredient' : 'ingredients'} · ask me
            anything about it
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss cooking context"
        className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-full text-[var(--color-muted)] hover:text-[var(--color-text)] active:scale-95 transition-transform"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ✕
        </span>
      </button>
    </motion.div>
  )
}
