/**
 * "Add to grocery list" for a recipe card (issue #744). The list is per-browser
 * (`lib/grocery-store.ts`), keyed by user id, so this resolves the signed-in
 * user and appends the names. A food already on the list is adopted, not
 * duplicated, and one already ticked off stays ticked (`addMissingToGroceryList`,
 * issue #787). Rejects when nobody is signed in.
 */

import { createClient } from '@/lib/supabase/client'
import type { ManualLineInput } from '@/lib/grocery'
import { addMissingToGroceryList, addToGroceryList } from '@/lib/grocery-store'

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) throw new Error('Sign in to use your grocery list.')
  return user.id
}

/**
 * Items are bare names or entries with an amount, unit and category (issue
 * #868): a recipe card's key adds what the meal page's line adds, and an amount
 * already on a list line is never overwritten (`addMissingToGroceryList`).
 */
export async function addItemsToMyGroceryList(items: Array<string | ManualLineInput>): Promise<void> {
  addMissingToGroceryList(await currentUserId(), items)
}

/** The slice of a pantry row "Add to list" reads. */
export interface PantryItemForList {
  name: string
  category?: string | null
  unit?: string | null
}

/**
 * "Add to list" on a pantry row (issue #497): the storage list's cart key and
 * the edit sheet's button. The food goes on as a manual line with its unit and
 * category; no amount, because what is left in the pantry says nothing about
 * what to buy (the user sets it on the list). A food already on the list is
 * adopted and un-ticked, not duplicated: unlike a recipe's missing items, this
 * is the user asking for it again.
 */
export async function addPantryItemToMyGroceryList(item: PantryItemForList): Promise<void> {
  addToGroceryList(await currentUserId(), [
    {
      name: item.name,
      unit: item.unit,
      category: item.category ?? undefined,
    },
  ])
}
