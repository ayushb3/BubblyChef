/**
 * The first-run "tick what you usually have" staples (issue #853).
 *
 * About two dozen common kitchen staples in four groups. Shelf-stable groups are
 * added with no expiry (`no_expiry`: salt does not go off in a month and a guessed
 * date would only put a false "expiring" nudge on it). The fridge basics add with
 * no date supplied, so the server gives them the normal category/location
 * estimate like any other add.
 */
import type { BulkAddItem } from '@/lib/api/pantry'

export type StapleGroupId = 'oils-condiments' | 'spices' | 'dry-goods' | 'fridge'

export interface Staple {
  name: string
  emoji: string
  quantity: number
  unit: string
  category: string
}

export interface StapleGroup {
  id: StapleGroupId
  title: string
  /** Where the group's items are put (the stored `pantry_items.location`). */
  location: 'pantry' | 'fridge'
  /** True for shelf-stable groups: added with no expiry date at all. */
  shelfStable: boolean
  items: readonly Staple[]
}

export const STAPLE_GROUPS: readonly StapleGroup[] = [
  {
    id: 'oils-condiments',
    title: 'Oils & condiments',
    location: 'pantry',
    shelfStable: true,
    items: [
      { name: 'Olive oil', emoji: '🫒', quantity: 1, unit: 'bottle', category: 'condiments' },
      { name: 'Vegetable oil', emoji: '🛢️', quantity: 1, unit: 'bottle', category: 'condiments' },
      { name: 'Soy sauce', emoji: '🥫', quantity: 1, unit: 'bottle', category: 'condiments' },
      { name: 'Vinegar', emoji: '🍶', quantity: 1, unit: 'bottle', category: 'condiments' },
      { name: 'Ketchup', emoji: '🍅', quantity: 1, unit: 'bottle', category: 'condiments' },
      { name: 'Honey', emoji: '🍯', quantity: 1, unit: 'item', category: 'condiments' },
    ],
  },
  {
    id: 'spices',
    title: 'Spices',
    location: 'pantry',
    shelfStable: true,
    items: [
      { name: 'Salt', emoji: '🧂', quantity: 1, unit: 'item', category: 'condiments' },
      { name: 'Black pepper', emoji: '⚫', quantity: 1, unit: 'item', category: 'condiments' },
      { name: 'Garlic powder', emoji: '🧄', quantity: 1, unit: 'item', category: 'condiments' },
      { name: 'Paprika', emoji: '🌶️', quantity: 1, unit: 'item', category: 'condiments' },
      { name: 'Cumin', emoji: '🌿', quantity: 1, unit: 'item', category: 'condiments' },
      { name: 'Cinnamon', emoji: '🪵', quantity: 1, unit: 'item', category: 'condiments' },
    ],
  },
  {
    id: 'dry-goods',
    title: 'Dry goods',
    location: 'pantry',
    shelfStable: true,
    items: [
      { name: 'Rice', emoji: '🍚', quantity: 1, unit: 'bag', category: 'dry_goods' },
      { name: 'Pasta', emoji: '🍝', quantity: 1, unit: 'bag', category: 'dry_goods' },
      { name: 'Flour', emoji: '🌾', quantity: 1, unit: 'bag', category: 'dry_goods' },
      { name: 'Sugar', emoji: '🍬', quantity: 1, unit: 'bag', category: 'dry_goods' },
      { name: 'Oats', emoji: '🥣', quantity: 1, unit: 'bag', category: 'dry_goods' },
      { name: 'Canned tomatoes', emoji: '🥫', quantity: 1, unit: 'can', category: 'canned' },
    ],
  },
  {
    id: 'fridge',
    title: 'Fridge basics',
    location: 'fridge',
    shelfStable: false,
    items: [
      { name: 'Eggs', emoji: '🥚', quantity: 12, unit: 'item', category: 'dairy' },
      { name: 'Milk', emoji: '🥛', quantity: 1, unit: 'L', category: 'dairy' },
      { name: 'Butter', emoji: '🧈', quantity: 1, unit: 'item', category: 'dairy' },
      { name: 'Cheese', emoji: '🧀', quantity: 1, unit: 'item', category: 'dairy' },
      { name: 'Yogurt', emoji: '🥛', quantity: 1, unit: 'item', category: 'dairy' },
      { name: 'Carrots', emoji: '🥕', quantity: 1, unit: 'bag', category: 'produce' },
    ],
  },
]

export const ALL_STAPLES: readonly Staple[] = STAPLE_GROUPS.flatMap((g) => g.items)

export function stapleKey(name: string): string {
  return name.trim().toLowerCase()
}

/** The bulk-add row for one ticked staple. */
export function stapleToBulkItem(group: StapleGroup, staple: Staple): BulkAddItem {
  return {
    name: staple.name,
    quantity: staple.quantity,
    unit: staple.unit,
    category: staple.category,
    storage_location: group.location,
    expiry_date: null,
    source: 'manual',
    // Shelf-stable: no date at all. Fridge basics leave it unset so the server
    // estimates one as it does for every other add.
    ...(group.shelfStable ? { no_expiry: true } : {}),
  }
}

/** Bulk-add rows for the ticked staple names, in group order. Unknown names are ignored. */
export function staplesToBulkItems(ticked: ReadonlySet<string>): BulkAddItem[] {
  const out: BulkAddItem[] = []
  for (const group of STAPLE_GROUPS) {
    for (const staple of group.items) {
      if (ticked.has(stapleKey(staple.name))) out.push(stapleToBulkItem(group, staple))
    }
  }
  return out
}
