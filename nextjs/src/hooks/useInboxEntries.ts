'use client'

/**
 * Fetch-and-derive hook for the notification center (#496, Spec B.4).
 *
 * Thin wrapper around `deriveInboxEntries` (`lib/inbox-helpers.ts`, the
 * actually-tested pure logic): fetches the live feeds on mount/open and
 * hands the result to the pure derivation. No persistence, no polling — the
 * issue's "compute-on-load" decision means this only refetches when the
 * caller re-triggers it (the bell re-runs it each time the dropdown opens).
 *
 * Timers (Spec B.3) and the grocery pointer (Spec B.5) aren't wired to a
 * real source yet — neither has shipped. Both are left `undefined`, which
 * `deriveInboxEntries` treats as "feature absent" rather than "empty", so
 * this hook needs no changes when either lands: whoever wires B.3/B.5 swaps
 * `timers`/`groceryCount` for a real fetch here.
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchPantryItems } from '@/lib/api/pantry'
import { fetchRecipeCookMeta } from '@/lib/api/recipes'
import { deriveInboxEntries, type InboxDerivation } from '@/lib/inbox-helpers'

const EMPTY: InboxDerivation = { entries: [], totalCount: 0, overflowCount: 0 }

export interface UseInboxEntriesResult extends InboxDerivation {
  loading: boolean
  /** Re-run the fetch + derivation — called when the dropdown opens. */
  refresh: () => void
}

export function useInboxEntries(): UseInboxEntriesResult {
  const [state, setState] = useState<InboxDerivation>(EMPTY)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const [pantryItems, recipes] = await Promise.all([
          fetchPantryItems(),
          fetchRecipeCookMeta(),
        ])
        if (cancelled) return
        setState(deriveInboxEntries({ pantryItems, recipes }))
      } catch {
        // Both fetches already degrade to [] internally; this catch is a
        // last-resort net so a broken bell never throws in the header.
        if (!cancelled) setState(EMPTY)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = refresh()
    return cancel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ...state, loading, refresh }
}
