'use client'

/**
 * The storage sheet (issue #749, Goal 2 of the signature PRD): tap a place on
 * the kitchen wall and this opens over it, showing what is inside. Boards A2
 * "Tap the fridge: every storage place" and A4 "Fridge list" of the Kitchen
 * Home canvas, on the signature `PixelSheet`.
 *
 * Top to bottom:
 *  - header: the place's mini sprite, its name and "23 items · 3 to use soon",
 *    and the close button (all `PixelSheet`);
 *  - search: one field over every place, "Search all 65 items". While there is
 *    a query the tabs and views give way to the results, grouped by place, each
 *    row labelled with its place and food group;
 *  - Scene | List: the same place two ways. Scene is "Use first" (what needs
 *    attention by the Use Soon rules, with a key that seeds the plan-dinner
 *    chat) over category groups of tiles; List is plain rows. Switching never
 *    closes the sheet;
 *  - place tabs: Fridge / Freezer / Shelves / Basket, each with its count (the
 *    same `summarizePlaces` counts the wall's tags show);
 *  - footer: "Add to the <place>".
 *
 * Presentation only. The parent owns which place and view are showing (so the
 * `?place=&view=` deep link can set them), the pantry rows, and what edit and
 * add do; the search text is this sheet's own and clears when it closes.
 *
 * Contract for `HeroHome`:
 *  - `open`: the sheet is wanted. `suspended` hides it without ending the visit
 *    (an edit sheet is on top: two sheets cannot both trap focus), keeping the
 *    search text; the sheet comes back when it clears.
 *  - `items` + `status`: `loading` (no rows yet), `error` (`onRetry`), `ready`.
 *  - `onEdit(item)` opens the edit sheet; `onAdd(place)` opens the add sheet
 *    with that place preset; `onClose` is Escape, the scrim, the X and a drag.
 *  - `palette`: the kitchen theme's wall palette, for the place sprite.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import PixelSheet, { type PixelSheetProps } from '@/components/ui/PixelSheet'
import { PIXEL_INK } from '@/components/ui/PixelPanel'
import PlaceSprite from '@/components/kitchen/PlaceSprite'
import { StorageRow, StorageTile } from '@/components/kitchen/StorageTile'
import { planDinnerHref } from '@/lib/chat-seed'
import { localDateString } from '@/lib/date'
import {
  PLACES,
  categoryGroups,
  categoryHeading,
  itemsInPlace,
  pickUseFirst,
  placeDef,
  searchPlaces,
  sortSoonestFirst,
  summarizePlaces,
  type PlaceKey,
  type StoredItem,
} from '@/lib/kitchen/places'
import { daysUntilExpiryOn } from '@/lib/pantry-helpers'
import type { WallPalette } from '@/lib/kitchen/themes'

export type StorageView = 'scene' | 'list'

export const STORAGE_VIEWS: readonly StorageView[] = ['scene', 'list']

export function isStorageView(value: unknown): value is StorageView {
  return value === 'scene' || value === 'list'
}

export interface StorageSheetProps<T extends StoredItem> {
  open: boolean
  /** Hide the sheet without ending the visit (an edit sheet is on top). */
  suspended?: boolean
  place: PlaceKey
  view: StorageView
  /** Every pantry row, in every place; `null` until loaded. */
  items: readonly T[] | null
  status: 'loading' | 'error' | 'ready'
  palette: WallPalette
  /** Client-local `YYYY-MM-DD`; injected by tests, the clock otherwise. */
  today?: string
  onPlaceChange: (place: PlaceKey) => void
  onViewChange: (view: StorageView) => void
  onClose: () => void
  onEdit: (item: T) => void
  onAdd: (place: PlaceKey) => void
  onRetry: () => void
}

const pillButton = 'rounded-full border-2 font-extrabold text-[color:var(--color-text)]'

const HEADING =
  'text-[13px] leading-[18px] font-bold tracking-[0.025em] text-[color:var(--color-text)] uppercase'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Fridge, Freezer and Basket". */
