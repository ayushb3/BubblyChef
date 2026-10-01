'use client'

/**
 * One line of the grocery list (issue #497): a tick box, the food (emoji, name
 * and why it is on the list), its amount, and a remove key.
 *
 * The amount is edited in place: tap it and the quantity and unit become two
 * small fields under the line (Enter or the tick saves, Escape or the cross
 * drops the edit). Editing makes a generated line the user's own (the data
 * layer's `updateLine`), so Regenerate won't overwrite it.
 *
 * The tick box is a real checkbox, visually hidden behind a drawn box (the same
 * pattern as the storage list's select mode), so the keyboard and a screen
 * reader get a native control named after the food.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Chip from '@/components/ui/Chip'
import { PIXEL_INK } from '@/components/ui/PixelPanel'
import { getFoodEmoji } from '@/lib/food-emoji'
import { formatAmount, titleCase } from '@/lib/format'
import type { GroceryLine } from '@/lib/grocery'

export interface GroceryLineRowProps {
  line: GroceryLine
  onToggle: (checked: boolean) => void
  onSetAmount: (quantity: number | null, unit: string | null) => void
  onRemove: () => void
}

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-text)]'

const FIELD =
  'min-h-[44px] rounded-xl border-2 bg-[var(--color-surface)] px-2.5 text-[14px] font-bold text-[color:var(--color-text)]'

/** Quantity text -> a number, `null` for blank (no amount), or `undefined` when it is not a usable amount. */
function parseQuantity(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export default function GroceryLineRow({
  line,
  onToggle,
  onSetAmount,
  onRemove,
}: GroceryLineRowProps) {
  const name = titleCase(line.name)
  const [editing, setEditing] = useState(false)
  const [quantityText, setQuantityText] = useState('')
  const [unitText, setUnitText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  // Leaving the editor unmounts the field the keyboard was on; hand focus back
  // to the amount key instead of dropping it to the page.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      editRef.current?.focus()
    }
  }, [editing])

  function startEdit() {
    setQuantityText(line.quantity === null ? '' : String(Number(line.quantity.toFixed(2))))
    setUnitText(line.unit ?? '')
    setInvalid(false)
    setEditing(true)
  }

  function stopEdit() {
    returnFocus.current = true
    setEditing(false)
  }

  function save() {
    const quantity = parseQuantity(quantityText)
    if (quantity === undefined) {
      setInvalid(true)
      return
    }
    onSetAmount(quantity, unitText.trim() === '' ? null : unitText.trim())
    stopEdit()
  }

  function onFieldKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      stopEdit()
    }
  }

  const amount = line.quantity === null ? '' : formatAmount(line.quantity, line.unit)
  const reason =
    line.checked || line.source === 'manual' ? null : line.source === 'depleted' ? 'Ran out' : 'Replace soon'

  return (
    <li
      data-testid="grocery-line"
      className="flex flex-wrap items-center border-b border-[color:var(--color-border)] last:border-b-0"
    >
      <label className="relative flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1 text-[color:var(--color-text)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-[color:var(--color-text)]">
        <input
          type="checkbox"
          checked={line.checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={name}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2"
          style={{
            borderColor: PIXEL_INK,
            background: line.checked ? 'var(--color-primary)' : 'var(--color-surface)',
          }}
        >
          {line.checked && (
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
        <span aria-hidden="true" className="w-[26px] shrink-0 text-center text-[20px] leading-6">
          {getFoodEmoji(line.name, line.category)}
        </span>
        <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span
            className={`max-w-full truncate text-[14px] leading-[19px] font-extrabold ${
              line.checked ? 'line-through opacity-70' : ''
            }`}
          >
            {name}
          </span>
          {reason && (
            <Chip size="sm" tone={line.source === 'depleted' ? 'expired' : 'expiring'}>
              {reason}
            </Chip>
          )}
        </span>
      </label>

      {!editing && (
        <button
          ref={editRef}
          type="button"
          onClick={startEdit}
          aria-label={`Edit amount of ${name}`}
          className={`min-h-[44px] max-w-[34%] shrink-0 truncate px-2 text-right text-[13px] leading-[18px] font-bold tabular-nums text-[color:var(--color-text)] ${FOCUS} ${
            amount ? '' : 'underline decoration-dotted underline-offset-[3px] opacity-70'
          }`}
        >
          {amount || 'Add amount'}
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        title="Remove"
        className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-[color:var(--color-text)] ${FOCUS}`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      {editing && (
        <div className="flex w-full items-center gap-2 pb-2 pl-[44px]">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            autoFocus
            value={quantityText}
            onChange={(e) => {
              setQuantityText(e.target.value)
              setInvalid(false)
            }}
            onKeyDown={onFieldKey}
            aria-label={`Quantity of ${name}`}
            aria-invalid={invalid || undefined}
            placeholder="Qty"
            className={`${FIELD} w-[84px] tabular-nums`}
            style={{ borderColor: invalid ? 'var(--color-expired-text)' : PIXEL_INK }}
          />
          <input
            type="text"
            value={unitText}
            onChange={(e) => setUnitText(e.target.value)}
            onKeyDown={onFieldKey}
            aria-label={`Unit for ${name}`}
            placeholder="Unit"
            maxLength={20}
            className={`${FIELD} min-w-0 flex-1`}
            style={{ borderColor: PIXEL_INK }}
          />
          <button
            type="button"
            onClick={save}
            aria-label={`Save amount of ${name}`}
            className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border-2 font-extrabold shadow-[0_2px_0_var(--color-text)] active:translate-y-px ${FOCUS}`}
            style={{
              borderColor: PIXEL_INK,
              background: 'var(--color-primary)',
              color: 'var(--color-text)',
            }}
          >
            <span aria-hidden="true">✓</span>
          </button>
          <button
            type="button"
            onClick={stopEdit}
            aria-label={`Cancel editing ${name}`}
            className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border-2 font-extrabold ${FOCUS}`}
            style={{
              borderColor: PIXEL_INK,
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
    </li>
  )
}
