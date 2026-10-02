/**
 * Grocery list logic (issue #497 / Spec B.5). Pure: no I/O, no React, no
 * storage. Persistence is `lib/grocery-store.ts`; the list lives in the user's
 * browser (the issue's decision: regenerate on demand, no schema, no sync).
 *
 * Generation reads pantry rows (every input is already served by `/api/pantry`):
 *
 * - **depleted**: the food has rows but none with stock (`quantity <= 0`).
 * - **expiring**: the food has stock, but every lot with stock is expired or
 *   expires within `EXPIRING_DAYS` (`is_expired || days_until_expiry <= 1`).
 *
 * Rows are aggregated per food name first (issue #356, option A: separate rows
 * that sum), so a zero lot beside a full one, or an expiring lot beside a fresh
 * one, never puts the food on the list. One line per food.
 *
 * Regenerate keeps the user's checked and manual lines and refreshes the rest.
 */

import { cleanIngredientAmount } from '@/lib/ingredient-amount'
import { daysUntilExpiry } from '@/lib/pantry-helpers'

export type GrocerySource = 'depleted' | 'expiring' | 'manual'

export interface GroceryLine {
  /** `groceryFoodKey(name)`: the one-line-per-food identity. */
  key: string
  name: string
  quantity: number | null
  unit: string | null
  category: string
  source: GrocerySource
  checked: boolean
}

/** The subset of a pantry row generation reads. */
export interface GroceryPantryRow {
  /** The lot's id; part of a suggestion's fingerprint (see `dismissalsFor`). */
  id?: string
  name: string
  category?: string | null
  quantity: number
  unit?: string | null
  expiry_date?: string | null
  days_until_expiry?: number | null
  is_expired?: boolean
}

export interface ManualLineInput {
  name: string
  quantity?: number | null
  unit?: string | null
  category?: string
}

/** "Replace soon": expired, or expiring today or tomorrow. */
export const EXPIRING_DAYS = 1

const MAX_NAME = 100
const MAX_UNIT = 20

/**
 * The dedupe key for a food: lowercase, trimmed, single-spaced, with a trailing
 * plural folded ("Eggs" and "egg" are one food). Deliberately small; it only
 * has to stop the same food listing twice, not understand synonyms.
 */
