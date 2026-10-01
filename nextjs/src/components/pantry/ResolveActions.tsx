'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { springs } from '@/lib/motion'
import type { ResolveOutcome } from '@/lib/api/pantry'

export interface ResolveActionsProps {
  /** Item being resolved — used for accessible labels only. */
  itemName: string
  /** Fires with the chosen outcome. The parent owns the mutation. */
  onResolve: (outcome: ResolveOutcome) => void
  /** True while the parent's mutation is in flight. */
  pending?: boolean
  /**
   * `bar` (default): full-width keys under a card, split by hairlines.
   * `pills` (the storage sheet's List, issue #750): rounded ink-edged keys in one
   * row, so an expiring row stays a single compact strip.
   */
  variant?: 'bar' | 'pills'
  /**
   * "Cook something with it": a chat seeded with this item. Omit it when there
   * is nothing to cook (the food has already expired) and the row is just
   * Used it / Tossed.
   */
  cookHref?: string
  /**
   * "Add to list" (issue #497): puts this food on the grocery list. Omit it and
   * there is no such key. It never resolves the item.
   */
  onAddToList?: () => void
  /**
   * "Used some" (issue #851): the amount used, in the item's own unit. Omit it and
   * there is no such key. An amount that covers everything on hand is reported as
   * a plain `onResolve('used')` instead, so the parent only ever sees a real
   * partial use here. Needs `quantity` to offer a half or a quarter.
   */
  onUseSome?: (amount: number) => void
  /** What is on hand (for "half" and "a quarter", and to tell "all of it"). */
  quantity?: number
  /** The quantity's unit; named on the custom amount field. */
  unit?: string
}

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]'

/**
 * One row of three icon-only keys for expired and expiring-soon cards: cook
 * (🍳), used it (✓), tossed (🗑) (#813).
 *
 * The words ("Cook this", "Used it", "Tossed") used to sit on every card and
 * cost two rows of height, so they are gone from the surface. The meaning is
 * kept in the aria-label (assistive tech) and a native `title` (hover). The
 * keys stay a full 44px square (WCAG 2.5.5) and keep the fresh / expired colour
 * coding. The storage list adds a fourth, 🛒 "Add to list" (#497), between cook and
 * used it; it only puts the food on the grocery list and resolves nothing.
 *
 * Urgency buys the card real estate: these items are the whole point of the
 * expiry feature, so their resolve action is a present affordance rather than
 * something the user has to discover by dragging. Everything else in the pantry
 * gets `SwipeToResolve` instead, which keeps normal cards visually clean.
 *
 * "Tossed" is destructive and irreversible (the pantry row is deleted and an
 * append-only event is written), so it swaps to an inline confirm rather than
 * firing on first tap. "Used it" is the happy path and is one tap: this
 * component only reports it, and the parent (the storage sheet) holds the write
 * behind a 5-second undo (issue #851, `lib/pantry-undo`). With `onUseSome`, a ½ key
 * between Used it and Tossed takes a half, a quarter or a custom amount instead of
 * all of it.
 */
