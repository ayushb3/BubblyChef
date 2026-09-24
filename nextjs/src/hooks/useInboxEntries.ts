'use client'

/**
 * Fetch-and-derive hook for the notification center (#496, Spec B.4).
 *
 * Thin `useQuery` wrapper around `deriveInboxEntries` (`lib/inbox-helpers.ts`,
 * the actually-tested pure logic) — server state goes through React Query
 * per CLAUDE.md's "React Query for server state only" rule, same convention
 * as `useDecorations`/`useBubbles` (`lib/api/kitchen.ts`, `lib/api/bubbles.ts`).
 * "Compute-on-load" (the issue's explicit decision) means no persistence
 * layer of its own — the cache here is ordinary React Query staleness, not
 * a stored inbox, and `refresh()` (called when the bell opens) just asks
 * React Query to refetch.
 *
 * Timers (Spec B.3, issue #619) are wired below via `useCookingTimers()` —
 * the real client-side store, mounted at the layout level
 * (`components/Providers.tsx`). Timers are local React state, not a network
 * fetch, so they can't live inside the React Query `queryFn` the way
 * pantry/recipes do: they're read directly via the hook and merged into the
 * derivation in a `useMemo`, independent of the query's own fetch/refetch
 * cycle, so a timer completing is reflected the next time this hook
 * re-renders rather than needing a `refresh()` call.
 *
 * The grocery pointer (Spec B.5) isn't wired to a real source yet — it's
 * left `undefined` in the derivation input, which `deriveInboxEntries`
 * treats as "feature absent" rather than "empty", so this hook needs no
 * further changes when it lands: whoever wires B.5 adds `groceryCount` to
 * `fetchInboxSources` below.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPantryItems } from '@/lib/api/pantry'
import { fetchRecipeCookMeta } from '@/lib/api/recipes'
import { useCookingTimers } from '@/lib/useCookingTimers'
import {
  deriveInboxEntries,
  type InboxDerivation,
  type InboxSourceData,
  type InboxTimerSource,
} from '@/lib/inbox-helpers'

const EMPTY: InboxDerivation = { entries: [], totalCount: 0, overflowCount: 0 }

/** The network-fetched half of `InboxSourceData` — everything but `timers`/`groceryCount`. */
type InboxNetworkSources = Pick<InboxSourceData, 'pantryItems' | 'recipes'>

/**
 * Both feed fetches now throw on a non-ok response (see their docstrings in
 * `lib/api/pantry.ts`/`lib/api/recipes.ts`) instead of degrading to `[]`, so
 * this rejects on a broken fetch — deliberately, so the query below lands in
 * an error state rather than a false-confident empty inbox.
 */
async function fetchInboxSources(): Promise<InboxNetworkSources> {
  const [pantryItems, recipes] = await Promise.all([fetchPantryItems(), fetchRecipeCookMeta()])
  // `?? []`: a defensive type-safety net, not a swallowed fetch error — both
  // clients are typed to always resolve an array (or reject, which the
  // query below still surfaces as `isError`). This only guards against a
  // non-array reaching the pure derivation below, which used to happen
  // silently inside this same async function's try/catch; now that the
  // derivation runs in a render-time `useMemo` (to merge in live timers, see
  // module docstring), an unguarded non-array would throw during render
  // instead of landing in React Query's error state.
  return { pantryItems: pantryItems ?? [], recipes: recipes ?? [] }
}

export interface UseInboxEntriesResult extends InboxDerivation {
  loading: boolean
  /** True when the last fetch failed — the caller shows a gentle error state, not an empty one. */
  error: boolean
  /** Re-run the fetch + derivation — called when the dropdown opens. */
  refresh: () => void
}

export function useInboxEntries(): UseInboxEntriesResult {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inbox-entries'],
    queryFn: fetchInboxSources,
  })

  // A completed timer stays listed until the user dismisses it elsewhere
  // (the cooking-timer dock owns dismissal, per #495/#619 — this hub only
  // lists it); running/paused timers don't belong in the inbox at all.
  const { timers: liveTimers } = useCookingTimers()
  const completedTimers = useMemo<InboxTimerSource[]>(
    () =>
      liveTimers
        .filter((t) => t.status === 'completed')
        .map((t) => ({ id: t.id, label: t.label })),
    [liveTimers],
  )

  const derivation = useMemo<InboxDerivation | undefined>(
    () => (data ? deriveInboxEntries({ ...data, timers: completedTimers }) : undefined),
    [data, completedTimers],
  )

  return {
    ...(derivation ?? EMPTY),
    loading: isLoading,
    error: isError,
    refresh: () => {
      void refetch()
    },
  }
}
