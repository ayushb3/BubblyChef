'use client'

/**
 * One-time "new kitchen theme unlocked" card (issue #523).
 *
 * Mirrors `UnlockOffer`'s shape (a dismissible card mounted under
 * `KitchenScene`) but for the bigger theme milestones. Driven entirely by
 * `useKitchenTheme`'s `newlyUnlocked` — renders nothing once dismissed or
 * once there's nothing new to show, same "must never shift layout on a
 * plain load" contract `UnlockOffer` documents.
 */
import { AnimatePresence, motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import type { KitchenTheme } from '@/lib/kitchen/themes'

export interface KitchenThemeUnlockCardProps {
  theme: KitchenTheme | null
  onTryIt: () => void
  onDismiss: () => void
}

export default function KitchenThemeUnlockCard({
  theme,
  onTryIt,
  onDismiss,
}: KitchenThemeUnlockCardProps) {
  return (
    <AnimatePresence>
      {theme && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          role="status"
          data-testid="kitchen-theme-unlock-card"
          className="w-full max-w-[480px] mb-4 rounded-2xl p-4 border border-[var(--color-border)] flex items-center justify-between gap-3"
          style={{ background: 'var(--color-surface)' }}
        >
          <p className="text-sm font-semibold text-[var(--color-text)]">
            New kitchen theme: {theme.name} {theme.emoji}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <SpringButton
              onClick={onTryIt}
              className="text-xs font-bold px-3 py-2 rounded-full text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              Try it
            </SpringButton>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors text-lg leading-none px-1"
            >
              ✕
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