export default function ResolveActions({
  itemName,
  onResolve,
  pending = false,
  variant = 'bar',
  cookHref,
  onAddToList,
  onUseSome,
  quantity,
  unit,
}: ResolveActionsProps) {
  // keys: the row. toss / some: one step in place of it (confirm, quick amounts).
  // amount: the custom amount field.
  const [mode, setMode] = useState<'keys' | 'toss' | 'some' | 'amount'>('keys')
  const [custom, setCustom] = useState('')
  const confirmingToss = mode === 'toss'
  const tossRef = useRef<HTMLButtonElement>(null)
  const someRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<'toss' | 'some' | null>(null)
  const pills = variant === 'pills'
  const canUseSome = onUseSome !== undefined && typeof quantity === 'number' && quantity > 0

  // Cancelling a step unmounts the button the keyboard was on; hand focus back to
  // the key that opened it rather than dropping it to the page.
  useEffect(() => {
    if (mode === 'keys' && returnFocus.current) {
      const key = returnFocus.current === 'some' ? someRef.current : tossRef.current
      returnFocus.current = null
      key?.focus()
    }
  }, [mode])

  // "Used some" amounts. All of it is just "Used it".
  const applyAmount = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0 || !onUseSome) return
    setMode('keys')
    if (typeof quantity === 'number' && amount >= quantity) onResolve('used')
    else onUseSome(amount)
  }

  // Every key is a full 44px square (WCAG 2.5.5); the confirm's text stays text-xs.
  const base = 'flex-1 min-h-[44px] min-w-[44px] disabled:opacity-60'
  const icon = `${base} inline-flex items-center justify-center text-lg leading-none`
  const text = `${base} text-xs font-semibold`
  const pill =
    'rounded-full border-2 border-[var(--color-text)] font-extrabold shadow-[0_2px_0_var(--color-text)] active:translate-y-px'
  const hairline = 'border-l border-[var(--color-border)]'

  const rowClass = pills ? 'flex gap-2 px-2 pt-1 pb-2' : 'border-t border-[var(--color-border)] flex'

  if (mode === 'some' || mode === 'amount') {
    const cancel = (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          returnFocus.current = 'some'
          setMode('keys')
        }}
        aria-label="Cancel"
        className={
          pills
            ? `${text} flex-none px-4 bg-[var(--color-surface)] text-[var(--color-text)] ${pill} ${FOCUS}`
            : `px-3 min-h-[44px] min-w-[44px] text-xs font-semibold text-[var(--color-muted)] ${hairline} hover:bg-[var(--color-border)] disabled:opacity-60 ${FOCUS}`
        }
      >
        Cancel
      </button>
    )
    const stepKey = `${text} text-[var(--color-fresh-text)] bg-[var(--color-fresh)] ${FOCUS} ${
      pills ? pill : 'hover:brightness-95'
    }`
    if (mode === 'amount') {
      const amount = Number(custom)
      const valid = custom.trim() !== '' && Number.isFinite(amount) && amount > 0
      const unitWords = unit && unit.toLowerCase() !== 'item' ? unit : ''
      return (
        <form
          className={`${rowClass} items-center`}
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) applyAmount(amount)
          }}
        >
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label={unitWords ? `Amount used, in ${unitWords}` : 'Amount used'}
            placeholder={unitWords || 'Amount'}
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          />
          <button type="submit" disabled={pending || !valid} className={`${stepKey} flex-none px-4`}>
            Use
          </button>
          {cancel}
        </form>
      )
    }
    return (
      <div className={rowClass}>
        <button
          type="button"
          disabled={pending}
          onClick={() => applyAmount((quantity ?? 0) / 2)}
          aria-label={`Used half of ${itemName}`}
          className={stepKey}
        >
          Half
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => applyAmount((quantity ?? 0) / 4)}
          aria-label={`Used a quarter of ${itemName}`}
          className={stepKey}
        >
          Quarter
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setCustom('')
            setMode('amount')
          }}
          aria-label="Other amount"
          className={`${text} bg-[var(--color-surface)] text-[var(--color-text)] ${FOCUS} ${
            pills ? pill : `${hairline} hover:bg-[var(--color-border)]`
          }`}
        >
          Other…
        </button>
        {cancel}
      </div>
    )
  }

  if (confirmingToss) {
    return (
      <div className={rowClass}>
        <button
          type="button"
          disabled={pending}
          onClick={() => onResolve('tossed')}
          aria-label={`Confirm ${itemName} was tossed`}
          className={`${text} text-[var(--color-expired-text)] bg-[var(--color-expired)] ${FOCUS} ${
            pills ? pill : 'hover:brightness-95'
          }`}
        >
          {pending ? 'Tossing…' : 'Really toss?'}
        </button>
        <button
          type="button"
          autoFocus
          disabled={pending}
          onClick={() => {
            returnFocus.current = 'toss'
            setMode('keys')
          }}
          aria-label="Cancel"
          className={
            pills
              ? `${text} flex-none px-4 bg-[var(--color-surface)] text-[var(--color-text)] ${pill} ${FOCUS}`
              : `px-3 min-h-[44px] min-w-[44px] text-xs font-semibold text-[var(--color-muted)] ${hairline} hover:bg-[var(--color-border)] disabled:opacity-60 ${FOCUS}`
          }
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={rowClass}>
      {cookHref && (
        <Link
          href={cookHref}
          aria-label={`Cook something with ${itemName}`}
          title="Cook this"
          className={`${icon} text-[var(--color-text)] bg-[var(--color-primary)] ${FOCUS} ${
            pills ? pill : 'hover:brightness-95'
          }`}
        >
          <span aria-hidden="true">🍳</span>
        </Link>
      )}
      {onAddToList && (
        <motion.button
          type="button"
          disabled={pending}
          whileTap={pending ? undefined : { scale: 0.97 }}
          transition={springs.snappy}
          onClick={onAddToList}
          aria-label={`Add ${itemName} to grocery list`}
          title="Add to list"
          className={`${icon} text-[var(--color-text)] bg-[var(--color-accent)] ${FOCUS} ${
            pills ? pill : `hover:brightness-95 ${cookHref ? hairline : ''}`
          }`}
        >
          <span aria-hidden="true">🛒</span>
        </motion.button>
      )}
      <motion.button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        whileTap={pending ? undefined : { scale: 0.97 }}
        transition={springs.snappy}
        onClick={() => onResolve('used')}
        aria-label={`Mark ${itemName} as used up`}
        title="Used it"
        className={`${icon} text-[var(--color-fresh-text)] bg-[var(--color-fresh)] ${FOCUS} ${
          pills ? pill : `hover:brightness-95 ${cookHref || onAddToList ? hairline : ''}`
        }`}
      >
        <span aria-hidden="true">{pending ? '…' : '✓'}</span>
      </motion.button>
      {canUseSome && (
        <motion.button
          ref={someRef}
          type="button"
          disabled={pending}
          whileTap={pending ? undefined : { scale: 0.97 }}
          transition={springs.snappy}
          onClick={() => setMode('some')}
          aria-label={`Mark some of ${itemName} as used`}
          title="Used some"
          className={`${icon} text-[var(--color-fresh-text)] bg-[var(--color-fresh)] ${FOCUS} ${
            pills ? pill : `hover:brightness-95 ${hairline}`
          }`}
        >
          <span aria-hidden="true">½</span>
        </motion.button>
      )}
      <motion.button
        ref={tossRef}
        type="button"
        disabled={pending}
        whileTap={pending ? undefined : { scale: 0.97 }}
        transition={springs.snappy}
        onClick={() => setMode('toss')}
        aria-label={`Mark ${itemName} as tossed`}
        title="Tossed"
        className={`${icon} text-[var(--color-expired-text)] bg-[var(--color-expired)] ${FOCUS} ${
          pills ? pill : `hover:brightness-95 ${hairline}`
        }`}
      >
        <span aria-hidden="true">🗑</span>
      </motion.button>
    </div>
  )
}
