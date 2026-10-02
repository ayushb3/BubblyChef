/**
 * Notification-center derivation (issue #496, Spec B.4 — "lite inbox").
 *
 * Pure, unit-testable derivation from data the caller already has (or has
 * fetched). No fetching, no persistence of its own, no read/unread — the hub
 * is recomputed from live state every time it's opened, per the issue's
 * explicit "compute-on-load" decision; the only stored input is the caller's
 * remembered dismissals (issue #906), which filter the computed entries. `useInboxEntries` (hooks/) is the
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
import { cookThisHref, suggestHref } from '@/lib/chat-seed'

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
  /** Tap target. Entries with no destination (timers) carry `href: null`. */
  href: string | null
  /** Sort key — lower sorts first (more urgent). Not rendered. */
  sortKey: number
  /**
   * The raw `useCookingTimers()` timer id, present only on `kind: 'timer'`
   * entries — what the hook passes to the real timer store's `dismiss()`.
   * Timers are the one kind dismissed through that store (so the timer dock
   * sees it too); every other kind is dismissed with a remembered record
   * (`dismissals` below, issue #906).
   */
  timerId?: string
  /**
   * The state this entry stands for (issue #906): a dismissal is remembered
   * against it, so a changed state is a new reason and the entry comes back.
   * Absent means "anything else": the entry's copy.
   */
  fingerprint?: string
}

/**
 * Remembered dismissals (issue #906): entry id to the fingerprint it was
 * dismissed with. Persistence lives in `lib/inbox-dismissals-store.ts`.
 */
export type InboxDismissals = Record<string, string>

/** The fingerprint a dismissal of `entry` is stored (and later compared) with. */
export function entryFingerprint(entry: InboxEntry): string {
  return entry.fingerprint ?? entry.copy
}

/**
 * Is `entry` hidden by a remembered dismissal? Same id and same fingerprint,
 * except the grocery pointer, whose fingerprint is its count: it stays hidden
 * until the count goes *up* past what was dismissed.
 */
export function isEntryDismissed(entry: InboxEntry, dismissals: InboxDismissals): boolean {
  if (entry.kind === 'timer') return false // the timer store owns these
  const stored = dismissals[entry.id]
  if (stored === undefined) return false
  if (entry.kind === 'grocery') return Number(entryFingerprint(entry)) <= Number(stored)
  return stored === entryFingerprint(entry)
}

/**
 * Tidy the remembered record against the full, undismissed entry list: forget a
 * dismissal whose entry is gone (so it shows again when it next has a reason)
 * or whose state has moved on, and lower the grocery bar to a count that
 * dropped (so the next rise past it shows). `groceryKnown` is false while the
 * grocery count is still unknown, so its dismissal is left alone rather than
 * forgotten for want of data. Returns the same record when nothing changed.
 */
export function reconcileDismissals(
  dismissals: InboxDismissals,
  allEntries: InboxEntry[],
  { groceryKnown }: { groceryKnown: boolean },
): InboxDismissals {
  const byId = new Map(allEntries.map((e) => [e.id, e]))
  const next: InboxDismissals = {}
  let changed = false
  for (const [id, stored] of Object.entries(dismissals)) {
    const entry = byId.get(id)
    if (!entry) {
      if (id === 'grocery' && !groceryKnown) next[id] = stored
      else changed = true
    } else if (entry.kind === 'grocery') {
      const lowered = Math.min(Number(entryFingerprint(entry)), Number(stored))
      next[id] = String(lowered)
      if (next[id] !== stored) changed = true
    } else if (entryFingerprint(entry) === stored) {
      next[id] = stored
    } else {
      changed = true
    }
  }
  return changed ? next : dismissals
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
  /** Remembered dismissals (issue #906); omit for "nothing dismissed". */
  dismissals?: InboxDismissals
}

