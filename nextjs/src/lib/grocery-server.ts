/**
 * Server-side helpers shared by the `/api/grocery/*` routes (issue #497).
 *
 * Every query here is scoped by `user_id` itself, on top of the RLS policies in
 * `00018_grocery_list.sql` — the route never relies on the policy alone.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GroceryItem, GroceryListInfo, GrocerySource } from '@/types/grocery'

export const ITEM_COLUMNS =
  'id, name, quantity, unit, category, source, source_ref, checked, checked_at'

/** A `grocery_items` row as the API returns it: no user id, no list id. */
export function toItem(row: Record<string, unknown>): GroceryItem {
  return {
    id: String(row.id),
    name: String(row.name),
    quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
    unit: (row.unit as string | null) ?? null,
    category: (row.category as string | null) ?? 'other',
    source: ((row.source as GrocerySource | null) ?? 'manual') as GrocerySource,
    source_ref: (row.source_ref as string | null) ?? null,
    checked: Boolean(row.checked),
    checked_at: (row.checked_at as string | null) ?? null,
  }
}

const LIST_COLUMNS = 'id, share_token, last_regenerated_at'

/** The user's list, or null when they've never touched it. */
export async function findList(
  supabase: SupabaseClient,
  userId: string
): Promise<GroceryListInfo | null> {
  const { data, error } = await supabase
    .from('grocery_lists')
    .select(LIST_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as GroceryListInfo | null) ?? null
}

/** The user's one list, created on first use. `user_id` is UNIQUE, so two
 *  concurrent first calls collapse into one row. */
export async function getOrCreateList(
  supabase: SupabaseClient,
  userId: string
): Promise<GroceryListInfo> {
  const existing = await findList(supabase, userId)
  if (existing) return existing
  const { error } = await supabase
    .from('grocery_lists')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  const created = await findList(supabase, userId)
  if (!created) throw new Error('Could not create the grocery list')
  return created
}
