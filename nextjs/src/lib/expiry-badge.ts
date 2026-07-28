/**
 * Days-left tier badge — shared by the pantry grid (`app/pantry/page.tsx`) and
 * the Use Soon triage view (`app/pantry/use-soon/page.tsx`), issue #139.
 *
 * Kept as a single source of truth so the two views can't drift on where the
 * expired/expiring/fresh boundaries sit (they used to live as a copy-pasted
 * local function in the pantry page alone).
 */
export interface ExpiryBadge {
  label: string
  /** Tailwind utility classes resolving entirely through `--color-*` tokens. */
  className: string
}

export function expiryBadge(days: number | null): ExpiryBadge | null {
  if (days === null) return null
  if (days <= 0) return { label: 'Expired', className: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days <= 2) return { label: `${days}d left`, className: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days <= 5) return { label: `${days}d left`, className: 'bg-[var(--color-expiring)] text-[var(--color-expiring-text)]' }
  return { label: `${days}d left`, className: 'bg-[var(--color-fresh)] text-[var(--color-fresh-text)]' }
}
