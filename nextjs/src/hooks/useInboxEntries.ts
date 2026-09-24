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
 * Timers (Spec B.3) and the grocery pointer (Spec B.5) aren't wired to a
 * real source yet — neither has shipped. Both are left `undefined` in the
 * derivation input, which `deriveInboxEntries` treats as "feature absent"
 * rather than "empty", so this hook needs no changes when either lands:
 * whoever wires B.3/B.5 adds `timers`/`groceryCount` to `fetchInboxSources`
 * below.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchPantryItems } from '@/lib/api/pantry'
import { fetchRecipeCookMeta } from '@/lib/api/recipes'
import { deriveInboxEntries, type InboxDerivation } from '@/lib/inbox-helpers'

const EMPTY: InboxDerivation = { entries: [], totalCount: 0, overflowCount: 0 }

/**
 * Both feed fetches already degrade to `[]` on their own failure (see their
 * docstrings in `lib/api/pantry.ts`/`lib/api/recipes.ts`), so this never
 * rejects — a broken fetch just derives an empty inbox rather than putting
 * the query into an error state.
 */
async function fetchInboxDerivation(): Promise<InboxDerivation> {
  const [pantryItems, recipes] = await Promise.all([fetchPantryItems(), fetchRecipeCookMeta()])
  return deriveInboxEntries({ pantryItems, recipes })
}

export interface UseInboxEntriesResult extends InboxDerivation {
  loading: boolean
  /** Re-run the fetch + derivation — called when the dropdown opens. */
  refresh: () => void
}

export function useInboxEntries(): UseInboxEntriesResult {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['inbox-entries'],
    queryFn: fetchInboxDerivation,
  })

  return {
    ...(data ?? EMPTY),
    loading: isLoading,
    refresh: () => {
      void refetch()
    },
  }
}