export interface InboxDerivation {
  /** Undismissed, capped, ordered, ready to render. */
  entries: InboxEntry[]
  /** Total undismissed entries before the cap — `entries.length` when nothing overflowed. */
  totalCount: number
  /** `totalCount - INBOX_CAP`, floored at 0 — the "and N more" line. */
  overflowCount: number
  /** Every entry the data gives rise to, dismissed or not, uncapped, in order: what "Clear all" dismisses and what the record is reconciled against. */
  allEntries: InboxEntry[]
}

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`
}

/**
 * Per-kind sort buckets, each wide enough that no in-category offset (e.g. an
 * expired item hundreds of days overdue) can ever spill into a neighbouring
 * bucket. This is what actually enforces the priority order below — a flat
 * "add a small offset to a round number" scheme (the previous approach)
 * only holds by coincidence once any bucket's offset can grow large, which
 * is exactly how a completed timer (a flat 3000) ended up sorting *after*
 * every expiring row (1000-1003) but *before* nothing large enough to matter
 * — except there were more than `INBOX_CAP` expiring rows, so the cap sliced
 * the list before the timer's bucket was ever reached (#496 review).
 */
const SORT_BUCKET = {
  // Timers rank first, ahead of expiry: a completed timer is time-critical
  // (food is actively on the heat) in a way an already-expired pantry row
  // is not — and it must never be starved out by however many expiry rows
  // an account happens to have. The issue doesn't specify a priority
  // between timers and expiry, so this is a judgement call — see
  // "Decisions for Ayush" in the PR.
  timer: 0,
  expired: 100_000,
  expiring: 200_000,
  low_stock: 300_000,
  cook_nudge: 400_000,
  grocery: 500_000,
} as const

function expiredEntry(item: EnrichedPantryItem, daysUntil: number): InboxEntry {
  const daysAgo = Math.abs(daysUntil)
  return {
    id: `expired:${item.id}`,
    kind: 'expired',
    tier: 'urgent',
    emoji: '⏰',
    copy: `${item.name} expired ${pluralDays(daysAgo)} ago`,
    // The expiry date, not the copy: "2d ago" changes every day, a restock does not.
    fingerprint: item.expiry_date ?? '',
    href: cookThisHref(item.name, item.expiry_date),
    // Most-overdue first: more negative daysUntil sorts first within this tier.
    sortKey: SORT_BUCKET.expired + daysUntil,
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
    fingerprint: item.expiry_date ?? '',
    href: cookThisHref(item.name, item.expiry_date),
    sortKey: SORT_BUCKET.expiring + daysUntil,
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
    sortKey: SORT_BUCKET.low_stock,
  }
}

function timerEntry(timer: InboxTimerSource): InboxEntry {
  return {
    id: `timer:${timer.id}`,
    kind: 'timer',
    tier: 'info',
    emoji: '⏱️',
    copy: `${timer.label} timer finished`,
    // Dismiss-only — no navigation target. The dismiss action itself goes
    // through the real timer store's `dismiss()`, called by the caller with
    // `timerId` below (`NotificationBell.tsx`) — this pure module has no
    // access to that store.
    href: null,
    sortKey: SORT_BUCKET.timer,
    timerId: timer.id,
  }
}

function cookNudgeEntry(): InboxEntry {
  return {
    id: 'cook_nudge',
    kind: 'cook_nudge',
    tier: 'info',
    emoji: '🍳',
    copy: "You haven't cooked in a while — want a suggestion?",
    // A new chat that asks for a suggestion (#905), not whatever was open last.
    href: suggestHref(),
    sortKey: SORT_BUCKET.cook_nudge,
  }
}

function groceryEntry(count: number): InboxEntry {
  return {
    id: 'grocery',
    kind: 'grocery',
    tier: 'info',
    emoji: '🛒',
    copy: `${count} item${count === 1 ? '' : 's'} on your grocery list`,
    // The count: a dismissal holds until it goes up (`isEntryDismissed`).
    fingerprint: String(count),
    href: '/grocery',
    sortKey: SORT_BUCKET.grocery,
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
 * Ordering: completed timers (time-critical — food is on the heat) →
 * expired (most overdue first) → expiring soon (today, then further out) →
 * low stock → cook nudge → grocery pointer. See `SORT_BUCKET` above — each
 * kind sorts within its own reserved bucket, so no kind can ever spill into
 * a neighbouring one's position. Capped at `INBOX_CAP` *after* sorting, so
 * ranking timers first also guarantees they can never be starved out of the
 * visible list by however many expiry rows an account happens to have (see
 * "Decisions for Ayush" in the PR); anything beyond the cap only
 * contributes to `overflowCount`.
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
      // Keyed by the last cook: it stays dismissed until a cook resets the
      // clock and the threshold passes again (issue #906).
      all.push({ ...cookNudgeEntry(), fingerprint: latest ? latest.toISOString() : 'never' })
    }
  }

  if (data.groceryCount != null && data.groceryCount > 0) {
    all.push(groceryEntry(data.groceryCount))
  }

  all.sort((a, b) => a.sortKey - b.sortKey)

  // Dismissed entries are filtered out *before* the cap, so they neither count
  // nor hold one of the ten visible slots (issue #906).
  const dismissals = data.dismissals ?? {}
  const undismissed = all.filter((e) => !isEntryDismissed(e, dismissals))

  const totalCount = undismissed.length
  const entries = undismissed.slice(0, INBOX_CAP)
  const overflowCount = Math.max(0, totalCount - INBOX_CAP)

  return { entries, totalCount, overflowCount, allEntries: all }
}
