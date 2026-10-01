'use client'

/**
 * `useGroceryCount()` — how many items are on the user's grocery list (issue
 * #497 / Spec B.5). Exposed for callers that want the count on its own; the
 * notification bell computes the same number inside `useInboxEntries` from the
 * pantry rows it already fetches (no second request), and the `/grocery` page
 * (`useGroceryList`) shows exactly this after its on-open regenerate.
 *
 * The count is what the list shows after a Regenerate: the saved list (checked
 * and manual lines kept) merged with what the pantry says is depleted or
 * expiring, counting the unchecked lines. It is a preview; it never writes
 * storage. If the pantry can't be read it falls back to the saved list alone.
 *
 * Server state (who the user is, the pantry) goes through React Query; the list
 * itself is per-browser (`lib/grocery-store.ts`) and read with
 * `useSyncExternalStore`, so an "Add to list" elsewhere in the app, or a change
 * in another tab, updates the count without a refetch.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { fetchPantryItems } from '@/lib/api/pantry'
import { countToBuy, regenerateGroceryList } from '@/lib/grocery'
import {
  parseGroceryDismissed,
  parseGroceryLines,
  readGroceryRaw,
  subscribeGrocery,
} from '@/lib/grocery-store'

/** Who the grocery list belongs to (shared with the meal screen's "N to buy" line, issue #745). */
export async function fetchUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  return user?.id ?? null
}

export interface UseGroceryCountResult {
  count: number
  /** True until the user and pantry have resolved (or failed). */
  loading: boolean
}

export function useGroceryCount(): UseGroceryCountResult {
  const user = useQuery({ queryKey: ['grocery-user-id'], queryFn: fetchUserId })
  const userId = user.data ?? ''

  // Under the ['pantry'] prefix so every pantry write that invalidates it also
  // refreshes the count.
  const pantry = useQuery({
    queryKey: ['pantry', 'grocery'],
    queryFn: fetchPantryItems,
    enabled: userId !== '',
  })

  const getSnapshot = useCallback(() => readGroceryRaw(userId), [userId])
  const raw = useSyncExternalStore(subscribeGrocery, getSnapshot, () => '')

  const count = useMemo(() => {
    if (!userId) return 0
    const saved = parseGroceryLines(raw)
    return countToBuy(
      pantry.data ? regenerateGroceryList(saved, pantry.data, parseGroceryDismissed(raw)) : saved,
    )
  }, [userId, raw, pantry.data])

  const loading = user.isLoading || (userId !== '' && pantry.isLoading)
  return { count, loading }
}
