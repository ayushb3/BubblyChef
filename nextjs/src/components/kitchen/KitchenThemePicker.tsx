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
 * The sheet is a `PixelSheet` (issue #743): backdrop, focus trap, Escape,
 * drag-dismiss and the close button all come from it.
 */
import { useEffect } from 'react'
import { KITCHEN_THEMES, type KitchenTheme } from '@/lib/kitchen/themes'
import PixelSheet from '@/components/ui/PixelSheet'

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
  /**
   * Clears `error` — called whenever the sheet opens (#598 review, finding
   * 2) so a failure from an earlier, already-reverted attempt doesn't keep
   * announcing itself (`role="alert"`) every time the sheet is reopened.
   */
  clearError?: () => void
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
  clearError,
}: KitchenThemePickerProps) {
  // Scope the error banner to this open — a failed save from a previous
  // visit must not still be sitting there, `role="alert"`, the next time
  // the sheet opens (#598 review, finding 2).
  useEffect(() => {
    if (isOpen) clearError?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

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

      <PixelSheet
        open={isOpen}
        onClose={onClose}
        title="Kitchen theme"
        titleId="kitchen-theme-picker-title"
        subheader={
          error ? (
            <p className="text-xs text-center text-[#ff9aa2]" role="alert">
              {error}
            </p>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2">
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
      </PixelSheet>
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
