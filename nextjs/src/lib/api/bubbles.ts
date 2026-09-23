/**
 * Bubbles ledger API client (issue #520).
 *
 * CRUD goes through the Next.js route (same-origin) — see the "two API
 * surfaces" rule in CLAUDE.md.
 */

'use client'

import { useQuery } from '@tanstack/react-query'
import { localDateString } from '@/lib/date'

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
  /** Consecutive clean (active + no waste) Mon-Sun weeks, most recent completed week counting back (#524). */
  streak_weeks: number
  /** Whether the current, still-in-progress week has already seen waste (#524). */
  wasted_this_week: boolean
}

/** Fetch the caller's bubble balance and recent events, awarding today's daily visit. */
export async function getBubbles(): Promise<BubblesResult> {
  const res = await fetch(`/api/bubbles?date=${localDateString()}`)

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load bubbles' }))
    throw new Error(data.error ?? `Failed to load bubbles: ${res.status}`)
  }

  return res.json()
}

/** React Query hook for the caller's bubble balance — query key `['bubbles']`. */
export function useBubbles() {
  return useQuery({
    queryKey: ['bubbles'],
    queryFn: getBubbles,
  })
}
