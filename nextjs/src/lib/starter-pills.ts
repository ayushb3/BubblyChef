/**
 * Starter pills for the empty chat screen (issue #651, §7b).
 *
 * `rankStarterPills` is pure — it never reads the clock itself (`now` is
 * always injected) and never fetches anything. It always returns exactly 3
 * pills, deduped by label case-insensitively:
 *
 *  - Slot 1 is always the time-of-day pill, computed from `now`'s local
 *    hour, with or without a loaded `StarterContext`.
 *  - Slots 2-3 are the first two survivors of an ordered candidate list —
 *    scan, expiring, make again, cuisine, then two time-appropriate fillers
 *    — so `ctx === null` (context still loading, or the query failed)
 *    degrades to the time pill plus the two fillers rather than blocking on
 *    a network round trip.
 */

import type { ChipConfig } from '@/lib/chat-chips'
import type { StarterContext, StarterRecentCook } from '@/types/chat'
import { parseLocalDate } from '@/lib/pantry-helpers'
import { ingredientSeedMessage } from '@/lib/chat-seed'

const LABEL_MAX = 28

/**
 * Truncates for display only — callers keep the full string for `message`.
 * Splits on Unicode code points (`Array.from`), not UTF-16 code units
 * (`.slice`), so a surrogate pair (an emoji, some accented/CJK characters)
 * right at the boundary isn't cut in half into two unpaired halves.
 */
function truncateLabel(text: string, max: number = LABEL_MAX): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

function localMidnight(now: Date): Date {
  const copy = new Date(now)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function weekdayName(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d)
}

// ─── Slot 1: time-of-day ──────────────────────────────────────────────────────

function timePill(hour: number, servings: number): ChipConfig {
  if (hour >= 5 && hour <= 10) {
    return {
      label: 'Something quick for breakfast',
      message: 'Something quick for breakfast',
      tone: 'primary',
      emoji: '🍳',
    }
  }
  if (hour >= 11 && hour <= 15) {
    return {
      label: 'Something quick for lunch',
      message: 'Something quick for lunch',
      tone: 'primary',
      emoji: '🥪',
    }
  }
  if (hour >= 16 && hour <= 21) {
    const text = `Plan dinner for ${servings}`
    return { label: text, message: text, tone: 'primary', emoji: '🍽️' }
  }
  // 22:00–04:59
  return {
    label: 'A late-night snack idea',
    message: 'A late-night snack idea',
    tone: 'primary',
    emoji: '🌙',
  }
}

// ─── Slots 2-3 candidates, in priority order ──────────────────────────────────

function scanPill(ctx: StarterContext): ChipConfig | null {
  if (ctx.pantry_count !== 0) return null
  return {
    label: 'Scan a receipt',
    message: 'Scan a receipt',
    tone: 'fresh',
    emoji: '📷',
    kind: 'action',
    action: 'open_scan',
  }
}

function expiringPill(ctx: StarterContext, now: Date): ChipConfig | null {
  const today = localMidnight(now)
  let best: { name: string; days: number; expiry: Date } | null = null

  for (const item of ctx.expiring) {
    const expiry = parseLocalDate(item.expiry_date)
    if (Number.isNaN(expiry.getTime())) continue
    const days = Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (days < 0 || days > 3) continue
    // Strict '<' keeps the first-in-route-order item on a tie.
    if (!best || days < best.days) best = { name: item.name, days, expiry }
  }
  if (!best) return null

  const { name, days, expiry } = best
  const when = days === 0 ? 'today' : days === 1 ? 'by tomorrow' : `before ${weekdayName(expiry)}`
  return {
    label: `Use up the ${truncateLabel(name)} ${when}`,
    message: ingredientSeedMessage(name),
    tone: 'expiring',
    emoji: '⏳',
  }
}

function makeAgainPill(ctx: StarterContext): ChipConfig | null {
  if (ctx.recent_cooks.length === 0) return null

  const cuisineMatch = ctx.recent_cooks.find((r) => {
    const cuisine = r.cuisine?.trim().toLowerCase()
    return !!cuisine && ctx.recent_cuisines.includes(cuisine)
  })
  const chosen: StarterRecentCook = cuisineMatch ?? ctx.recent_cooks[0]
  const strippedTitle = chosen.title.replace(/^the\s+/i, '')

  return {
    label: `Make the ${truncateLabel(strippedTitle)} again`,
    message: `Show me my saved ${chosen.title}`,
    tone: 'accent',
    emoji: '🔁',
  }
}

function cuisinePill(ctx: StarterContext, beforeEleven: boolean): ChipConfig | null {
  const cuisine = ctx.recent_cuisines[0]
  if (!cuisine) return null
  const capitalised = cuisine.charAt(0).toUpperCase() + cuisine.slice(1)
  const text = `Something ${capitalised} ${beforeEleven ? 'today' : 'tonight'}?`
  return { label: text, message: text, tone: 'accent', emoji: '✨' }
}

function fillerPills(beforeEleven: boolean): ChipConfig[] {
  if (beforeEleven) {
    return [
      { label: 'What can I make today?', message: 'What can I make today?', tone: 'muted', emoji: '💡' },
      { label: 'Something quick and easy', message: 'Something quick and easy', tone: 'muted', emoji: '⚡' },
    ]
  }
  return [
    { label: 'What can I make tonight?', message: 'What can I make tonight?', tone: 'muted', emoji: '💡' },
    { label: 'Quick weeknight dinner', message: 'Quick weeknight dinner', tone: 'muted', emoji: '⚡' },
  ]
}

// ─── Ranker ────────────────────────────────────────────────────────────────────

/**
 * Rank the 3 starter pills for the empty chat screen. Pure: `now` is the only
 * time input and this never reads `Date.now()` itself.
 */
export function rankStarterPills(ctx: StarterContext | null, now: Date): ChipConfig[] {
  const hour = now.getHours()
  const beforeEleven = hour < 11
  const servings = ctx?.default_servings ?? 2

  const candidates: ChipConfig[] = []
  if (ctx) {
    const scan = scanPill(ctx)
    if (scan) candidates.push(scan)
    const expiring = expiringPill(ctx, now)
    if (expiring) candidates.push(expiring)
    const again = makeAgainPill(ctx)
    if (again) candidates.push(again)
    const cuisine = cuisinePill(ctx, beforeEleven)
    if (cuisine) candidates.push(cuisine)
  }
  candidates.push(...fillerPills(beforeEleven))

  const slot1 = timePill(hour, servings)
  const result: ChipConfig[] = [slot1]
  const seen = new Set([slot1.label.toLowerCase()])

  for (const candidate of candidates) {
    if (result.length >= 3) break
    const key = candidate.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }

  return result
}
