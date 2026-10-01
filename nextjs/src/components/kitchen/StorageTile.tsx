'use client'

/**
 * The storage sheet's food tile and list row (issue #749, boards A2 "Tap the
 * fridge" and A4 "Fridge list" of the Kitchen Home canvas).
 *
 * Both are one real button: tapping opens the item's edit sheet. Each shows the
 * emoji, name, amount and, for food that needs using, the food tag (the expiry
 * pill: the same 0-3 day window and "strictly past is expired" rule as the
 * pantry, `expiryTag`). Colours are theme variables; the pill uses the
 * theme-invariant expiry tokens so "use soon" never turns green or pink with a
 * kitchen theme.
 *
 * Contract for `StorageSheet`:
 *  - `StorageTile`: `urgent` draws the "Use first" tile (ink edge and a 3 px
 *    hard shadow); the plain tile has a hairline edge.
 *  - `StorageRow`: `highlight` marks the typed text in the name, and `where`
 *    adds the "Fridge · Meat and fish" line a search result carries.
 *  - `ExpiryPill` renders nothing for food that is not expiring or expired.
 */
import type { CSSProperties } from 'react'
import { getFoodEmoji } from '@/lib/food-emoji'
import { expiryTag, type ExpiryTag } from '@/lib/food-tag'
import { formatAmount, titleCase } from '@/lib/format'
import { matchRange, type StoredItem } from '@/lib/kitchen/places'

const INK = 'var(--color-text)'

/** The pill's tag, only for food that needs using (expiring or expired). */
function attentionTag(days: number | null): ExpiryTag | null {
  const tag = expiryTag(days)
  return tag && tag.tone !== 'fresh' ? tag : null
}

/** "expires today", "expires in 3 days", "expired": the pill's meaning in words. */
function tagPhrase(tag: ExpiryTag): string {
  if (tag.tone === 'expired') return 'expired'
  return tag.label === 'Today' ? 'expires today' : `expires in ${tag.label}`
}

/** The accessible name of a tile or row: "Romaine, 1 head, expires today". */
function itemLabel(item: StoredItem, days: number | null): string {
  const tag = attentionTag(days)
  const amount = formatAmount(item.quantity, item.unit)
  return [titleCase(item.name), amount, tag ? tagPhrase(tag) : ''].filter(Boolean).join(', ')
}

export function ExpiryPill({ days, className = '' }: { days: number | null; className?: string }) {
  const tag = attentionTag(days)
  if (!tag) return null
  return (
    <span
      data-testid="storage-expiry-pill"
      data-tone={tag.tone}
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full px-2 py-px text-[11px] leading-[16px] font-extrabold whitespace-nowrap ${className}`}
      style={{
        background: `var(--color-${tag.tone})`,
        color: `var(--color-${tag.tone}-text)`,
      }}
    >
      {tag.label}
    </span>
  )
}

interface ItemProps {
  item: StoredItem
  /** Whole days to expiry (client-local), or `null` when no date is known. */
  days: number | null
  onOpen: (item: StoredItem) => void
}

export function StorageTile({
  item,
  days,
  urgent = false,
  onOpen,
}: ItemProps & { urgent?: boolean }) {
  const style: CSSProperties = urgent
    ? { borderColor: INK, boxShadow: `0 3px 0 ${INK}`, background: 'var(--color-surface)' }
    : { borderColor: 'var(--color-border)', background: 'var(--color-surface)' }
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={itemLabel(item, days)}
      data-testid="storage-tile"
      data-urgent={urgent ? 'true' : undefined}
      className="flex min-h-[44px] w-full min-w-0 flex-col items-start gap-[3px] rounded-xl border-2 px-2.5 py-2 text-left text-[color:var(--color-text)] active:translate-y-px motion-reduce:active:translate-y-0"
      style={style}
    >
      <span aria-hidden="true" className="text-[22px] leading-[26px]">
        {getFoodEmoji(item.name, item.category ?? undefined)}
      </span>
      <span
        aria-hidden="true"
        className="line-clamp-2 w-full text-[13px] leading-[17px] font-extrabold break-words"
      >
        {titleCase(item.name)}
      </span>
      <span aria-hidden="true" className="w-full truncate text-[11px] leading-[14px] font-bold">
        {formatAmount(item.quantity, item.unit)}
      </span>
      <ExpiryPill days={days} className="mt-0.5" />
    </button>
  )
}

/** The name with the typed text marked, as the search board does. */
function HighlightedName({ name, query }: { name: string; query: string }) {
  const range = matchRange(name, query)
  if (!range) return <>{name}</>
  const [start, end] = range
  return (
    <>
      {name.slice(0, start)}
      <mark
        className="rounded-sm px-px text-inherit"
        style={{ background: 'color-mix(in srgb, var(--color-primary) 60%, transparent)' }}
      >
        {name.slice(start, end)}
      </mark>
      {name.slice(end)}
    </>
  )
}

export function StorageRow({
  item,
  days,
  onOpen,
  highlight,
  where,
}: ItemProps & {
  highlight?: string
  /** "Fridge · Meat and fish": which place (and food group) a search result is in. */
  where?: string
}) {
  const name = titleCase(item.name)
  return (
    <li className="border-b border-[color:var(--color-border)] last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={where ? `${itemLabel(item, days)}, in the ${where.split(' · ')[0]}` : itemLabel(item, days)}
        data-testid="storage-row"
        className="flex min-h-[44px] w-full min-w-0 items-center gap-3 py-2 text-left text-[color:var(--color-text)]"
      >
        <span aria-hidden="true" className="shrink-0 text-[22px] leading-[26px]">
          {getFoodEmoji(item.name, item.category ?? undefined)}
        </span>
        <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-5 font-extrabold">
            {highlight ? <HighlightedName name={name} query={highlight} /> : name}
          </span>
          {where && (
            <span className="truncate text-xs leading-4 font-semibold opacity-80">
              {where}
            </span>
          )}
        </span>
        <ExpiryPill days={days} />
        <span
          aria-hidden="true"
          className="max-w-[28%] shrink-0 truncate text-right text-[13px] font-bold tabular-nums"
        >
          {formatAmount(item.quantity, item.unit)}
        </span>
      </button>
    </li>
  )
}
