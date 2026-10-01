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
 *    adds the "Fridge · Meat and fish" line a search result carries. `select`
 *    makes it a checkbox row (select mode, issue #750); `resolve` adds the old
 *    Pantry page's actions (Used up / Tossed buttons, "Cook this", or the swipe).
 *  - `ExpiryPill` renders nothing for food that is not expiring or expired.
 */
import type { CSSProperties } from 'react'
import Link from 'next/link'
import ResolveActions from '@/components/pantry/ResolveActions'
import SwipeToResolve from '@/components/pantry/SwipeToResolve'
import type { ResolveOutcome } from '@/lib/api/pantry'
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
      className="flex min-h-[44px] w-full min-w-0 flex-col items-start gap-[3px] rounded-xl border-2 px-2 py-2 text-left text-[color:var(--color-text)] active:translate-y-px motion-reduce:active:translate-y-0"
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

/** What a row needs to be ticked in select mode. */
export interface RowSelect {
  selected: boolean
  onToggle: () => void
}

/** What a row needs to be resolved in place (the old Pantry page's actions). */
export interface RowResolve {
  /** A resolve of this item is in flight: its buttons are off. */
  pending: boolean
  /** The visible Used up / Tossed buttons, not the swipe (urgency, or reduced motion). */
  showButtons: boolean
  /** "Cook this": a chat seeded with this item, for food that is expiring soon. */
  cookHref?: string
  onResolve: (outcome: ResolveOutcome) => void
}

/** A row's content: emoji, name (and where it is, for a search hit), tag, amount. */
function RowFace({
  item,
  days,
  highlight,
  where,
}: {
  item: StoredItem
  days: number | null
  highlight?: string
  where?: string
}) {
  const name = titleCase(item.name)
  return (
    <>
      <span aria-hidden="true" className="w-[26px] shrink-0 text-center text-[20px] leading-6">
        {getFoodEmoji(item.name, item.category ?? undefined)}
      </span>
      <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] leading-[19px] font-extrabold">
          {highlight ? <HighlightedName name={name} query={highlight} /> : name}
        </span>
        {where && (
          <span className="truncate text-xs leading-4 font-semibold opacity-80">{where}</span>
        )}
      </span>
      <ExpiryPill days={days} />
      <span
        aria-hidden="true"
        className="max-w-[28%] min-w-[58px] shrink-0 truncate text-right text-[13px] leading-[18px] font-bold tabular-nums"
      >
        {formatAmount(item.quantity, item.unit)}
      </span>
    </>
  )
}

const ROW_FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-text)]'

const ROW_BORDER = 'border-b border-[color:var(--color-border)]'

/**
 * A list row. Three ways to be one:
 *  - plain: one button, tap to edit;
 *  - `select`: a checkbox row (select mode), tap to tick. The real checkbox is
 *    visually hidden so a screen reader and the keyboard get a native control;
 *  - `resolve`: the pantry page's resolve actions, in place. Food that needs
 *    using shows Used up / Tossed (and Cook this); everything else resolves by
 *    the graduated swipe, which keeps ordinary rows clean (#140).
 */
export function StorageRow({
  item,
  days,
  onOpen,
  highlight,
  where,
  select,
  resolve,
}: ItemProps & {
  highlight?: string
  /** "Fridge · Meat and fish": which place (and food group) a search result is in. */
  where?: string
  select?: RowSelect
  resolve?: RowResolve
}) {
  const label = where
    ? `${itemLabel(item, days)}, in the ${where.split(' · ')[0]}`
    : itemLabel(item, days)

  if (select) {
    return (
      <li className={ROW_BORDER}>
        <label
          data-testid="storage-row"
          className="relative flex min-h-[44px] w-full min-w-0 cursor-pointer items-center gap-2.5 px-2 py-1 text-[color:var(--color-text)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-[color:var(--color-text)]"
          style={{
            background: select.selected
              ? 'color-mix(in srgb, var(--color-primary) 40%, transparent)'
              : undefined,
          }}
        >
          <input
            type="checkbox"
            checked={select.selected}
            onChange={select.onToggle}
            aria-label={label}
            className="sr-only"
          />
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2"
            style={{
              borderColor: INK,
              background: select.selected ? 'var(--color-primary)' : 'var(--color-surface)',
            }}
          >
            {select.selected && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
          </span>
          <RowFace item={item} days={days} highlight={highlight} where={where} />
        </label>
      </li>
    )
  }

  const button = (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={label}
      data-testid="storage-row"
      className={`flex min-h-[44px] w-full min-w-0 items-center gap-2.5 px-2 py-1 text-left text-[color:var(--color-text)] ${ROW_FOCUS}`}
    >
      <RowFace item={item} days={days} highlight={highlight} where={where} />
    </button>
  )

  if (!resolve) return <li className={ROW_BORDER}>{button}</li>

  if (resolve.showButtons) {
    return (
      <li className={ROW_BORDER}>
        {button}
        {/* One strip under the row: Cook this, Used it, Tossed. */}
        <ResolveActions
          variant="pills"
          itemName={item.name}
          pending={resolve.pending}
          onResolve={resolve.onResolve}
          leading={
            resolve.cookHref && (
              <Link
                href={resolve.cookHref}
                aria-label={`Cook this ${item.name}`}
                // A full 44px tap target around the small label (WCAG 2.5.5).
                className={`flex min-h-[44px] flex-1 items-center justify-center rounded-full border-2 border-[color:var(--color-text)] bg-[color:var(--color-primary)] px-2 text-center text-xs font-extrabold whitespace-nowrap text-[color:var(--color-text)] shadow-[0_2px_0_var(--color-text)] active:translate-y-px ${ROW_FOCUS}`}
              >
                🍳 Cook this
              </Link>
            )
          }
        />
      </li>
    )
  }

  return (
    <li className={ROW_BORDER}>
      <SwipeToResolve
        itemName={item.name}
        pending={resolve.pending}
        onResolve={resolve.onResolve}
        className="rounded-none"
        contentClassName="bg-[var(--color-bg)]"
      >
        {button}
      </SwipeToResolve>
    </li>
  )
}
