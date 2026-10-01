'use client'

/**
 * The put-away item editor (issue #753): the inline "Fix" / "Edit" form for one
 * scanned item. It edits what the issue lists (the name, the quantity and the
 * place) and can leave the item out of the shopping. The unit and category the
 * AI read ride along unchanged.
 *
 * Presentation-only, like the rest of the scan review: every edit goes back out
 * through `onChange` as a whole item, and nothing here writes anywhere.
 *
 * Text is kept locally while it is typed and only committed when it is valid: a
 * cleared name or a quantity that is not a positive number never replaces the
 * real value, and on blur the field snaps back to it. So the item can never hold
 * a nameless or zero-quantity row that would fail the pantry write.
 */
import { useState } from 'react'
import { PLACES, type PlaceKey } from '@/lib/kitchen/places'
import { scanItemPlace, withScanPlace, type ScannedItemWithId } from '@/lib/scan-helpers'
import SpringButton from '@/components/ui/SpringButton'

const FIELD =
  'min-h-[44px] w-full rounded-xl border-2 border-[color:var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-bold text-[color:var(--color-text)] transition-colors focus:border-[color:var(--color-text)] focus-visible:outline-none disabled:opacity-60'

export interface ItemEditorProps {
  item: ScannedItemWithId
  onChange: (updated: ScannedItemWithId) => void
  /** Drop the item from the shopping (it is not put away). */
  onLeaveOut: () => void
  /** Shows a "Done" key that closes the editor. Group editing has its own. */
  onDone?: () => void
  /** Fires after the place changes (the item has moved between groups). */
  onPlaceChanged?: (place: PlaceKey) => void
  disabled?: boolean
}

export default function ItemEditor({
  item,
  onChange,
  onLeaveOut,
  onDone,
  onPlaceChanged,
  disabled = false,
}: ItemEditorProps) {
  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(String(item.quantity))
  const place = scanItemPlace(item)

  return (
    <div role="group" aria-label={`Edit ${item.name}`} className="flex flex-col gap-2 pt-2">
      <div className="flex gap-2">
        <input
          type="text"
          aria-label="Item name"
          value={name}
          disabled={disabled}
          onChange={(e) => {
            setName(e.target.value)
            const next = e.target.value.trim()
            if (next) onChange({ ...item, name: next })
          }}
          onBlur={() => setName(item.name)}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <input
          type="number"
          inputMode="decimal"
          aria-label="Quantity"
          min={0}
          step="any"
          value={qty}
          disabled={disabled}
          onChange={(e) => {
            setQty(e.target.value)
            const next = parseFloat(e.target.value)
            if (Number.isFinite(next) && next > 0) onChange({ ...item, quantity: next })
          }}
          onBlur={() => setQty(String(item.quantity))}
          className={`${FIELD} w-20 shrink-0`}
        />
      </div>

      <div role="radiogroup" aria-label="Place" className="flex flex-wrap gap-1.5">
        {PLACES.map((p) => {
          const on = p.key === place
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => {
                if (on) return
                onChange(withScanPlace(item, p.key))
                onPlaceChanged?.(p.key)
              }}
              className={`min-h-[44px] rounded-full border-2 px-3.5 text-[13px] font-extrabold text-[color:var(--color-text)] transition-colors disabled:opacity-60 ${
                on
                  ? 'border-[color:var(--color-text)] bg-[var(--color-primary)]'
                  : 'border-[color:var(--color-border)] bg-[var(--color-surface)]'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onLeaveOut}
          disabled={disabled}
          aria-label={`Leave out ${item.name}`}
          className="min-h-[44px] rounded-full px-2 text-[13px] font-extrabold text-[color:var(--color-text)] underline disabled:opacity-60"
        >
          Leave it out
        </button>
        {onDone && (
          <SpringButton variant="secondary" size="sm" onClick={onDone} disabled={disabled}>
            Done
          </SpringButton>
        )}
      </div>
    </div>
  )
}
