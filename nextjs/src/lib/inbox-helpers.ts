/**
 * Notification-center derivation (issue #496, Spec B.4 — "lite inbox").
 *
 * Pure, unit-testable derivation from data the caller already has (or has
 * fetched). No fetching, no persistence, no read/unread — the hub is
 * recomputed from live state every time it's opened, per the issue's
 * explicit "compute-on-load" decision. `useInboxEntries` (hooks/) is the
 * thin fetch-and-call wrapper; this file is the logic that's actually worth
 * testing in isolation.
 *
 * Feed sources:
 *  - Expiring/expired pantry rows (tiered: expired / today / ≤3 days).
 *  - Low-stock rows (`quantity <= 0`).
 *  - A "haven't cooked in a while" nudge (> 7 days since the most recent
 *    `last_cooked_at` across all recipes, or no recipe ever cooked).
 *  - Completed-timer entries from Spec B.3's store, when present.
 *  - A grocery-list pointer, when Spec B.5's `/grocery` route exists.
 * The last two are optional feeds — absent/undefined input means the
 * feature isn't there yet, and they silently contribute nothing rather than
 * erroring or showing a broken entry.
 */

import type { EnrichedPantryItem } from '@/lib/pantry-helpers'
import { cookThisHref } from '@/lib/chat-seed'

/** Cap on entries actually shown; anything past this collapses into a count. */
export const INBOX_CAP = 10

/** How many days without a cook before the "haven't cooked in a while" nudge fires. */
export const COOK_NUDGE_DAYS = 7

/** The pantry expiry window this hub cares about — matches `/api/pantry/expiring?days=3`. */
export const EXPIRY_WINDOW_DAYS = 3

export type InboxEntryKind = 'expired' | 'expiring' | 'low_stock' | 'cook_nudge' | 'timer' | 'grocery'

/** Urgency tier — drives the pastel treatment (#496: "pastel tiers for urgency"). */
export type InboxTier = 'urgent' | 'warning' | 'info'

export interface InboxEntry {
  /** Stable within one derivation pass — not persisted across opens. */
  id: string
  kind: InboxEntryKind
  tier: InboxTier
  emoji: string
  /** One line of copy, e.g. "Milk expired 2d ago". */
  copy: string
  /** Tap target. Dismiss-only entries (timers) carry `href: null`. */
  href: string | null
  /** Sort key — lower sorts first (more urgent). Not rendered. */
  sortKey: number
}

/** Minimal recipe shape the cook-nudge needs — avoids importing the full `Recipe` type. */
export interface InboxRecipeSource {
  last_cooked_at?: string | null
}

/**
 * A completed timer from Spec B.3's store. Optional/absent when B.3 isn't
 * merged yet — `deriveInboxEntries` treats a missing `timers` array as "no
 * timer feature", not "zero timers currently completed".
 */
export interface InboxTimerSource {
  id: string
  label: string
}

export interface InboxSourceData {
  pantryItems: EnrichedPantryItem[]
  recipes: InboxRecipeSource[]
  /** Present only once Spec B.3 ships; omit entirely when the feature doesn't exist. */
  timers?: InboxTimerSource[]
  /** Present only once Spec B.5 ships a `/grocery` route + count; omit when it doesn't exist. */
  groceryCount?: number | null
}

