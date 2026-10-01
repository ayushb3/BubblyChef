'use client'

/**
 * The storage sheet's List view (issue #750, board A4 "Fridge list" of the
 * Kitchen Home canvas): the old Pantry page, moved into the sheet. Every place
 * in one list, each place under a sticky heading with its count and its items
 * grouped by food category, soonest first. It is the plain list the PRD asks for
 * (bulk edits, screen readers): one list item per food, one labelled button
 * (or checkbox) in it.
 *
 * Two exports, because the sheet fixes the toolbar above the scrolling body:
 *  - `StorageListToolbar`: the Category and Expiry filters and the Select key,
 *    or, in select mode, "3 selected", "Select all" and "Done";
 *  - `StorageListBody`: the sections, and the empty and no-match states.
 *
 * Presentation only. The sheet owns the filters, the selection, and what a
 * resolve or a move does; this draws them. Rows are `StorageRow`.
 */
import { useMemo, type ReactNode, type Ref } from 'react'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FacetDropdown from '@/components/ui/FacetDropdown'
import { PIXEL_INK } from '@/components/ui/PixelPanel'
import PlaceSprite from '@/components/kitchen/PlaceSprite'
import { StorageRow, type RowResolve, type RowSelect } from '@/components/kitchen/StorageTile'
import {
  PLACES,
  categoryGroups,
  itemsInPlace,
  type KitchenStock,
  type PlaceKey,
  type StoredItem,
} from '@/lib/kitchen/places'
import type { WallPalette } from '@/lib/kitchen/themes'

/** The emoji each food-category heading carries in the Category filter. */
const HEADING_EMOJI: Record<string, string> = {
  Produce: '🥬',
  'Dairy and eggs': '🧈',
  'Meat and fish': '🍗',
  Frozen: '🧊',
  'Dry goods': '🌾',
  Cans: '🥫',
  'Jars and sauces': '🧂',
  Snacks: '🍿',
  Drinks: '🥤',
  Other: '📦',
}

export const EXPIRY_OPTIONS = [
  { value: 'expiring', label: 'Expiring soon', emoji: '⏳' },
  { value: 'expired', label: 'Expired', emoji: '⚠️' },
]

/**
 * The Category filter's options: the same headings the list groups by, so the
 * filter and the group titles can never drift apart (#228). Only the categories
 * the pantry actually holds are offered.
 */
export function categoryFacetOptions(items: readonly StoredItem[]) {
  return categoryGroups(items).map((g) => ({
    value: g.label,
    label: g.label,
    emoji: HEADING_EMOJI[g.label] ?? '📦',
  }))
}

const pillButton =
  'min-h-[44px] rounded-full border-2 px-4 text-[13px] leading-5 font-extrabold text-[color:var(--color-text)] disabled:opacity-50'

export interface StorageListToolbarProps {
  /** Select mode: ticking rows instead of opening them. */
  selecting: boolean
  selectedCount: number
  /** Rows that can be ticked right now (0 turns Select off). */
  selectableCount: number
  busy: boolean
  onEnterSelect: () => void
  onSelectAll: () => void
  onDone: () => void
  /** The filters; omitted for search results, which have their own text. */
  filters?: {
    categoryOptions: { value: string; label: string; emoji?: string }[]
    category: string[]
    expiry: string[]
    onCategory: (next: string[]) => void
    onExpiry: (next: string[]) => void
  }
  /** Text for the left of the Select key (search results: "5 matches in every place"). */
  caption?: ReactNode
}

