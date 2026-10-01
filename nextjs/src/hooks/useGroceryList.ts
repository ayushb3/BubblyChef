'use client'

/**
 * `useGroceryList()` — the /grocery page's data and actions (issue #497 /
 * Spec B.5), on the data layer from PR #701.
 *
 * Server state (who the user is, the pantry) goes through React Query. The list
 * itself is per-browser (`lib/grocery-store.ts`) and read with
 * `useSyncExternalStore`, so a change from anywhere in the app (an "Add to
 * list" on a storage row, a recipe card) shows up without a refetch. Every
 * action reads the saved list fresh, applies one of the pure edits in
 * `lib/grocery.ts` and saves it; nothing here writes to the database.
 *
 * On open the list is regenerated once from the pantry (checked and manual
 * lines kept, the rest refreshed), so the page always agrees with the count the
 * inbox shows (`useGroceryCount`, which previews exactly this). After that it
 * stays put while the user shops; "Regenerate" is the way to pull the pantry
 * in again.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPantryItems } from '@/lib/api/pantry'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'
import {
  addManualLines,
  clearCheckedLines,
  countToBuy,
  dismissalsFor,
  formatGroceryShareText,
  pruneDismissals,
  regenerateGroceryList,
  removeLine,
  setLineChecked,
  updateLine,
  type GroceryLine,
} from '@/lib/grocery'
import { shareGroceryText, type ShareResult } from '@/lib/grocery-share'
import {
  loadGroceryDismissed,
  loadGroceryLines,
  parseGroceryLines,
  readGroceryRaw,
  saveGroceryLines,
  saveGroceryState,
  subscribeGrocery,
} from '@/lib/grocery-store'
import { fetchUserId } from '@/hooks/useGroceryCount'

/**
 * Regenerate the saved list from the pantry rows and save it: ticked and added
 * lines kept, dismissed suggestions skipped, and dismissals the pantry no
 * longer suggests (the food is back in stock) forgotten.
 */
function regenerateFrom(userId: string, rows: EnrichedPantryItem[]): void {
  const dismissed = loadGroceryDismissed(userId)
  saveGroceryState(
    userId,
    regenerateGroceryList(loadGroceryLines(userId), rows, dismissed),
    pruneDismissals(dismissed, rows),
  )
}

export type GroceryStatus = 'loading' | 'ready' | 'signed-out'

export interface UseGroceryListResult {
  status: GroceryStatus
  lines: GroceryLine[]
  /** Lines still to buy (unchecked). */
  toBuyCount: number
  /** The pantry could not be read, on open or on Regenerate. */
  pantryError: boolean
  regenerating: boolean
  setChecked: (key: string, checked: boolean) => void
  setAmount: (key: string, quantity: number | null, unit: string | null) => void
  remove: (key: string) => void
  add: (name: string) => void
  clearChecked: () => void
  regenerate: () => Promise<void>
  /** Share (or copy) the unchecked lines as plain text. */
  share: () => Promise<{ result: ShareResult; text: string }>
}

export function useGroceryList(): UseGroceryListResult {
  const user = useQuery({ queryKey: ['grocery-user-id'], queryFn: fetchUserId })
  const userId = user.data ?? ''

  // Under the ['pantry'] prefix so a pantry write elsewhere marks it stale.
  const pantry = useQuery({
    queryKey: ['pantry', 'grocery'],
    queryFn: fetchPantryItems,
    enabled: userId !== '',
    // A short retry: a page that waits out three backoffs before it shows the
    // saved list would feel hung.
    retry: 1,
    retryDelay: 300,
  })

  const getSnapshot = useCallback(() => readGroceryRaw(userId), [userId])
  const raw = useSyncExternalStore(subscribeGrocery, getSnapshot, () => '')
  const lines = useMemo(() => parseGroceryLines(raw), [raw])

  // Regenerate once, on open, as soon as the pantry is in (or has failed: the
  // saved list then stands on its own).
  const [seeded, setSeeded] = useState(false)
  const [regenFailed, setRegenFailed] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const pantryData = pantry.data
  const pantryFailed = pantry.isError
  useEffect(() => {
    if (seeded || !userId) return
    if (pantryData) {
      regenerateFrom(userId, pantryData)
      setSeeded(true)
    } else if (pantryFailed) {
      setSeeded(true)
    }
  }, [seeded, userId, pantryData, pantryFailed])

  const edit = useCallback(
    (fn: (current: GroceryLine[]) => GroceryLine[]) => {
      if (!userId) return
      saveGroceryLines(userId, fn(loadGroceryLines(userId)))
    },
    [userId],
  )

  const setChecked = useCallback(
    (key: string, checked: boolean) => edit((l) => setLineChecked(l, key, checked)),
    [edit],
  )
  const setAmount = useCallback(
    (key: string, quantity: number | null, unit: string | null) =>
      edit((l) => updateLine(l, key, { quantity, unit })),
    [edit],
  )
  // Removing a line the pantry is suggesting also dismisses that suggestion (its
  // fingerprint goes in the same record), so the next regenerate doesn't put it
  // straight back. A food the user typed in has no suggestion: it is just gone.
  const editAndDismiss = useCallback(
    (
      keysOf: (current: GroceryLine[]) => string[],
      fn: (current: GroceryLine[]) => GroceryLine[],
    ) => {
      if (!userId) return
      const current = loadGroceryLines(userId)
      const dismissed = [
        ...loadGroceryDismissed(userId),
        ...dismissalsFor(keysOf(current), pantryData ?? []),
      ]
      saveGroceryState(userId, fn(current), dismissed)
    },
    [userId, pantryData],
  )
  const remove = useCallback(
    (key: string) =>
      editAndDismiss(
        () => [key],
        (l) => removeLine(l, key),
      ),
    [editAndDismiss],
  )
  const add = useCallback((name: string) => edit((l) => addManualLines(l, [name])), [edit])
  const clearChecked = useCallback(
    () =>
      editAndDismiss(
        (l) => l.filter((x) => x.checked).map((x) => x.key),
        clearCheckedLines,
      ),
    [editAndDismiss],
  )

  const regenerate = useCallback(async () => {
    if (!userId || regenerating) return
    setRegenerating(true)
    setRegenFailed(false)
    try {
      // A failed refetch still hands back the last good data, so check the status.
      const res = await pantry.refetch()
      if (res.isError || !res.data) setRegenFailed(true)
      else regenerateFrom(userId, res.data)
    } catch {
      setRegenFailed(true)
    } finally {
      setRegenerating(false)
    }
  }, [userId, regenerating, pantry])

  const share = useCallback(async () => {
    const text = formatGroceryShareText(lines)
    return { result: await shareGroceryText(text), text }
  }, [lines])

  const status: GroceryStatus = user.isLoading
    ? 'loading'
    : userId === ''
      ? 'signed-out'
      : seeded
        ? 'ready'
        : 'loading'

  return {
    status,
    lines,
    toBuyCount: countToBuy(lines),
    pantryError: regenFailed || (seeded && pantryFailed),
    regenerating,
    setChecked,
    setAmount,
    remove,
    add,
    clearChecked,
    regenerate,
    share,
  }
}