export function groceryFoodKey(name: string): string {
  const base = name.trim().toLowerCase().replace(/\s+/g, ' ')
  if (base.length > 4 && base.endsWith('ies')) return `${base.slice(0, -3)}y`
  if (base.length > 3 && base.endsWith('s') && !/(ss|us|is)$/.test(base)) return base.slice(0, -1)
  return base
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

function compareCategory(a: string, b: string): number {
  if (a === b) return 0
  if (a === 'other') return 1
  if (b === 'other') return -1
  return a.localeCompare(b)
}

function sortLines(lines: GroceryLine[]): GroceryLine[] {
  return [...lines].sort(
    (a, b) => compareCategory(a.category, b.category) || a.name.localeCompare(b.name)
  )
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function rowDays(row: GroceryPantryRow): number | null {
  if (row.days_until_expiry !== undefined && row.days_until_expiry !== null) {
    return row.days_until_expiry
  }
  return row.expiry_date ? daysUntilExpiry(row.expiry_date) : null
}

function rowExpired(row: GroceryPantryRow, days: number | null): boolean {
  return row.is_expired === true || (days !== null && days < 0)
}

/** A lot with stock that is neither expired nor about to be. */
function isFresh(row: GroceryPantryRow): boolean {
  if (!(row.quantity > 0)) return false
  const days = rowDays(row)
  return !rowExpired(row, days) && (days === null || days > EXPIRING_DAYS)
}

/** A suggested line and the fingerprint of the pantry state that suggested it. */
interface Suggestion {
  line: GroceryLine
  fingerprint: string
}

/** One lot, for a fingerprint: its id (the name for a row without one). */
function lotId(row: GroceryPantryRow): string {
  return row.id ?? row.name
}

/**
 * What the pantry suggests buying: one per food, `depleted` or `expiring`, each
 * with a fingerprint of why: the food, the reason, and the lots that triggered
 * it (every lot for a ran-out food; each lot with stock, with its expiry, for an
 * expiring one). It is what a dismissal is keyed on, so it lasts until the
 * food is restocked and runs out again, or a different lot is expiring.
 */
function suggest(rows: GroceryPantryRow[]): Suggestion[] {
  const byFood = new Map<string, GroceryPantryRow[]>()
  for (const row of rows) {
    const name = row.name?.trim()
    if (!name) continue
    const key = groceryFoodKey(name)
    const lots = byFood.get(key)
    if (lots) lots.push(row)
    else byFood.set(key, [row])
  }

  const out: Suggestion[] = []
  for (const [key, lots] of byFood) {
    if (lots.some(isFresh)) continue // a healthy lot means the food isn't needed

    const first = lots[0]
    const category = lots.find((l) => l.category && l.category !== 'other')?.category ?? first.category ?? 'other'
    const inStock = lots.filter((l) => l.quantity > 0)

    if (inStock.length > 0) {
      // Only expired / about-to-expire stock: suggest replacing the biggest lot.
      const biggest = inStock.reduce((a, b) => (b.quantity > a.quantity ? b : a))
      const lotTokens = inStock.map((l) => `${lotId(l)}:${l.expiry_date ?? ''}`).sort()
      out.push({
        line: {
          key,
          name: first.name.trim(),
          quantity: biggest.quantity,
          unit: biggest.unit ?? null,
          category,
          source: 'expiring',
          checked: false,
        },
        fingerprint: `${key}|expiring|${lotTokens.join(',')}`,
      })
    } else {
      // Every lot is at zero: the last known amount is gone, only the unit survives.
      out.push({
        line: {
          key,
          name: first.name.trim(),
          quantity: null,
          unit: first.unit ?? null,
          category,
          source: 'depleted',
          checked: false,
        },
        fingerprint: `${key}|depleted|${lots.map(lotId).sort().join(',')}`,
      })
    }
  }
  return out
}

/** What the pantry says to buy: one line per food, `depleted` or `expiring`. */
export function generateGroceryLines(rows: GroceryPantryRow[]): GroceryLine[] {
  return sortLines(suggest(rows).map((s) => s.line))
}

/** food key -> the fingerprint of what the pantry suggests for it right now. */
export function suggestionFingerprints(rows: GroceryPantryRow[]): Map<string, string> {
  return new Map(suggest(rows).map((s) => [s.line.key, s.fingerprint]))
}

/**
 * The fingerprints to record when the user removes (or clears) these foods: one
 * for each the pantry suggests right now. A food it does not suggest (one the
 * user typed in) has none: removing that is just removing it.
 */
export function dismissalsFor(keys: readonly string[], rows: GroceryPantryRow[]): string[] {
  const prints = suggestionFingerprints(rows)
  return keys.flatMap((k) => {
    const p = prints.get(k)
    return p ? [p] : []
  })
}

/**
 * Drop dismissals the pantry no longer suggests: the food is back in stock, so
 * the next time it runs out it is a new suggestion, even if a lot kept its id.
 */
export function pruneDismissals(dismissed: readonly string[], rows: GroceryPantryRow[]): string[] {
  const current = new Set(suggestionFingerprints(rows).values())
  return dismissed.filter((d) => current.has(d))
}

/**
 * Regenerate: keep every checked line and every manual line as they are,
 * refresh the unchecked generated ones from the pantry. A refreshed line keeps
 * its name (only quantity, unit, category and reason update); a generated line
 * that is no longer needed is dropped; a newly needed food is added. A food
 * the user already holds (manual or checked) is never duplicated. A suggestion
 * the user dismissed (`dismissed`, fingerprints from `dismissalsFor`) is skipped
 * until the pantry state behind it changes.
 */
export function regenerateGroceryList(
  current: GroceryLine[],
  rows: GroceryPantryRow[],
  dismissed: readonly string[] = []
): GroceryLine[] {
  const skip = new Set(dismissed)
  const fresh = new Map(
    suggest(rows)
      .filter((s) => !skip.has(s.fingerprint))
      .map((s) => [s.line.key, s.line])
  )
  const kept: GroceryLine[] = []
  const held = new Set<string>()

  for (const line of current) {
    if (line.checked || line.source === 'manual') {
      kept.push(line)
      held.add(line.key)
      fresh.delete(line.key)
      continue
    }
    const update = fresh.get(line.key)
    if (update) {
      kept.push({
        ...line,
        quantity: update.quantity,
        unit: update.unit,
        category: update.category,
        source: update.source,
      })
      fresh.delete(line.key)
    }
    // else: no longer needed, dropped.
  }
  return sortLines([...kept, ...fresh.values()])
}

// ---------------------------------------------------------------------------
// Manual edits (each returns a new array)
// ---------------------------------------------------------------------------

function cleanName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ')
  return name && name.length <= MAX_NAME ? name : null
}

function cleanQuantity(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function cleanUnit(value: string | null | undefined): string | null {
  const unit = value?.trim()
  return unit && unit.length <= MAX_UNIT ? unit : null
}

/**
 * Add lines by hand, or append a pantry item ("Add to list") or a meal's
 * to-buy names. Takes plain names or `{name, quantity, unit, category}`. A food
 * already on the list is adopted as a manual line and un-checked (the user just
 * asked for it again) rather than duplicated.
 */
export function addManualLines(
  current: GroceryLine[],
  items: Array<string | ManualLineInput>
): GroceryLine[] {
  const lines = [...current]
  for (const raw of items) {
    const input: ManualLineInput = typeof raw === 'string' ? { name: raw } : raw
    const name = cleanName(input.name ?? '')
    if (!name) continue
    const key = groceryFoodKey(name)
    const quantity = cleanQuantity(input.quantity)
    const unit = cleanUnit(input.unit)

    const at = lines.findIndex((l) => l.key === key)
    if (at >= 0) {
      const existing = lines[at]
      lines[at] = {
        ...existing,
        source: 'manual',
        checked: false,
        quantity: quantity ?? existing.quantity,
        unit: unit ?? existing.unit,
      }
    } else {
      lines.push({
        key,
        name,
        quantity,
        unit,
        category: input.category?.trim() || 'other',
        source: 'manual',
        checked: false,
      })
    }
  }
  return sortLines(lines)
}

export function setLineChecked(current: GroceryLine[], key: string, checked: boolean): GroceryLine[] {
  return current.map((l) => (l.key === key ? { ...l, checked } : l))
}

/**
 * Edit quantity, unit or name. The line becomes the user's own (manual), or the
 * next regenerate would overwrite the edit. Renaming onto a food already on the
 * list merges into that line instead of duplicating it.
 */
export function updateLine(
  current: GroceryLine[],
  key: string,
  patch: { quantity?: number | null; unit?: string | null; name?: string }
): GroceryLine[] {
  const target = current.find((l) => l.key === key)
  if (!target) return current

  const next: GroceryLine = { ...target, source: 'manual' }
  if ('quantity' in patch) next.quantity = cleanQuantity(patch.quantity)
  if ('unit' in patch) next.unit = cleanUnit(patch.unit)
  if (patch.name !== undefined) {
    const name = cleanName(patch.name)
    if (!name) return current
    next.name = name
    next.key = groceryFoodKey(name)
  }

  if (next.key !== key && current.some((l) => l.key === next.key)) {
    return current.filter((l) => l.key !== key)
  }
  return sortLines(current.map((l) => (l.key === key ? next : l)))
}

export function removeLine(current: GroceryLine[], key: string): GroceryLine[] {
  return current.filter((l) => l.key !== key)
}

/** Clear the "got it" lines. */
export function clearCheckedLines(current: GroceryLine[]): GroceryLine[] {
  return current.filter((l) => !l.checked)
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** How many lines are still to buy (unchecked). */
export function countToBuy(lines: GroceryLine[]): number {
  return lines.filter((l) => !l.checked).length
}

export interface GroceryGroups {
  toBuy: { category: string; lines: GroceryLine[] }[]
  /** Checked lines, sunk to the bottom ("got it"). */
  gotIt: GroceryLine[]
}

export function groupGroceryLines(lines: GroceryLine[]): GroceryGroups {
  const toBuy = new Map<string, GroceryLine[]>()
  for (const l of sortLines(lines.filter((x) => !x.checked))) {
    const bucket = toBuy.get(l.category)
    if (bucket) bucket.push(l)
    else toBuy.set(l.category, [l])
  }
  return {
    toBuy: [...toBuy.entries()].map(([category, group]) => ({ category, lines: group })),
    gotIt: sortLines(lines.filter((x) => x.checked)),
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

/** `- Eggs (12 items)`; the amount is dropped when the line has none. */
export function formatGroceryLine(line: Pick<GroceryLine, 'name' | 'quantity' | 'unit'>): string {
  const name = capitalise(line.name.trim())
  // A count of a spice or liquid is no amount at all (#892).
  if (line.quantity === null || cleanIngredientAmount(line.name, line.quantity, line.unit).toTaste) {
    return `- ${name}`
  }
  let unit = line.unit?.trim() ?? ''
  if (unit === 'item' && line.quantity !== 1) unit = 'items'
  return `- ${name} (${unit ? `${formatNumber(line.quantity)} ${unit}` : formatNumber(line.quantity)})`
}

/** Plain text of the unchecked lines, one per line, for Share / copy. */
export function formatGroceryShareText(lines: GroceryLine[]): string {
  return sortLines(lines.filter((l) => !l.checked))
    .map(formatGroceryLine)
    .join('\n')
}
