/**
 * How a pantry item's expiry is presented and ordered, shared by the pantry
 * grid (`/pantry`) and the Use Soon triage view (`/pantry/use-soon`).
 *
 * These live here rather than in the page files because Next.js 16's generated
 * route-type check only allows a page module to export the known page exports
 * (`default`, `metadata`, ...). Any other named export fails `next build`
 * (webpack) and `tsc --noEmit` (issue #581).
 */

import type { PantryItem } from '@/types/pantry'
import { daysUntilExpiry, estimatedExpirySuffix } from '@/lib/pantry-helpers'

// `estimated` appends a subtle " · est." suffix (#182) when the expiry date
// is a heuristic guess rather than one read from a receipt/label or entered
// by hand — a provenance signal, so it must not affect the badge's
// fresh/expiring/expired colouring.
export function expiryBadge(days: number | null, estimated?: boolean) {
  if (days === null) return null
  const suffix = estimatedExpirySuffix(estimated)
  if (days < 0) return { label: `Expired${suffix}`, color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days === 0) return { label: `Today${suffix}`, color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days <= 2) return { label: `${days}d left${suffix}`, color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days <= 5) return { label: `${days}d left${suffix}`, color: 'bg-[var(--color-expiring)] text-[var(--color-expiring-text)]' }
  return { label: `${days}d left${suffix}`, color: 'bg-[var(--color-fresh)] text-[var(--color-fresh-text)]' }
}

/** Expired first (most negative), then soonest to expire. */
export function urgencySort(a: PantryItem, b: PantryItem): number {
  const da = daysUntilExpiry(a.expiry_date)
  const db = daysUntilExpiry(b.expiry_date)
  if (da === null) return 1
  if (db === null) return -1
  return da - db
}

export function needsAttention(item: PantryItem): boolean {
  const days = daysUntilExpiry(item.expiry_date)
  return days !== null && days <= 3
}

// `estimated` appends a subtle " · est." suffix (#182) when the expiry date
// is a heuristic guess rather than one read from a receipt/label or entered
// by hand — a provenance signal, so it must not affect the tier's colouring.
export function urgencyTier(days: number | null, estimated?: boolean) {
  if (days === null) return null
  const suffix = estimatedExpirySuffix(estimated)
  if (days < 0) {
    const ago = Math.abs(days)
    return {
      label: (ago === 1 ? 'Expired yesterday' : `Expired ${ago}d ago`) + suffix,
      color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]',
    }
  }
  if (days === 0)
    return {
      label: `Today${suffix}`,
      color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]',
    }
  if (days === 1)
    return {
      label: `Tomorrow${suffix}`,
      color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]',
    }
  return {
    label: `${days} days left${suffix}`,
    color: 'bg-[var(--color-expiring)] text-[var(--color-expiring-text)]',
  }
}
