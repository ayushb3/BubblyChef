'use client'

import type { ManualRow } from './AddItemRow'

/**
 * Fallback icon per category, for rows filled by hand rather than via the
 * catalog autocomplete (issue #398) — those carry `row.emoji` already.
 */
const CATEGORY_EMOJI: Record<string, string> = {
  produce: '🥦',
  dairy: '🥛',
  meat: '🥩',
  dry_goods: '🌾',
  condiments: '🧂',
  snacks: '🍪',
  beverages: '🥤',
  frozen: '🧊',
  other: '📦',
}

const CATEGORY_LABEL: Record<string, string> = {
  produce: 'Produce',
  dairy: 'Dairy',
  meat: 'Meat',
  dry_goods: 'Dry Goods',
  condiments: 'Condiments',
  snacks: 'Snacks',
  beverages: 'Beverages',
  frozen: 'Frozen',
  other: 'Other',
}

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category
}

interface AddItemRowSummaryProps {
  row: ManualRow
  index: number
  onExpand: () => void
  onRemove: () => void
}

/**
 * Compact, tappable stand-in for a filled `AddItemRow` (issue #404) — keeps
 * the manual "add a few things" flow scannable instead of stacking full
 * forms. The row's data lives in `TypeTab`'s state regardless of whether
 * this summary or the full form is on screen, so swapping between them
 * never touches (or loses) the underlying values — see `TypeTab.tsx`.
 *
 * Disclosure semantics: a real `<button>` (native keyboard + screen-reader
 * support, no bare `onClick` div — issue #394) with `aria-expanded={false}`
 * announcing that activating it opens the full row.
 */
export default function AddItemRowSummary({
  row,
  index,
  onExpand,
  onRemove,
}: AddItemRowSummaryProps) {
  const emoji = row.emoji || CATEGORY_EMOJI[row.category] || CATEGORY_EMOJI.other
  const summaryText = `${row.quantity} ${row.unit} · ${categoryLabel(row.category)}`

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    // Belt-and-suspenders: real <button>s already do this natively in a
    // browser, but jsdom (and some AT bridges) don't simulate the default
    // action for a keydown, so we drive it explicitly too.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onExpand()
    }
  }

  return (
    <div className="flex items-center gap-2 bg-white rounded-2xl border border-[var(--color-border)] pl-1 pr-1">
      <button
        type="button"
        onClick={onExpand}
        onKeyDown={handleKeyDown}
        aria-expanded={false}
        aria-label={`Edit item ${index + 1}: ${row.name}, ${summaryText}`}
        className="flex-1 flex items-center gap-2 min-w-0 text-left px-2 py-3 rounded-2xl hover:bg-[var(--color-bg,rgba(0,0,0,0.02))] transition-colors"
      >
        <span aria-hidden="true" className="text-lg leading-none flex-shrink-0">
          {emoji}
        </span>
        <span className="flex-1 min-w-0 truncate font-semibold text-sm text-[var(--color-text)] capitalize">
          {row.name}
        </span>
        <span className="text-xs text-[var(--color-muted)] flex-shrink-0">{summaryText}</span>
        <span aria-hidden="true" className="text-[var(--color-muted)] flex-shrink-0">
          ▸
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-xs text-[var(--color-muted)] hover:text-red-400 transition-colors px-2 py-2 rounded-full flex-shrink-0"
        aria-label={`Remove item ${index + 1}`}
      >
        ✕
      </button>
    </div>
  )
}
