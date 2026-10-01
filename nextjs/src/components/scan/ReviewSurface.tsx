'use client'

import { useState } from 'react'
import type { ScannedItemWithId } from '@/lib/scan-helpers'
import { scanItemPlace } from '@/lib/scan-helpers'
import { PLACES, type PlaceDef } from '@/lib/kitchen/places'
import { getFoodEmoji } from '@/lib/food-emoji'
import Chip from '@/components/ui/Chip'
import SpringButton from '@/components/ui/SpringButton'
import ScannedItemCard from './ScannedItemCard'
import ItemEditor from './ItemEditor'

/**
 * ReviewSurface: the tiered receipt review, as put-away (issue #753, board A3).
 *
 * Presentation-only, as it has been since issue #259: no fetching, no routing,
 * no write. The same three tiers as before, regrouped by where the shopping goes
 * and worded as putting it away:
 *
 *  - the needs-review tier is **"Did I read these right?"**: one card per item
 *    with the receipt line and "→ <Place>", and Fix / Yes (`ScannedItemCard`);
 *  - the ready tier is **"Going in"**, grouped by place (Fridge 4, Freezer 1,
 *    Shelves 2, Basket 2), each group with Edit;
 *  - the skipped tier is **"Skipped N lines"** (bag fee, tax) with Show, which
 *    lists them, each with a way to add it back.
 *
 * What goes in is Going in, and only that: a line still being asked about stays
 * out until it is answered (Yes, or Fix then Done, both move it into Going in), as
 * the issue's "keeps its tiers and its confirm semantics" has it. The host's
 * confirm key, not this surface, does the writing, and names the count. Skipped
 * lines never go in unless added back (which asks about them first).
 *
 * Every change (Yes, Fix, a moved place, leaving an item out, adding a skipped
 * line back) goes out whole through `onChange`, so a host that persists the
 * tiers (the pending put-away record) takes one write per tap.
 */
export interface PutAwayTiers {
  readyToAdd: ScannedItemWithId[]
  needsReview: ScannedItemWithId[]
  skipped: ScannedItemWithId[]
}

export interface ReviewSurfaceProps extends PutAwayTiers {
  warnings?: string[]
  onChange: (next: PutAwayTiers) => void
  /** Locks every control (a write is in flight). */
  disabled?: boolean
  /**
   * The parse judged the image not to be a receipt (issue #856). The tiers are
   * held back behind a notice with "Try another photo" first and "Use it anyway"
   * second; the host owns what each does (and keeps its write off meanwhile).
   */
  notReceipt?: boolean
  onTryAnother?: () => void
  onUseAnyway?: () => void
}

const HEADING =
  'text-[13px] leading-[18px] font-bold tracking-[0.025em] text-[color:var(--color-text)] uppercase tabular-nums'

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function replaceItem(list: ScannedItemWithId[], updated: ScannedItemWithId): ScannedItemWithId[] {
  return list.map((i) => (i._id === updated._id ? updated : i))
}

function without(list: ScannedItemWithId[], id: string): ScannedItemWithId[] {
  return list.filter((i) => i._id !== id)
}

/** The skipped lines' names, for the one-line summary ("bag fee, tax"). */
function skippedNames(skipped: ScannedItemWithId[]): string {
  const names = skipped.map((i) => i.name)
  return names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ')
}

