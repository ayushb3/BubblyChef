/**
 * Pure grocery-list helpers (issue #497): share text, grouping, and request
 * validation for the `/api/grocery/*` routes. No I/O, no React.
 *
 * Regeneration is NOT here — it needs the Python cook matcher, staples list and
 * pantry model, so it lives in the AI service (`POST /v1/grocery/regenerate`).
 */

import type { GroceryItem, GroceryItemPatch, NewGroceryItem } from '@/types/grocery'

/** Mirrors `FoodCategory` in ai-service/bubbly_chef/models/pantry.py. */
export const GROCERY_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'seafood',
  'frozen',
  'canned',
  'dry_goods',
  'condiments',
  'beverages',
  'snacks',
  'bakery',
  'other',
] as const

const MAX_NAME = 100
const MAX_UNIT = 20
const MAX_BATCH = 50
const MAX_QUANTITY = 1_000_000

/** The plain dedupe key for a typed name. (The AI service also matches on its
 *  own normalised form, so synonyms the planner knows about don't double up.) */
export function simpleFoodKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

/** `- Eggs (12 items)`. The amount is dropped when the line has none. */
export function formatGroceryLine(item: Pick<GroceryItem, 'name' | 'quantity' | 'unit'>): string {
  const name = capitalise(item.name.trim())
  if (item.quantity === null || item.quantity === undefined) return `- ${name}`
  let unit = item.unit?.trim() ?? ''
  if (unit === 'item' && item.quantity !== 1) unit = 'items'
  const amount = unit ? `${formatNumber(item.quantity)} ${unit}` : formatNumber(item.quantity)
  return `- ${name} (${amount})`
}

function compareCategory(a: string, b: string): number {
  // "other" goes last; everything else alphabetical.
  if (a === b) return 0
  if (a === 'other') return 1
  if (b === 'other') return -1
  return a.localeCompare(b)
}

function sortLines(items: GroceryItem[]): GroceryItem[] {
  return [...items].sort(
    (a, b) => compareCategory(a.category, b.category) || a.name.localeCompare(b.name)
  )
}

/** Plain text of the unchecked lines, one per line, for Share / copy. */
export function formatGroceryShareText(items: GroceryItem[]): string {
  return sortLines(items.filter((i) => !i.checked))
    .map(formatGroceryLine)
    .join('\n')
}

export interface GroceryGroups {
  toBuy: { category: string; items: GroceryItem[] }[]
  /** Checked lines, sunk to the bottom ("got it"). */
  gotIt: GroceryItem[]
}

export function groupGroceryByCategory(items: GroceryItem[]): GroceryGroups {
  const toBuy = new Map<string, GroceryItem[]>()
  for (const line of sortLines(items.filter((i) => !i.checked))) {
    const bucket = toBuy.get(line.category)
    if (bucket) bucket.push(line)
    else toBuy.set(line.category, [line])
  }
  return {
    toBuy: [...toBuy.entries()].map(([category, lines]) => ({ category, items: lines })),
    gotIt: sortLines(items.filter((i) => i.checked)),
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  return name && name.length <= MAX_NAME ? name : null
}

type QuantityCheck = { ok: true; value: number | null } | { ok: false }

function checkQuantity(value: unknown): QuantityCheck {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) {
    return { ok: false }
  }
  return { ok: true, value }
}

function checkUnit(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > MAX_UNIT) return { ok: false }
  const unit = value.trim()
  return { ok: true, value: unit || null }
}

export interface ParsedNewItem {
  name: string
  key: string
  quantity: number | null
  unit: string | null
  category: string
}

/** Validate `POST /api/grocery/items`'s body. De-duplicates by `simpleFoodKey`. */
export function parseNewItems(
  body: unknown
): { items: ParsedNewItem[]; error: null } | { items: []; error: string } {
  const fail = (error: string) => ({ items: [] as [], error })
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0) {
    return fail('items must be a non-empty array')
  }
  if (body.items.length > MAX_BATCH) return fail(`at most ${MAX_BATCH} items at a time`)

  const seen = new Set<string>()
  const items: ParsedNewItem[] = []
  for (const raw of body.items as NewGroceryItem[]) {
    if (!isRecord(raw)) return fail('each item must be an object')
    const name = cleanName(raw.name)
    if (!name) return fail(`name is required (1-${MAX_NAME} characters)`)
    const quantity = checkQuantity(raw.quantity)
    if (!quantity.ok) return fail('quantity must be a non-negative number')
    const unit = checkUnit(raw.unit)
    if (!unit.ok) return fail(`unit must be text up to ${MAX_UNIT} characters`)
    const category = raw.category ?? 'other'
    if (typeof category !== 'string' || !(GROCERY_CATEGORIES as readonly string[]).includes(category)) {
      return fail('category is not a known food category')
    }
    const key = simpleFoodKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ name, key, quantity: quantity.value, unit: unit.value, category })
  }
  return { items, error: null }
}

/** Validate `PATCH /api/grocery/items/[id]`'s body: at least one known field. */
export function parseItemPatch(
  body: unknown
): { patch: GroceryItemPatch; error: null } | { patch: GroceryItemPatch; error: string } {
  const fail = (error: string) => ({ patch: {}, error })
  if (!isRecord(body)) return fail('body must be a JSON object')
  const patch: GroceryItemPatch = {}

  if ('checked' in body) {
    if (typeof body.checked !== 'boolean') return fail('checked must be true or false')
    patch.checked = body.checked
  }
  if ('quantity' in body) {
    const q = checkQuantity(body.quantity)
    if (!q.ok) return fail('quantity must be a non-negative number or null')
    patch.quantity = q.value
  }
  if ('unit' in body) {
    const u = checkUnit(body.unit)
    if (!u.ok) return fail(`unit must be text up to ${MAX_UNIT} characters or null`)
    patch.unit = u.value
  }
  if ('name' in body) {
    const name = cleanName(body.name)
    if (!name) return fail(`name must be 1-${MAX_NAME} characters`)
    patch.name = name
  }
  if (Object.keys(patch).length === 0) return fail('nothing to update')
  return { patch, error: null }
}

/** Share tokens are URL-safe and 16-128 characters; anything else can't match. */
export function isValidShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token)
}
