'use client'

/**
 * Issue #745 — the meal screen's "N to buy" line (Goal 3 signature #4).
 *
 * "2 to buy: parsley, 1 lemon" with an "Add to grocery list" key. The missing
 * items come from the existing read-only meal-to-buy endpoint
 * (`fetchMealToBuy`, deterministic, no writes). The key puts exactly those
 * items on the client-side grocery list (`addToGroceryList`, which adopts a
 * food already on the list instead of duplicating it) and the line crossfades
 * to a confirmation with the count. A link to open the list comes when the
 * list gets its own page (issue #497).
 *
 * States: loading (a quiet skeleton), error (a retry key), nothing to buy
 * (a plain confirmation, no key), items (the line), added (the confirmation).
 *
 * Contract for the meal screen: `mealId` is the meal; `signature` is any
 * string that changes when the meal's dishes or servings do (it keys the
 * query so the line refreshes after a swap).
 */

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import SpringButton from '@/components/ui/SpringButton'
import { fetchMealToBuy } from '@/lib/api/grocery'
import { groceryFoodKey } from '@/lib/grocery'
import { addToGroceryList, loadGroceryLines } from '@/lib/grocery-store'
import { fetchUserId } from '@/hooks/useGroceryCount'
import { springs, useMotionConfig } from '@/lib/motion'

export interface MealToBuyLineProps {
  mealId: string
  signature: string
}

/** Names shown in the line before it folds into "+N more". */
const SHOWN = 4

export default function MealToBuyLine({ mealId, signature }: MealToBuyLineProps) {
  const { reduced } = useMotionConfig()
  const toBuy = useQuery({
    queryKey: ['meal-to-buy', mealId, signature],
    queryFn: () => fetchMealToBuy(mealId),
  })
  const user = useQuery({ queryKey: ['grocery-user-id'], queryFn: fetchUserId })
  // The count of the last add, per meal contents: a swap makes the line fresh again.
  const [addedFor, setAddedFor] = useState<{ key: string; count: number } | null>(null)
  const key = `${mealId}:${signature}`
  const added = addedFor?.key === key ? addedFor.count : null

  const frame =
    'flex flex-col gap-2 rounded-2xl border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[color:var(--color-text)]'

  if (toBuy.isLoading) {
    return (
      <div className={frame} data-testid="meal-to-buy-loading" aria-busy="true">
        <span className="sr-only">Checking what you need to buy</span>
        <span aria-hidden="true" className="h-5 w-2/3 animate-pulse rounded-full bg-[var(--color-border)] motion-reduce:animate-none" />
      </div>
    )
  }

  if (toBuy.isError) {
    return (
      <div className={frame} data-testid="meal-to-buy-error">
        <p className="font-semibold">Couldn&apos;t check what to buy.</p>
        <SpringButton
          variant="secondary"
          size="sm"
          className="inline-flex items-center justify-center self-start px-3.5 py-1.5 text-[13px]"
          onClick={() => void toBuy.refetch()}
        >
          Try again
        </SpringButton>
      </div>
    )
  }

  const names = toBuy.data ?? []

  if (names.length === 0) {
    return (
      <div className={frame} data-testid="meal-to-buy-none">
        <p className="font-semibold">
          <span aria-hidden="true">✓ </span>
          Nothing to buy: you have everything for this meal.
        </p>
      </div>
    )
  }

  const shown = names.slice(0, SHOWN).join(', ')
  const more = names.length > SHOWN ? `, +${names.length - SHOWN} more` : ''
  const fade = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: springs.soft }

  function handleAdd() {
    if (!user.data) return
    // A re-add must be harmless: `addManualLines` un-checks a food that is
    // already listed (right for "I just asked for it again" from a pantry
    // item), but here a ticked line means it was bought at the shop, so it
    // is left exactly as it is.
    const checked = new Set(
      loadGroceryLines(user.data)
        .filter((l) => l.checked)
        .map((l) => l.key),
    )
    const fresh = names.filter((n) => !checked.has(groceryFoodKey(n)))
    if (fresh.length > 0) addToGroceryList(user.data, fresh)
    setAddedFor({ key, count: names.length })
  }

  return (
    <div className={frame} data-testid="meal-to-buy-line">
      <AnimatePresence mode="wait" initial={false}>
        {added === null ? (
          <motion.div key="line" className="flex flex-col gap-2" {...fade}>
            <p className="min-w-0 break-words">
              <b className="font-extrabold">{names.length} to buy</b>: {shown}
              {more}
            </p>
            <SpringButton
              variant="primary"
              size="sm"
              className="inline-flex items-center justify-center self-start px-3.5 py-1.5 text-[13px]"
              onClick={handleAdd}
              disabled={!user.data}
            >
              Add to grocery list
            </SpringButton>
          </motion.div>
        ) : (
          <motion.p
            key="added"
            role="status"
            className="font-extrabold"
            data-testid="meal-to-buy-added"
            {...fade}
          >
            <motion.span
              aria-hidden="true"
              className="mr-1 inline-block"
              initial={reduced ? false : { scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={springs.pop}
            >
              ✓
            </motion.span>
            {added} added to your grocery list
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