export default function ReviewSurface({
  readyToAdd,
  needsReview,
  skipped,
  warnings = [],
  onChange,
  disabled = false,
  notReceipt = false,
  onTryAnother,
  onUseAnyway,
}: ReviewSurfaceProps) {
  // Which items have their editor open: a Fix card, or a group in Edit.
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set())
  const [showSkipped, setShowSkipped] = useState(false)

  const tiers: PutAwayTiers = { readyToAdd, needsReview, skipped }
  // Not a receipt (#856): ask first; the tiers come back once the host says use it.
  const askFirst = notReceipt && !!onTryAnother && !!onUseAnyway

  function setEditingFor(ids: string[], on: boolean) {
    setEditing((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  /** Yes, or Done on a fixed line: the item moves from asked-about into Going in. */
  function answer(item: ScannedItemWithId) {
    setEditingFor([item._id], false)
    onChange({
      ...tiers,
      needsReview: without(needsReview, item._id),
      readyToAdd: [...readyToAdd, item],
    })
  }

  function leaveOut(id: string) {
    setEditingFor([id], false)
    onChange({ ...tiers, readyToAdd: without(readyToAdd, id), needsReview: without(needsReview, id) })
  }

  const groups: Array<{ place: PlaceDef; items: ScannedItemWithId[] }> = PLACES.map((place) => ({
    place,
    items: readyToAdd.filter((i) => scanItemPlace(i) === place.key),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <div
          role="status"
          className="space-y-1 rounded-xl border-2 border-[color:var(--color-expiring-text)] bg-[var(--color-expiring)] px-3 py-2 text-[13px] font-bold text-[color:var(--color-expiring-text)]"
        >
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {askFirst && onTryAnother && onUseAnyway && (
        <section
          role="group"
          aria-label="This doesn't look like a receipt"
          className="flex flex-col gap-2 rounded-xl border-2 border-[color:var(--color-border)] bg-[var(--color-surface)] px-3 py-3"
        >
          <h3 className={HEADING}>This doesn&apos;t look like a receipt</h3>
          <p className="text-[13px] font-bold text-[color:var(--color-text)]">
            Nothing has been added. Try a photo of the receipt, or use what I read anyway.
          </p>
          <div className="flex flex-wrap gap-2">
            <SpringButton size="sm" disabled={disabled} onClick={onTryAnother}>
              Try another photo
            </SpringButton>
            <SpringButton size="sm" variant="secondary" disabled={disabled} onClick={onUseAnyway}>
              Use it anyway
            </SpringButton>
          </div>
        </section>
      )}

      {!askFirst && needsReview.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className={HEADING}>Did I read these right? {needsReview.length}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {needsReview.map((item, i) => (
                <ScannedItemCard
                  key={item._id}
                  item={item}
                  index={i}
                  editing={editing.has(item._id)}
                  disabled={disabled}
                  onFix={() => setEditingFor([item._id], !editing.has(item._id))}
                  onYes={() => answer(item)}
                  onDone={() => answer(item)}
                  onChange={(updated) =>
                    onChange({ ...tiers, needsReview: replaceItem(needsReview, updated) })
                  }
                  onLeaveOut={() => leaveOut(item._id)}
                />
            ))}
          </ul>
        </section>
      )}

      {!askFirst && readyToAdd.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className={HEADING}>Going in {readyToAdd.length}</h3>
          {groups.map(({ place, items }) => {
            const ids = items.map((i) => i._id)
            const groupEditing = items.some((i) => editing.has(i._id))
            return (
              <div
                key={place.key}
                role="group"
                aria-label={`${place.label}, ${items.length} ${plural(items.length, 'item', 'items')}`}
                className={groupEditing ? 'flex flex-col gap-1.5' : 'flex items-start gap-2.5'}
              >
                <span
                  className={`${groupEditing ? '' : 'w-[84px] shrink-0 pt-1 '}text-xs font-extrabold tracking-[0.025em] text-[color:var(--color-text)] uppercase tabular-nums`}
                >
                  {place.label} {items.length}
                </span>
                {groupEditing ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {items.map((item) => (
                        <div
                          key={item._id}
                          className="rounded-xl border border-[color:var(--color-border)] bg-[var(--color-surface)] px-3 pb-2"
                        >
                          <p className="pt-2 text-[13px] font-bold text-[color:var(--color-text)]">
                            <span aria-hidden="true">{getFoodEmoji(item.name, item.category)} </span>
                            {item.name}
                          </p>
                          <ItemEditor
                            item={item}
                            disabled={disabled}
                            onChange={(updated) =>
                              onChange({ ...tiers, readyToAdd: replaceItem(readyToAdd, updated) })
                            }
                            onPlaceChanged={() => setEditingFor([item._id], false)}
                            onLeaveOut={() => leaveOut(item._id)}
                          />
                        </div>
                    ))}
                    <div className="flex">
                      <SpringButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditingFor(ids, false)}
                        aria-label={`Done editing ${place.label}`}
                      >
                        Done
                      </SpringButton>
                    </div>
                  </div>
                ) : (
                  <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap items-center gap-1.5 p-0">
                    {items.map((item) => (
                      <li key={item._id} data-putaway-item={item._id} className="min-w-0 max-w-full">
                        <Chip tone="muted" emoji={getFoodEmoji(item.name, item.category)}>
                          {item.name}
                        </Chip>
                      </li>
                    ))}
                    <li>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setEditingFor(ids, true)}
                        aria-label={`Edit ${place.label} items`}
                        className="-my-3 px-1 py-3 text-xs font-extrabold text-[color:var(--color-text)] underline disabled:opacity-60"
                      >
                        Edit
                      </button>
                    </li>
                  </ul>
                )}
              </div>
            )
          })}
        </section>
      )}

      {!askFirst && skipped.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-xs leading-4 font-bold text-[color:var(--color-text)] tabular-nums">
            Skipped {skipped.length} {plural(skipped.length, 'line', 'lines')}: {skippedNames(skipped)}.{' '}
            <button
              type="button"
              onClick={() => setShowSkipped((s) => !s)}
              aria-expanded={showSkipped}
              aria-label={showSkipped ? 'Hide skipped lines' : 'Show skipped lines'}
              className="-my-3 px-1 py-3 underline"
            >
              {showSkipped ? 'Hide' : 'Show'}
            </button>
          </p>
          {showSkipped && (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {skipped.map((item) => (
                <li
                  key={item._id}
                  className="flex items-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-[15px] font-bold text-[color:var(--color-text)]">
                    {item.source_line || item.name}
                  </span>
                  {item.price !== null && item.price !== undefined && (
                    <span className="shrink-0 text-xs font-bold text-[color:var(--color-text)] tabular-nums">
                      ${item.price.toFixed(2)}
                    </span>
                  )}
                  <SpringButton
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    aria-label={`Add ${item.name}`}
                    onClick={() =>
                      onChange({
                        ...tiers,
                        skipped: without(skipped, item._id),
                        needsReview: [...needsReview, item],
                      })
                    }
                  >
                    Add
                  </SpringButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