export interface InboxDerivation {
  /** Capped, ordered, ready to render. */
  entries: InboxEntry[]
  /** Total entries before the cap — `entries.length` when nothing overflowed. */
  totalCount: number
  /** `totalCount - INBOX_CAP`, floored at 0 — the "and N more" line. */
  overflowCount: number
}

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`
}

function expiredEntry(item: EnrichedPantryItem, daysUntil: number): InboxEntry {
  const daysAgo = Math.abs(daysUntil)
  return {
    id: `expired:${item.id}`,
    kind: 'expired',
    tier: 'urgent',
    emoji: '⏰',
    copy: `${item.name} expired ${pluralDays(daysAgo)} ago`,
    href: cookThisHref(item.name, item.expiry_date),
    // Most-overdue first: more negative daysUntil sorts first within this tier.
    sortKey: 0 + daysUntil,
  }
}

function expiringEntry(item: EnrichedPantryItem, daysUntil: number): InboxEntry {
  const copy =
    daysUntil === 0
      ? `${item.name} expires today`
      : `${item.name} expires in ${pluralDays(daysUntil)}`
  return {
    id: `expiring:${item.id}`,
    kind: 'expiring',
    tier: daysUntil === 0 ? 'warning' : 'info',
    emoji: daysUntil === 0 ? '⚠️' : '🕒',
    copy,
    href: cookThisHref(item.name, item.expiry_date),
    sortKey: 1000 + daysUntil,
  }
}

function lowStockEntry(item: EnrichedPantryItem): InboxEntry {
  return {
    id: `low_stock:${item.id}`,
    kind: 'low_stock',
    tier: 'warning',
    emoji: '📉',
    copy: `${item.name} is out of stock`,
    // Nudges point at plain /chat (#496 tap-target spec), not a seeded thread —
    // unlike the expiring entries above, there's no single ingredient to seed
    // the conversation with here.
    href: '/chat',
    sortKey: 2000,
  }
}

function timerEntry(timer: InboxTimerSource): InboxEntry {
  return {
    id: `timer:${timer.id}`,
    kind: 'timer',
    tier: 'info',
    emoji: '⏱️',
    copy: `${timer.label} timer finished`,
    // Dismiss-only — Spec B.3 owns what "dismiss" does; this hub just lists it.
    href: null,
    sortKey: 3000,
  }
}

function cookNudgeEntry(): InboxEntry {
  return {
    id: 'cook_nudge',
    kind: 'cook_nudge',
    tier: 'info',
    emoji: '🍳',
    copy: "You haven't cooked in a while — want a suggestion?",
    href: '/chat',
    sortKey: 4000,
  }
}

function groceryEntry(count: number): InboxEntry {
  return {
    id: 'grocery',
    kind: 'grocery',
    tier: 'info',
    emoji: '🛒',
    copy: `${count} item${count === 1 ? '' : 's'} on your grocery list`,
    href: '/grocery',
    sortKey: 5000,
  }
}

/**
 * Most recent `last_cooked_at` across all recipes, or `null` if none has
 * ever been cooked (missing field, empty list, or every value null).
 */
function latestCookedAt(recipes: InboxRecipeSource[]): Date | null {
  let latest: Date | null = null
  for (const recipe of recipes) {
    if (!recipe.last_cooked_at) continue
    const d = new Date(recipe.last_cooked_at)
    if (Number.isNaN(d.getTime())) continue
    if (!latest || d.getTime() > latest.getTime()) latest = d
  }
  return latest
}

/**
 * Derive the capped, ordered inbox from already-fetched data.
 *
 * Ordering: expired (most overdue first) → expiring soon (today, then
 * further out) → timers → low stock → cook nudge → grocery pointer. Capped
 * at `INBOX_CAP`; anything beyond that only contributes to `overflowCount`.
 */
export function deriveInboxEntries(data: InboxSourceData, now: Date = new Date()): InboxDerivation {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const all: InboxEntry[] = []

  // One entry per pantry row. A row can independently qualify as
  // expired/expiring (date-driven) *and* low-stock (quantity-driven) — an
  // ordinary end state once the cook flow deducts the last of something
  // that was already expiring. Collect every tier a row qualifies for and
  // keep only the most urgent one, so a single row never produces two
  // entries (and never burns two of the ten capped slots for itself).
  const TIER_RANK: Record<InboxTier, number> = { urgent: 0, warning: 1, info: 2 }
  for (const item of data.pantryItems) {
    const candidates: InboxEntry[] = []

    if (item.expiry_date) {
      const daysUntil = item.days_until_expiry
      if (daysUntil !== null) {
        if (daysUntil < 0) {
          candidates.push(expiredEntry(item, daysUntil))
        } else if (daysUntil <= EXPIRY_WINDOW_DAYS) {
          candidates.push(expiringEntry(item, daysUntil))
        }
      }
    }

    if (item.quantity <= 0) candidates.push(lowStockEntry(item))

    if (candidates.length === 0) continue
    const mostUrgent = candidates.reduce((best, cur) =>
      TIER_RANK[cur.tier] < TIER_RANK[best.tier] ? cur : best,
    )
    all.push(mostUrgent)
  }

  for (const timer of data.timers ?? []) {
    all.push(timerEntry(timer))
  }

  // Gated on having at least one saved recipe: "no cooks" (the issue's own
  // phrasing) means no *saved* recipe has been cooked, not "this account has
  // zero recipes at all". Without this gate, a brand-new account with an
  // empty pantry and no recipes would still get a badge — contradicting the
  // acceptance criterion "Empty pantry, no timers -> bell shows no badge
  // ... (never an empty box)", since there'd be nothing to suggest cooking
  // *from* yet.
  if (data.recipes.length > 0) {
    const latest = latestCookedAt(data.recipes)
    const daysSinceCook = latest ? Math.floor((today.getTime() - latest.getTime()) / 86_400_000) : null
    if (daysSinceCook === null || daysSinceCook > COOK_NUDGE_DAYS) {
      all.push(cookNudgeEntry())
    }
  }

  if (data.groceryCount != null && data.groceryCount > 0) {
    all.push(groceryEntry(data.groceryCount))
  }

  all.sort((a, b) => a.sortKey - b.sortKey)

  const totalCount = all.length
  const entries = all.slice(0, INBOX_CAP)
  const overflowCount = Math.max(0, totalCount - INBOX_CAP)

  return { entries, totalCount, overflowCount }
}