function listPlaces(labels: string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  )
}

export default function StorageSheet<T extends StoredItem>({
  open,
  suspended = false,
  place,
  view,
  items,
  status,
  palette,
  today: todayProp,
  onPlaceChange,
  onViewChange,
  onClose,
  onEdit,
  onAdd,
  onRetry,
}: StorageSheetProps<T>) {
  const uid = useId()
  const inputId = `${uid}-search`
  const panelId = `${uid}-panel`
  const tabId = (key: PlaceKey) => `${uid}-tab-${key}`

  const [query, setQuery] = useState('')
  // The search text belongs to one visit: it clears when the sheet really closes
  // (not when it is only suspended behind the edit sheet).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setQuery('')
  }

  const rows = useMemo(() => items ?? [], [items])
  const today = todayProp ?? localDateString()
  const summaries = useMemo(() => summarizePlaces(rows, today), [rows, today])
  const def = placeDef(place)
  const summary = summaries[place]
  const searching = query.trim().length > 0

  const here = useMemo(() => itemsInPlace(rows, place), [rows, place])
  const useFirst = useMemo(() => pickUseFirst(here, today), [here, today])
  const useFirstIds = useMemo(() => new Set(useFirst.map((i) => i.id)), [useFirst])
  const sceneGroups = useMemo(
    () => categoryGroups(here.filter((i) => !useFirstIds.has(i.id)), today),
    [here, useFirstIds, today],
  )
  const listGroups = useMemo(() => categoryGroups(here, today), [here, today])
  const results = useMemo(() => searchPlaces(rows, query, today), [rows, query, today])

  const daysOf = (item: T) => daysUntilExpiryOn(item.expiry_date ?? null, today)

  // A different place, view or search starts at the top of the body.
  const topRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    topRef.current?.scrollIntoView?.({ block: 'start' })
  }, [place, view, searching])

  const tabRefs = useRef<Partial<Record<PlaceKey, HTMLButtonElement | null>>>({})
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = PLACES.findIndex((p) => p.key === place)
    let next = at
    if (e.key === 'ArrowRight') next = (at + 1) % PLACES.length
    else if (e.key === 'ArrowLeft') next = (at - 1 + PLACES.length) % PLACES.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = PLACES.length - 1
    else return
    e.preventDefault()
    const key = PLACES[next].key
    onPlaceChange(key)
    tabRefs.current[key]?.focus()
  }

  const addLabel = `Add to the ${def.label.toLowerCase()}`

  const subtitle: ReactNode =
    status !== 'ready' ? null : summary.count === 0 ? (
      'Nothing here yet'
    ) : (
      <>
        <span className="tabular-nums">{summary.count}</span> {summary.count === 1 ? 'item' : 'items'}
        {summary.useSoonCount > 0 && (
          <>
            {' · '}
            <span className="tabular-nums">{summary.useSoonCount}</span> to use soon
          </>
        )}
      </>
    )

  const subheader = (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div
          className="relative flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-xl border-2 px-3 text-[color:var(--color-text)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[color:var(--color-text)]"
          style={{ borderColor: PIXEL_INK, background: 'var(--color-surface)' }}
        >
          <SearchIcon />
          <label htmlFor={inputId} className="sr-only">
            Search the fridge, freezer, shelves and basket
          </label>
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears a query before it closes the sheet.
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
            placeholder={items ? `Search all ${rows.length} items` : 'Search all items'}
            autoComplete="off"
            enterKeyHint="search"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-[color:var(--color-text)] focus-visible:outline-none! placeholder:text-[color:var(--color-muted)] [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('')
                document.getElementById(inputId)?.focus()
              }}
              className="-mr-3 flex h-11 w-11 shrink-0 items-center justify-center"
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ background: 'var(--color-border)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </span>
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="View"
          className="flex shrink-0 overflow-hidden rounded-full border-2"
          style={{ borderColor: PIXEL_INK }}
        >
          {STORAGE_VIEWS.map((v, i) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => onViewChange(v)}
              className={`min-h-[40px] px-3 text-[13px] font-extrabold text-[color:var(--color-text)] ${
                i > 0 ? 'border-l-2' : ''
              }`}
              style={{
                borderColor: PIXEL_INK,
                background: view === v ? 'var(--color-primary)' : 'transparent',
              }}
            >
              {v === 'scene' ? 'Scene' : 'List'}
            </button>
          ))}
        </div>
      </div>

      {!searching && (
        <div
          role="tablist"
          aria-label="Storage"
          onKeyDown={onTabKey}
          className="flex overflow-hidden rounded-full border-2 text-[13px] font-extrabold"
          style={{ borderColor: PIXEL_INK }}
        >
          {PLACES.map((p, i) => {
            const selected = p.key === place
            const count = summaries[p.key].count
            return (
              <button
                key={p.key}
                ref={(el) => {
                  tabRefs.current[p.key] = el
                }}
                id={tabId(p.key)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                aria-label={status === 'ready' ? `${p.label}, ${plural(count, 'item', 'items')}` : p.label}
                tabIndex={selected ? 0 : -1}
                onClick={() => onPlaceChange(p.key)}
                className={`min-h-[44px] min-w-0 flex-1 px-1 whitespace-nowrap text-[color:var(--color-text)] ${
                  i > 0 ? 'border-l-2' : ''
                }`}
                style={{
                  borderColor: PIXEL_INK,
                  background: selected ? 'var(--color-primary)' : 'transparent',
                }}
              >
                {p.label}
                {status === 'ready' && (
                  <>
                    {' '}
                    <span className="tabular-nums">{count}</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  const footer = (
    <button
      type="button"
      onClick={() => onAdd(place)}
      className={`${pillButton} flex min-h-[44px] w-full items-center justify-center px-[18px] py-2.5 text-sm leading-5 font-bold whitespace-nowrap active:translate-y-px motion-reduce:active:translate-y-0`}
      style={{
        borderColor: PIXEL_INK,
        background: 'var(--color-primary)',
        boxShadow: `0 3px 0 ${PIXEL_INK}`,
      }}
    >
      {addLabel}
    </button>
  )

  // ── body ────────────────────────────────────────────────────────────────
  let body: ReactNode
  if (status === 'loading') {
    body = (
      <div role="status" className="flex flex-col gap-3 pt-2" aria-busy="true">
        <span className="sr-only">Loading your pantry</span>
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            aria-hidden="true"
            className="block h-16 animate-pulse rounded-xl motion-reduce:animate-none"
            style={{ background: 'var(--color-border)' }}
          />
        ))}
      </div>
    )
  } else if (status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p role="alert" className="text-sm font-bold text-[color:var(--color-text)]">
          Couldn&apos;t load your pantry.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className={`${pillButton} min-h-[44px] px-5 text-sm`}
          style={{ borderColor: PIXEL_INK, background: 'var(--color-surface)' }}
        >
          Try again
        </button>
      </div>
    )
  } else if (searching) {
    const empty = results.groups.filter((g) => g.items.length === 0).map((g) => g.label)
    body = (
      <div className="flex flex-col gap-2">
        <p role="status" className="py-1 text-sm font-bold text-[color:var(--color-text)]">
          {results.total === 0
            ? `No matches for “${query.trim()}”`
            : `${plural(results.total, 'match', 'matches')} in every place`}
        </p>
        {results.groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <section key={g.key} aria-labelledby={`${uid}-res-${g.key}`}>
              <h3
                id={`${uid}-res-${g.key}`}
                className="flex items-center gap-2 border-b-2 pt-2 pb-1.5 text-base leading-6 font-bold text-[color:var(--color-text)]"
                style={{ borderColor: PIXEL_INK }}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <PlaceSprite place={g.key} palette={palette} />
                </span>
                {g.label} <span className="tabular-nums">{g.items.length}</span>
              </h3>
              <ul>
                {g.items.map((item) => (
                  <StorageRow
                    key={item.id}
                    item={item}
                    days={daysOf(item)}
                    highlight={query}
                    where={`${g.label} · ${categoryHeading(item.category)}`}
                    onOpen={() => onEdit(item)}
                  />
                ))}
              </ul>
            </section>
          ))}
        {results.total > 0 && empty.length > 0 && (
          <p className="pt-2 text-sm font-semibold text-[color:var(--color-text)]">
            {listPlaces(empty)}: nothing matches.
          </p>
        )}
      </div>
    )
  } else if (here.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-1 py-10 text-center text-[color:var(--color-text)]">
        <div aria-hidden="true" className="mb-2 h-16 w-16">
          <PlaceSprite place={place} palette={palette} />
        </div>
        <p className="text-base font-bold">Nothing in the {def.label.toLowerCase()} yet.</p>
        <p className="text-sm font-semibold opacity-80">Add something with the button below.</p>
      </div>
    )
  } else if (view === 'scene') {
    body = (
      <div className="flex flex-col gap-3.5">
        {useFirst.length > 0 && (
          <section aria-labelledby={`${uid}-use-first`} className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 id={`${uid}-use-first`} className={HEADING}>
                Use first
              </h3>
              <Link
                href={planDinnerHref(useFirst.map((i) => i.name))}
                className={`${pillButton} relative inline-flex min-h-8 items-center px-3 py-1 text-xs before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']`}
                style={{
                  borderColor: PIXEL_INK,
                  background: 'var(--color-primary)',
                  boxShadow: `0 2px 0 ${PIXEL_INK}`,
                }}
              >
                Plan dinner around these
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2 pb-[3px]">
              {useFirst.map((item) => (
                <StorageTile
                  key={item.id}
                  item={item}
                  days={daysOf(item)}
                  urgent
                  onOpen={() => onEdit(item)}
                />
              ))}
            </div>
          </section>
        )}
        {sceneGroups.map((g, gi) => (
          <section key={g.label} aria-labelledby={`${uid}-grp-${gi}`} className="flex flex-col gap-1.5">
            <h3 id={`${uid}-grp-${gi}`} className={HEADING}>
              {g.label}
            </h3>
            <div className="grid grid-cols-4 gap-1.5">
              {g.items.map((item) => (
                <StorageTile key={item.id} item={item} days={daysOf(item)} onOpen={() => onEdit(item)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <p className="py-1 text-[13px] font-semibold text-[color:var(--color-text)] opacity-80">
          {plural(here.length, 'item', 'items')} in the {def.label.toLowerCase()} · soonest first in
          each group
        </p>
        {listGroups.map((g, gi) => (
          <section key={g.label} aria-labelledby={`${uid}-lst-${gi}`}>
            <h3
              id={`${uid}-lst-${gi}`}
              className={`${HEADING} border-b-2 pt-1 pb-1`}
              style={{ borderColor: PIXEL_INK }}
            >
              {g.label} <span className="tabular-nums">{g.items.length}</span>
            </h3>
            <ul>
              {sortSoonestFirst(g.items, today).map((item) => (
                <StorageRow key={item.id} item={item} days={daysOf(item)} onOpen={() => onEdit(item)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  const sheetProps: Omit<PixelSheetProps, 'children'> = {
    open: open && !suspended,
    onClose,
    title: def.label,
    titleId: 'storage-sheet-title',
    subtitle,
    icon: <PlaceSprite place={place} palette={palette} />,
    subheader,
    footer,
    panelClassName: 'h-[84dvh]',
    testId: 'storage-sheet',
  }

  return (
    <PixelSheet {...sheetProps}>
      <div ref={topRef} />
      <div
        id={panelId}
        role={searching ? undefined : 'tabpanel'}
        aria-labelledby={searching ? undefined : tabId(place)}
        className="pt-1"
      >
        {body}
      </div>
    </PixelSheet>
  )
}