export function StorageListToolbar({
  selecting,
  selectedCount,
  selectableCount,
  busy,
  onEnterSelect,
  onSelectAll,
  onDone,
  filters,
  caption,
}: StorageListToolbarProps) {
  if (selecting) {
    return (
      <div className="flex min-h-[44px] items-center gap-1">
        <span
          role="status"
          className="flex-1 text-[15px] leading-5 font-extrabold tabular-nums text-[color:var(--color-text)]"
        >
          {selectedCount} selected
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={busy || selectedCount === selectableCount}
          className="min-h-[44px] shrink-0 px-2.5 text-[13px] font-extrabold text-[color:var(--color-text)] underline underline-offset-[3px] disabled:opacity-50"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className={`${pillButton} shrink-0 shadow-[0_2px_0_var(--color-text)]`}
          style={{ borderColor: PIXEL_INK, background: 'var(--color-primary)' }}
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-[44px] items-center justify-between gap-2">
      {filters ? (
        <div className="flex min-w-0 flex-wrap gap-2 py-0.5 pr-1">
          <FacetDropdown
            triggerEmoji="🗂️"
            triggerLabel="Category"
            ariaLabel={`Filter by category${filters.category.length > 0 ? `, ${filters.category.length} selected` : ''}`}
            options={filters.categoryOptions}
            selected={filters.category}
            onChange={filters.onCategory}
          />
          <FacetDropdown
            triggerEmoji="⏳"
            triggerLabel="Expiry"
            ariaLabel={`Filter by expiry status${filters.expiry.length > 0 ? `, ${filters.expiry.length} selected` : ''}`}
            options={EXPIRY_OPTIONS}
            selected={filters.expiry}
            onChange={filters.onExpiry}
          />
        </div>
      ) : (
        <p role="status" className="min-w-0 text-sm leading-5 font-extrabold text-[color:var(--color-text)]">
          {caption}
        </p>
      )}
      <button
        type="button"
        onClick={onEnterSelect}
        disabled={selectableCount === 0}
        className={`${pillButton} shrink-0 shadow-[0_2px_0_var(--color-text)]`}
        style={{ borderColor: PIXEL_INK, background: 'var(--color-surface)' }}
      >
        Select
      </button>
    </div>
  )
}

export interface StorageListBodyProps<T extends StoredItem> {
  /** Every pantry row (for the empty state and the totals). */
  allItems: readonly T[]
  /** The rows the filters let through. */
  items: readonly T[]
  today: string
  palette: WallPalette
  /** What the wall draws in each place, for the headings' sprites (issue #794). */
  stock?: KitchenStock | null
  /** Prefix for heading ids, unique to the sheet. */
  idPrefix: string
  filtersActive: boolean
  onClearFilters: () => void
  /** Each place's section, so a tab can bring it into view. */
  sectionRef: (place: PlaceKey) => Ref<HTMLElement>
  daysOf: (item: T) => number | null
  rowProps: (item: T) => { select?: RowSelect; resolve?: RowResolve }
  onOpen: (item: T) => void
}

export function StorageListBody<T extends StoredItem>({
  allItems,
  items,
  today,
  palette,
  stock = null,
  idPrefix,
  filtersActive,
  onClearFilters,
  sectionRef,
  daysOf,
  rowProps,
  onOpen,
}: StorageListBodyProps<T>) {
  const sections = useMemo(
    () =>
      PLACES.map((p) => {
        const here = itemsInPlace(items, p.key)
        return { def: p, count: here.length, groups: categoryGroups(here, today) }
      }),
    [items, today],
  )

  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-10 text-center text-[color:var(--color-text)]">
        <div className="mb-2">
          <BubblesMascot state="surprised" size={88} />
        </div>
        <p className="text-base font-bold">Your pantry is empty!</p>
        <p className="text-sm font-semibold opacity-80">
          Scan a receipt or add items to get started.
        </p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-10 text-center text-[color:var(--color-text)]">
        <p className="text-base font-bold">No items match your filters</p>
        <p className="text-sm font-semibold opacity-80">Try different filters.</p>
        <button
          type="button"
          onClick={onClearFilters}
          className={`${pillButton} mt-3`}
          style={{ borderColor: PIXEL_INK, background: 'var(--color-surface)' }}
        >
          Clear filters
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <p className="py-1 text-xs leading-4 font-bold tabular-nums text-[color:var(--color-text)]">
        {filtersActive
          ? `${items.length} of ${allItems.length} items`
          : `All ${allItems.length} items`}{' '}
        · soonest first in each group
      </p>
      {sections.map(({ def, count, groups }) => {
        // With a filter on, a place with nothing left would only be noise.
        if (filtersActive && count === 0) return null
        const headingId = `${idPrefix}-${def.key}`
        return (
          <section
            key={def.key}
            ref={sectionRef(def.key)}
            aria-labelledby={headingId}
            data-place={def.key}
          >
            <h3
              id={headingId}
              className="sticky top-0 z-[1] flex items-center gap-2 border-b-2 px-2 pt-2 pb-1.5 text-base leading-[22px] font-bold text-[color:var(--color-text)]"
              style={{ borderColor: PIXEL_INK, background: 'var(--color-bg)' }}
            >
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center">
                <PlaceSprite place={def.key} palette={palette} stock={stock} />
              </span>
              {def.label} <span className="text-[13px] font-extrabold tabular-nums">{count}</span>
            </h3>
            {count === 0 ? (
              <p className="px-2 py-3 text-sm font-semibold text-[color:var(--color-text)] opacity-80">
                Nothing in the {def.label.toLowerCase()} yet.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <h4 className="px-2 pt-2.5 pb-1 text-xs leading-4 font-extrabold tracking-[0.04em] text-[color:var(--color-text)] uppercase">
                    {g.label} <span className="tabular-nums">{g.items.length}</span>
                  </h4>
                  <ul>
                    {g.items.map((item) => (
                      <StorageRow
                        key={item.id}
                        item={item}
                        days={daysOf(item)}
                        onOpen={() => onOpen(item)}
                        {...rowProps(item)}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        )
      })}
    </div>
  )
}
