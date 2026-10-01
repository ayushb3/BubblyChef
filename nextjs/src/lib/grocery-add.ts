/**
 * "Add to grocery list" for a recipe card (issue #744). The list is per-browser
 * (`lib/grocery-store.ts`), keyed by user id, so this resolves the signed-in
 * user and appends the names. A food already on the list is adopted, not
 * duplicated, and one already ticked off stays ticked (`addMissingToGroceryList`,
 * issue #787). Rejects when nobody is signed in.
 */

import { createClient } from '@/lib/supabase/client'
import { addMissingToGroceryList } from '@/lib/grocery-store'

export async function addItemsToMyGroceryList(items: string[]): Promise<void> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) throw new Error('Sign in to use your grocery list.')
  addMissingToGroceryList(user.id, items)
}
