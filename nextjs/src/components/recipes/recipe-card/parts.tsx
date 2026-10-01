'use client'

/**
 * Shared pieces of the one recipe card (issue #744): the frame, the role tag in
 * its dish pastel, the expiring badge and the "N to buy" line. Every variant
 * (option, dish, chat, compact) is built from these, so a dish looks the same
 * wherever it appears. Colours are theme variables only; the dish pastels are
 * the theme-invariant `--color-dish-*` tokens.
 */

import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import { useMotionConfig, useReactionVariants } from '@/lib/motion'
import { addItemsToMyGroceryList } from '@/lib/grocery-add'
import { ROLE_LABEL, type DishRole } from './dishPastel'

/** Board frame: 2 px ink border, 16 px radius, surface fill, ink text. */
export const CARD_FRAME =
  'rounded-2xl border-2 border-[var(--color-text)] bg-[var(--color-surface)] text-[var(--color-text)]'

/** The 3 px bottom "key" shadow shared with the keycap button. */
export const CARD_KEY_SHADOW = 'shadow-[0_3px_0_var(--color-text)]'

/**
 * A whole card that is one control (option card, compact row). It presses like a
 * keycap: sinks 2 px and the shadow shrinks (60 ms), springs back in 180 ms;
 * under reduced motion it darkens instead. Disabled cards never sink.
 */
export const CARD_PRESS = [
  'transition-[translate,box-shadow,filter] duration-[180ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]',
  'active:duration-[60ms] active:ease-out',
  'motion-safe:active:enabled:translate-y-[2px] motion-safe:active:enabled:shadow-[0_1px_0_var(--color-text)]',
  'motion-reduce:transition-none motion-reduce:active:enabled:brightness-90',
].join(' ')

/**
 * The keycap's own layout, for a SpringButton that must also pass a `className`
 * (a bare SpringButton gets this itself; passing any className switches that
 * off, so the caller supplies it).
 */
export const KEY_LAYOUT = 'inline-flex items-center justify-center gap-2 px-[18px] py-2.5 text-sm leading-5 whitespace-nowrap'
export const KEY_LAYOUT_SM = 'inline-flex items-center justify-center gap-2 px-3.5 py-1.5 text-[13px] leading-[18px] whitespace-nowrap'

/** Heading face (Quicksand) for card titles. */
export const TITLE_FONT = 'font-[family-name:var(--font-heading)]'

/** A link that looks like a secondary keycap (SpringButton renders only buttons). */
export const KEYCAP_LINK = [
  'inline-flex min-h-[44px] items-center justify-center gap-2 px-[18px] py-2.5',
  'rounded-full border-2 border-[var(--color-text)] bg-[var(--color-surface)] text-[var(--color-text)]',
  'text-sm leading-5 font-extrabold whitespace-nowrap',
  CARD_KEY_SHADOW,
  CARD_PRESS,
  'motion-safe:active:translate-y-[2px]',
].join(' ')

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function ChevronIcon() {
  return (
    <svg {...ICON} width={20} height={20} className="shrink-0">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...ICON} width={size} height={size} className="shrink-0">
      <path d="M5 12l5 5 9-10" />
    </svg>
  )
}

function CartIcon() {
  return (
    <svg {...ICON}>
      <path d="M3 4h2l2 11h11l2-8H6" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </svg>
  )
}

function DropIcon() {
  return (
    <svg {...ICON} width={14} height={14}>
      <path d="M12 3c4 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2-6 6-10z" />
    </svg>
  )
}

/**
 * The role tag. In an option row it carries the dish's pastel; in a dish card's
 * header band (already pastel) it sits on the surface colour.
 */
