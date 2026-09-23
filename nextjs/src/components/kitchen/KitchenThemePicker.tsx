'use client'

/**
 * "🎨" theme picker (issue #523).
 *
 * A small trigger button meant to sit anchored to a `relative` ancestor
 * around `KitchenScene` (see `HeroHome`) — it renders itself absolutely
 * positioned in the scene's top-left corner, clear of the `wall_shelf` slot
 * (`lib/kitchen/slots.ts` starts at `x:2, y:2`) by sitting just outside the
 * scene box rather than on top of it, the same "corner badge" idiom the
 * balance pill uses for the opposite corner.
 *
 * Opens a bottom sheet listing every `KITCHEN_THEMES` entry: unlocked ones
 * are selectable pill buttons, locked ones are greyed with "🫧 N to unlock".
 * Follows the same backdrop + drag-dismiss + focus-trap shape as
 * `PantryAddSheet`/`ThemePicker`.
 */
import { useRef } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { KITCHEN_THEMES, type KitchenTheme } from '@/lib/kitchen/themes'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'

export interface KitchenThemePickerProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  currentThemeKey: string
  /** Every currently-unlocked theme key, so locked rows can be told apart from unlocked ones. */
  unlockedKeys: Set<string>
  /** `null` while the balance is unknown — locked rows show "-- to unlock" rather than a wrong number. */
  balance: number | null
  onSelect: (key: string) => void
  saving?: boolean
  /** Set when the last selection failed to persist (issue #523 review, finding 4) — shown inline. */
  error?: string | null
}

export default function KitchenThemePicker({
  isOpen,
  onOpen,
  onClose,
  currentThemeKey,
  unlockedKeys,
  balance,
  onSelect,
  saving = false,
  error = null,
}: KitchenThemePickerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  useModalFocusTrap(isOpen, onClose, panelRef)

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Change kitchen theme"
        aria-haspopup="true"
        aria-expanded={isOpen}
        data-testid="kitchen-theme-trigger"
        className="absolute -top-2 -left-2 z-20 w-9 h-9 rounded-full flex items-center justify-center shadow-sm border border-[var(--color-border)] active:scale-95 transition-transform"
        style={{ background: 'var(--color-surface)' }}
      >
        <span aria-hidden="true">🎨</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-[60]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="kitchen-theme-picker-title"
              tabIndex={-1}
              className="fixed bottom-16 left-0 right-0 z-[60] rounded-t-3xl flex flex-col select-none outline-none"
              style={{ background: 'var(--color-surface)', maxHeight: 'calc(80vh - 64px)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.3 }}
              onDragEnd={(_e, info) => {
                if (info.offset.y > 80 || info.velocity.y > 500) onClose()
              }}
            >
              <div
                className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
              </div>

              <div className="px-6 pb-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <h2
                    id="kitchen-theme-picker-title"
                    className="text-lg font-extrabold text-[var(--color-text)]"
                  >
                    Kitchen theme
                  </h2>
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors text-xl leading-none px-1"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {error && (
                <p className="px-6 pb-2 text-xs text-center text-[#ff9aa2]" role="alert">
                  {error}
                </p>
              )}

              <div className="flex-1 overflow-y-auto px-6 pb-6 min-h-0 flex flex-col gap-2">
                {KITCHEN_THEMES.map((theme) => (
                  <ThemeRow
                    key={theme.key}
                    theme={theme}
                    isActive={theme.key === currentThemeKey}
                    isUnlocked={unlockedKeys.has(theme.key)}
                    balance={balance}
                    saving={saving}
                    onSelect={() => onSelect(theme.key)}
                  />
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

function ThemeRow({
  theme,
  isActive,
  isUnlocked,
  balance,
  saving,
  onSelect,
}: {
  theme: KitchenTheme
  isActive: boolean
  isUnlocked: boolean
  balance: number | null
  saving: boolean
  onSelect: () => void
}) {
  const remaining = balance !== null ? Math.max(0, theme.threshold - balance) : null

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!isUnlocked || saving}
      data-testid={`kitchen-theme-row-${theme.key}`}
      {...(isActive ? { 'aria-current': 'true' as const } : {})}
      className={`w-full px-4 py-3 flex items-center gap-3 rounded-2xl text-left transition-colors ${
        isUnlocked
          ? 'hover:bg-[var(--color-bg)]'
          : 'opacity-50 cursor-not-allowed'
      }`}
      style={{
        border: `1.5px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: isActive ? 'var(--color-bg)' : 'transparent',
      }}
    >
      <span
        aria-hidden="true"
        className="w-9 h-9 rounded-full flex-shrink-0"
        style={{ background: theme.background }}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-[var(--color-text)]">
          {theme.emoji} {theme.name}
        </span>
        {!isUnlocked && (
          <span className="block text-xs text-[var(--color-muted)]">
            🫧 {remaining !== null ? remaining : '--'} to unlock
          </span>
        )}
      </span>
      {isActive && (
        <span aria-hidden="true" className="text-[var(--color-primary)]">
          ✓
        </span>
      )}
    </button>
  )
}
