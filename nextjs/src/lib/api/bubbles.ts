/**
 * Bubbles ledger API client (issue #520).
 *
 * CRUD goes through the Next.js route (same-origin) — see the "two API
 * surfaces" rule in CLAUDE.md.
 */

'use client'

import { useQuery } from '@tanstack/react-query'

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
}

/**
 * The visitor's local calendar date as YYYY-MM-DD.
 *
 * Deliberately `toLocaleDateString`-based (en-CA formats as YYYY-MM-DD),
 * not `toISOString`, which is UTC and would credit the daily-visit award to
 * the wrong day for anyone not on UTC.
 */
function localDateString(): string {
  return new Date().toLocaleDateString('en-CA')
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
export function useBubbles(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['bubbles'],
    queryFn: getBubbles,
    enabled: options?.enabled,
    // No signed-in user on e.g. `/login` means every call 401s — don't
    // retry a request that can't succeed (default is 3 retries).
    retry: false,
  })
}
