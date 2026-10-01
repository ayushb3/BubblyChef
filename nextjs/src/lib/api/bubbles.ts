/**
 * Bubbles ledger API client (issue #520).
 *
 * CRUD goes through the Next.js route (same-origin) — see the "two API
 * surfaces" rule in CLAUDE.md.
 */

'use client'

import { useQuery } from '@tanstack/react-query'
import { clientTimeZone } from '@/lib/date'

export interface BubbleEvent {
  id: string
  user_id: string
  event_type: string
  amount: number
  ref_key: string
  created_at: string
}

export interface BubblesResult {
  balance: number
  recent: BubbleEvent[]
  /**
   * Consecutive clean (active + no waste) Mon-Sun weeks, most recent completed week counting back (#524).
   * `null` when the server had no trustworthy local date (no stored zone yet, #550): the streak was not
   * computed, which is not the same as a streak of 0 — show no indicator.
   */
  streak_weeks: number | null
  /** Whether the current, still-in-progress week has already seen waste (#524). */
  wasted_this_week: boolean
}

/**
 * Thrown by `getBubbles()` on a non-OK response; carries the HTTP status so
 * callers (e.g. the retry policy below) can branch on it without re-parsing
 * the message.
 */
export class BubblesFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'BubblesFetchError'
  }
}

function is401(error: unknown): boolean {
  return error instanceof BubblesFetchError && error.status === 401
}

/** Fetch the caller's bubble balance and recent events, awarding today's daily visit. */
export async function getBubbles(): Promise<BubblesResult> {
  // Send the IANA zone, not a date or a UTC offset (issue #550): the server
  // stores the account's zone once and derives the one accepted local date
  // from its own clock, so nothing the client sends per request can move the
  // `daily_visit` key a day forward or back.
  const params = new URLSearchParams()
  const tz = clientTimeZone()
  if (tz) params.set('tz', tz)
  const res = await fetch(`/api/bubbles?${params}`)

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load bubbles' }))
    throw new BubblesFetchError(data.error ?? `Failed to load bubbles: ${res.status}`, res.status)
  }

  return res.json()
}

/** React Query hook for the caller's bubble balance — query key `['bubbles']`. */
export function useBubbles(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['bubbles'],
    queryFn: getBubbles,
    enabled: options?.enabled,
    // The `enabled` gate (pathname !== '/login') already stops the
    // signed-out 401s from firing at all, so a blanket `retry: false` was
    // broader than it needed to be — it also silenced retries for transient
    // failures (a flaky network blip, a 500) on pages where the user *is*
    // signed in. Retry those a couple of times; still never retry a 401 that
    // slips through anyway (e.g. a session expiring mid-session), since
    // that can't succeed by retrying.
    retry: (count, error) => !is401(error) && count < 2,
  })
}