export function RoleTag({
  role,
  pastel,
  testId,
}: {
  role: DishRole
  /** A CSS colour (the dish pastel). Omit for the neutral surface tag. */
  pastel?: string
  testId?: string
}) {
  return (
    <span
      data-testid={testId}
      data-role={role}
      className="inline-block shrink-0 rounded-full border-[1.5px] border-[var(--color-text)] px-2 py-px text-[11px] leading-4 font-extrabold tracking-[0.06em] text-[var(--color-text)] uppercase"
      style={{ background: pastel ?? 'var(--color-surface)' }}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

/** "6 min" style minutes, tabular so columns of them line up. */
export function Minutes({ minutes, className = '' }: { minutes: number; className?: string }) {
  return (
    <span className={`text-[13px] font-extrabold tabular-nums ${className}`}>{minutes} min</span>
  )
}

function dayLabel(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`
}

/**
 * "Uses your romaine · today": shown only when the dish uses food that expires
 * today or tomorrow. The caller decides that (an empty list renders nothing), so
 * an expiry-priority setting of Off hides it by passing no names. No loop: the
 * droop belongs to the food in the world, not the card.
 */
export function ExpiringBadge({ names, days }: { names: string[]; days?: number | null }) {
  if (names.length === 0) return null
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-[var(--color-expiring)] px-2.5 py-[3px] text-xs leading-4 font-extrabold text-[var(--color-expiring-text)]">
      <DropIcon />
      <span className="min-w-0">
        Uses your {names.join(', ')}
        {days != null ? ` · ${dayLabel(days)}` : ''}
      </span>
    </span>
  )
}

type AddState = 'idle' | 'adding' | 'added' | 'error'

/**
 * The "N to buy" line (Recipe card board). Four states:
 * - nothing to buy: says so instead of showing 0;
 * - N to buy: the names and an "Add to grocery list" key;
 * - added: crossfades to "N on your grocery list" with a tick that pops;
 * - failed: the line wiggles once and offers the key again.
 *
 * The grocery list is per-browser and has no page yet (issue #497), so the
 * confirmation carries no "View list" link. Remount with a new `key` when the
 * item list changes.
 */
export function ToBuyLine({
  items,
  onAdd = addItemsToMyGroceryList,
  note,
}: {
  items: string[]
  /** Defaults to the user's browser grocery list. Rejects on failure. */
  onAdd?: (items: string[]) => void | Promise<void>
  /** Trailing note after the names, e.g. "the salad shares it". */
  note?: string
}) {
  const { reduced } = useMotionConfig()
  const reactions = useReactionVariants()
  const [state, setState] = useState<AddState>('idle')

  if (items.length === 0) {
    return (
      <div className="flex min-h-[44px] items-center gap-2 text-[13px] leading-[18px] font-bold">
        <CheckIcon />
        <span>Nothing to buy. It&apos;s all in your kitchen.</span>
      </div>
    )
  }

  async function add() {
    if (state === 'adding' || state === 'added') return
    setState('adding')
    try {
      await onAdd(items)
      setState('added')
    } catch {
      setState('error')
    }
  }

  if (state === 'added') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        role="status"
        className="flex min-h-[44px] items-center gap-2 text-[13px] leading-[18px] font-bold"
      >
        <motion.span
          initial={reduced ? false : { scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          className="inline-flex"
        >
          <CheckIcon />
        </motion.span>
        <span>
          <b>{items.length} on your grocery list</b>
        </span>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <motion.div
        key={state === 'error' ? 'error' : 'ready'}
        variants={reactions.wiggle}
        initial="idle"
        animate={state === 'error' ? 'play' : 'idle'}
        className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
      >
        <span className="min-w-[120px] flex-1 text-[13px] leading-[18px]">
          <b>{items.length} to buy:</b> {items.join(', ')}
          {note ? ` (${note})` : ''}
        </span>
        <SpringButton
          variant="secondary"
          size="sm"
          onClick={add}
          loading={state === 'adding'}
          disabled={state === 'adding'}
          className={`shrink-0 ${KEY_LAYOUT_SM}`}
        >
          <CartIcon />
          Add to grocery list
        </SpringButton>
      </motion.div>
      {state === 'error' && (
        <p role="alert" className="text-xs font-bold text-[var(--color-expired-text)]">
          Couldn&apos;t add to your grocery list. Try again.
        </p>
      )}
    </div>
  )
}

/** Meta pills (difficulty, servings, cuisine, dietary tags) on the chat card. */
export function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full border-[1.5px] border-[var(--color-text)] bg-[var(--color-surface)] px-2 py-px text-[11px] leading-4 font-extrabold text-[var(--color-text)]">
      {children}
    </span>
  )
}
