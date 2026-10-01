'use client'

/**
 * Issue #654 PR A — extracted from `CookModal.tsx` so the combined meal-cook
 * sheet (`components/meal/MealCookSheet.tsx`) can reuse the same review body,
 * missing-items list and footer summary as the single-recipe modal, with no
 * behaviour change to either caller. This file never imports `CookModal` —
 * `CookModal` imports from here and re-exports the names existing callers
 * already depend on (`summariseDeductions`, `MissingItemsList`,
 * `compoundOverrideKey`, `effectiveCompoundOverride`, `ExpiredIngredientsBanner`,
 * `dedupeByPantryItemId`).
 */

import React from 'react'
import type {
  CookProposal,
  CompoundSuggestion,
  CompoundComponent,
  IngredientMatch,
  DeductionItem,
  ExpiredMatchedItem,
} from '@/types/recipes'

/**
 * What both review bodies (the single-recipe modal and the combined meal
 * sheet) need from a proposal. `MealCookProposal` (its `matches` are
 * `MealIngredientMatch`, which extends `IngredientMatch`) is assignable to
 * this without change — the widening from `CookProposal` is type-only.
 */
export type CookReviewProposal = Pick<
  CookProposal,
  'matches' | 'missing' | 'missing_notes' | 'compound_suggestions' | 'expired_items'
>

function statusColor(status: IngredientMatch['status']): string {
  switch (status) {
    case 'ready':
      return 'var(--color-fresh)'
    case 'substitute':
      return 'var(--color-expiring)'
    case 'shortfall':
      return 'var(--color-expiring)'
    case 'imprecise':
      return 'var(--color-accent)'
    case 'unit_conflict':
      return 'var(--color-expiring)'
    case 'missing':
      return 'var(--color-border)'
    case 'assumed':
    case 'to_taste':
      return 'var(--color-border)'
    default:
      return 'var(--color-border)'
  }
}

function statusLabel(status: IngredientMatch['status']): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'substitute':
      return 'Substitute'
    case 'shortfall':
      return 'Not enough'
    case 'imprecise':
      return 'Have it'
    case 'unit_conflict':
      return 'Unit conflict'
    case 'missing':
      return 'Missing'
    case 'assumed':
      return 'Assumed'
    case 'to_taste':
      return 'To taste'
    default:
      return status
  }
}

/** Rows shown as a summary line below the table, not as table rows. */
function isQuietLine(m: IngredientMatch): boolean {
  return m.status === 'assumed' || m.status === 'to_taste'
}

function formatQty(qty: number | null, unit: string | null): string {
  if (qty == null) return '—'
  const rounded = Math.round(qty * 100) / 100
  return unit ? `${rounded} ${unit}` : String(rounded)
}

/**
 * Pre-review warning banner for matched ingredients that come from expired
 * pantry rows. Non-blocking — the user can dismiss and proceed.
 *
 * Exported for unit testing (and re-exported from `CookModal` for existing
 * callers).
 */
export function ExpiredIngredientsBanner({
  expiredItems,
  onDismiss,
  heading = 'Expired ingredients in this recipe',
}: {
  expiredItems: ExpiredMatchedItem[]
  onDismiss: () => void
  /** The meal sheet says "this meal"; the single-recipe default is unchanged. */
  heading?: string
}) {
  if (expiredItems.length === 0) return null
  return (
    <div
      role="alert"
      className="font-sans flex flex-col gap-1.5 rounded-xl px-3 py-2.5 border border-[var(--color-expired)]"
      style={{
        background: 'color-mix(in srgb, var(--color-expired) 12%, var(--color-surface))',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-[var(--color-text)]">
          {heading}
        </p>
        <button
          onClick={onDismiss}
          className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-xs leading-none shrink-0 px-1"
          aria-label="Dismiss expired ingredients warning"
        >
          ✕
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {expiredItems.map((item) => (
          <li key={`${item.ingredient_name}-${item.pantry_item_name}`} className="text-[11px] text-[var(--color-text)]">
            <span className="font-semibold">{item.ingredient_name}</span>
            <span className="text-[var(--color-muted)]">
              {' '}— {item.pantry_item_name} expired {item.days_expired} day
              {item.days_expired === 1 ? '' : 's'} ago
            </span>
          </li>
        ))}
      </ul>
      <a
        href="/pantry"
        className="text-[11px] font-bold underline"
        style={{ color: 'var(--color-primary-dark)' }}
        aria-label="Go to pantry to clear expired items"
      >
        Go to Pantry to clear them →
      </a>
    </div>
  )
}

/**
 * Stable key for a compound-substitution component's override input, distinct
 * from the numeric row-index keys unit_conflict rows use in the same
 * `overrides` map (#284).
 */
export function compoundOverrideKey(ingredientName: string, pantryItemId: string): string {
  return `compound:${ingredientName}:${pantryItemId}`
}

/**
 * Defensive dedupe by `pantry_item_id`, keeping the first occurrence.
 *
 * The backend already dedupes `resolved_component_items` before it ever
 * reaches the wire (issue #284 follow-up), but two component_items sharing a
 * pantry_item_id would otherwise render mirrored inputs with the same React
 * key and the same override key, and double-deduct whatever quantity the
 * user types. Applied everywhere component_items is consumed, not just where
 * it renders.
 */
export function dedupeByPantryItemId(items: CompoundComponent[]): CompoundComponent[] {
  const seen = new Set<string>()
  const deduped: CompoundComponent[] = []
  for (const item of items) {
    if (seen.has(item.pantry_item_id)) continue
    seen.add(item.pantry_item_id)
    deduped.push(item)
  }
  return deduped
}

/**
 * The quantity string that a compound component's input actually shows, and
 * that its deduction is actually computed from (#284 Option B, 2026-09-27) —
 * the user's typed override if one exists (including an explicit empty
 * string, meaning "cleared"), else the model's `suggested_quantity` pre-fill,
 * else blank.
 *
 * One function used by both `MissingItemsList` (what to render) and
 * `summariseDeductions` (what to deduct) so the two can never disagree.
 */
export function effectiveCompoundOverride(
  overrides: Record<string, string>,
  key: string,
  suggestedQuantity: number | null | undefined,
): string {
  if (key in overrides) return overrides[key]
  return suggestedQuantity != null && suggestedQuantity > 0 ? String(suggestedQuantity) : ''
}

/**
 * "Not in pantry" list — exported for unit testing (and re-exported from
 * `CookModal` for existing callers).
 *
 * Items with a note render as a small vertical block (name + muted note below).
 * Items with a compound suggestion show the suggestion beneath the chip.
 * An ingredient can have BOTH a note and a compound suggestion — they are
 * complementary. Both are shown when present. Items without either render as
 * plain chips.
 *
 * `sourceNote` (issue #654) is an optional per-name line rendered under the
 * name, exactly like `missingNotes` — used by the combined meal sheet to show
 * "Needed for Pasta + Salad" under an ingredient more than one dish lacks.
 * Without the prop this renders exactly as it did before #654.
 */
export function MissingItemsList({
  missing,
  missingNotes = {},
  compoundSuggestions = [],
  overrides = {},
  onOverrideChange,
  sourceNote,
}: {
  missing: string[]
  missingNotes?: Record<string, string>
  compoundSuggestions?: CompoundSuggestion[]
  overrides?: Record<string, string>
  onOverrideChange?: (key: string, value: string) => void
  sourceNote?: (name: string) => string | null
}) {
  if (missing.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {missing.map((name: string) => {
        const note = missingNotes[name]
        const source = sourceNote?.(name) ?? null
        const suggestion = compoundSuggestions.find(
          (s: CompoundSuggestion) => s.ingredient_name.toLowerCase() === name.toLowerCase(),
        )
        // Defensive dedupe: the backend keys resolved_component_items by
        // pantry_item_id (issue #284 follow-up), but an older cached proposal
        // or a future regression could still hand us two component_items for
        // the same row. Rendering both would give two inputs sharing one
        // React key and one override key, silently mirroring whatever the
        // user types into either — so collapse to the first here too.
        const componentItems = dedupeByPantryItemId(suggestion?.component_items ?? [])
        return (
          <div key={name} className="flex flex-col gap-0.5">
            {note || source ? (
              <div className="font-sans">
                <span className="font-semibold text-xs text-[var(--color-text)]">⚠️ {name}</span>
                {note && (
                  <span
                    className="block font-normal leading-snug text-[var(--color-muted)] mt-0.5 break-words"
                    style={{ fontSize: '10px' }}
                  >
                    {note}
                  </span>
                )}
                {source && (
                  <span
                    className="block font-normal leading-snug text-[var(--color-muted)] mt-0.5 break-words"
                    style={{ fontSize: '10px' }}
                  >
                    {source}
                  </span>
                )}
              </div>
            ) : (
              <span
                className="font-sans inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-[var(--color-border)] text-[var(--color-muted)] self-start"
              >
                ⚠️ {name}
              </span>
            )}
            {suggestion && (
              <div
                className="font-sans ml-2 text-[10px] leading-snug text-[var(--color-muted)]"
                aria-label={`Compound substitution suggestion for ${name}`}
              >
                <span className="font-semibold">Try combining: </span>
                {suggestion.components.join(' + ')}
                <span className="block italic mt-0.5">{suggestion.note}</span>
                {componentItems.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1.5" aria-label={`Use how much of each for ${name}`}>
                    {/* Only shown when at least one component actually has an
                        input to explain (#284 round 7, round-6 leftover) — a
                        suggestion where every component has a null base_unit
                        renders only "can't deduct" notes below, and a heading
                        about typing quantities over a list with no typable
                        input is worse than no heading at all. */}
                    {componentItems.some((c) => c.base_unit) && (
                      <span className="not-italic text-[9px] text-[var(--color-muted)]">
                        Used this swap? These amounts come out of your pantry — clear any you
                        didn&apos;t use.
                      </span>
                    )}
                    {componentItems.map((component) => {
                      const key = compoundOverrideKey(suggestion.ingredient_name, component.pantry_item_id)
                      // A component with no derivable base_unit can never
                      // actually be deducted — repo.deduct_pantry_item
                      // refuses a row with no recorded or derivable base
                      // unit — so there is no unit the typed number could be
                      // interpreted in. Render no input for it at all rather
                      // than one whose value silently goes nowhere.
                      if (!component.base_unit) {
                        return (
                          <div key={key} className="flex items-center gap-1.5">
                            <span className="flex-1 not-italic text-[var(--color-text)] font-semibold">
                              {component.name}
                            </span>
                            <span className="italic text-[var(--color-muted)] text-right">
                              can&apos;t deduct {component.name} automatically (no unit on that
                              pantry item)
                            </span>
                          </div>
                        )
                      }
                      return (
                        <div key={key} className="flex items-center gap-1.5">
                          <span className="flex-1 not-italic text-[var(--color-text)] font-semibold">
                            {component.name}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={effectiveCompoundOverride(overrides, key, component.suggested_quantity)}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              onOverrideChange?.(key, e.target.value)
                            }
                            className="w-14 text-right border border-[var(--color-border)] rounded px-1 py-0.5 text-xs not-italic"
                            placeholder="qty"
                            aria-label={`Deduct quantity for ${component.name} (${name} substitution)`}
                          />
                          <span className="not-italic w-8">{component.base_unit}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Adds `deductQty` to `map`'s entry for `pantryItemId`, creating it with
 * `fallbackUnit` if this is the first deduction to touch that row. Shared by
 * both the matched-ingredient pass and the compound-component pass in
 * `summariseDeductions`.
 */
export function mergeDeduction(
  map: Map<string, DeductionItem>,
  pantryItemId: string,
  deductQty: number,
  fallbackUnit: string | null,
): void {
  const existing = map.get(pantryItemId)
  if (existing) {
    existing.deduct_qty += deductQty
  } else {
    map.set(pantryItemId, {
      pantry_item_id: pantryItemId,
      deduct_qty: deductQty,
      base_unit: fallbackUnit ?? 'item',
    })
  }
}

/**
 * Splits the proposal into what will actually be deducted and what will not.
 *
 * The two are derived together on purpose: the confirm payload and the summary
 * shown above the button must never disagree. `proposal` is typed as
 * `CookReviewProposal` (issue #654) so a `MealCookProposal` — whose matches
 * are `MealIngredientMatch`, a superset of `IngredientMatch` — is assignable
 * without a cast.
 */
export function summariseDeductions(
  proposal: CookReviewProposal,
  overrides: Record<string, string>,
): {
  deductions: DeductionItem[]
  /** Matched rows that will NOT be deducted, and why. */
  skipped: Array<{ name: string; reason: 'needs_quantity' | 'imprecise' | 'no_quantity' }>
  /** Count of matched (non-missing) rows considered. */
  matchedCount: number
  /** Compound-substitution component deductions the user opted into, with display names. */
  compoundDeductions: Array<{ ingredientName: string; componentName: string; deductQty: number }>
  /** Distinct pantry rows deducted by matched ingredients alone (excludes compound components). */
  matchesDeductionCount: number
} {
  const byPantryItem = new Map<string, DeductionItem>()
  const skipped: Array<{ name: string; reason: 'needs_quantity' | 'imprecise' | 'no_quantity' }> =
    []
  let matchedCount = 0

  proposal.matches.forEach((m: IngredientMatch, i: number) => {
    // A to-taste seasoning is never counted: nothing to deduct, nothing to resolve (#756).
    if (m.pantry_item_id == null || m.status === 'missing' || m.status === 'to_taste') return
    matchedCount += 1

    // For unit_conflict rows, use the user's override qty (or 0 if not set).
    // Keyed by row index, not pantry item — two rows sharing an item still
    // need their own input.
    const isConflict = m.status === 'unit_conflict'
    const deductQty = isConflict
      ? parseFloat(overrides[String(i)] ?? '0') || 0
      : (m.deduct_qty ?? 0)

    if (deductQty <= 0) {
      // 'imprecise' is not a gap the user can close by typing a number — the
      // recipe's pieces cannot be measured against a package row, so it is
      // reported separately from rows that are merely awaiting a quantity.
      skipped.push({
        name: m.ingredient_name,
        reason: isConflict
          ? 'needs_quantity'
          : m.status === 'imprecise'
            ? 'imprecise'
            : 'no_quantity',
      })
      return
    }

    // Several recipe lines can resolve to one pantry row — literal duplicates,
    // or names the backend collapses onto the same item. Emitting one entry
    // per match would then send two deductions for one row, so this sums
    // defensively here too, keeping the payload honest about what is
    // actually being deducted.
    mergeDeduction(byPantryItem, m.pantry_item_id, deductQty, m.base_unit)
  })

  // Captured before compound components are folded in, so the primary
  // "X of Y ingredients" sentence stays about recipe lines even when a
  // compound component happens to land on a pantry row no matched
  // ingredient touched (#284) — otherwise X could exceed Y.
  const matchesDeductionCount = byPantryItem.size

  // Compound substitution components (#284): only a positive effective
  // quantity — the user's typed override, or the model's pre-filled
  // suggested_quantity if the user hasn't touched the input (Option B,
  // 2026-09-27; see effectiveCompoundOverride) — turns a suggested component
  // into a real deduction. A component can share a pantry row with a matched
  // ingredient (or another component), so it merges into the same map by
  // pantry_item_id rather than always appending a fresh entry.
  const compoundDeductions: Array<{ ingredientName: string; componentName: string; deductQty: number }> = []
  // Tracks every compoundOverrideKey already applied across ALL suggestions,
  // not just within one — the backend can emit two CompoundSuggestion
  // entries for the same ingredient_name with no dedup.
  const appliedCompoundKeys = new Set<string>()
  for (const suggestion of proposal.compound_suggestions ?? []) {
    // Defensive dedupe (see dedupeByPantryItemId): guards against a proposal
    // that somehow still carries two component_items for the same pantry
    // row, which would otherwise merge (and double-deduct) twice here.
    for (const component of dedupeByPantryItemId(suggestion.component_items ?? [])) {
      // No input is ever rendered for a null-base_unit component (see
      // MissingItemsList above), so no override should exist for its key in
      // practice — but this guards defensively against a stale overrides
      // entry still reaching repo.deduct_pantry_item, which refuses the row
      // and silently drops the write anyway.
      if (!component.base_unit) continue

      const key = compoundOverrideKey(suggestion.ingredient_name, component.pantry_item_id)
      if (appliedCompoundKeys.has(key)) continue
      appliedCompoundKeys.add(key)

      // Reads the same value effectiveCompoundOverride would render into the
      // input (typed override, else the model's pre-fill, else blank).
      const deductQty =
        parseFloat(effectiveCompoundOverride(overrides, key, component.suggested_quantity) || '0') || 0
      if (deductQty <= 0) continue

      compoundDeductions.push({
        ingredientName: suggestion.ingredient_name,
        componentName: component.name,
        deductQty,
      })

      mergeDeduction(byPantryItem, component.pantry_item_id, deductQty, component.base_unit)
    }
  }

  return {
    deductions: Array.from(byPantryItem.values()),
    skipped,
    matchedCount,
    compoundDeductions,
    matchesDeductionCount,
  }
}

export interface CookReviewBodyProps {
  proposal: CookReviewProposal
  overrides: Record<string, string>
  onOverrideChange: (key: string, value: string) => void
  expiredDismissed: boolean
  onDismissExpired: () => void
  /** Rendered under the ingredient name, like the substitution note. Used by the combined meal sheet's shared-line "From Pasta (2 cloves) + Salad (1 clove)". */
  sourceNote?: (m: IngredientMatch) => string | null
  /** Rendered under each missing name, e.g. "Needed for Pasta + Salad". Forwarded to `MissingItemsList`'s `sourceNote`. */
  missingSourceNote?: (name: string) => string | null
  /** The expired banner's heading; defaults to the single-recipe copy. */
  expiredHeading?: string
}

/**
 * The review body — the expired banner, the ingredient table, collapsed
 * staples, and the "Not in pantry" section. Extracted from `CookModal.tsx`
 * (issue #654) so the combined meal sheet can render the same shape for a
 * merged, multi-dish proposal. No behaviour change for `CookModal`.
 */
export function CookReviewBody({
  proposal,
  overrides,
  onOverrideChange,
  expiredDismissed,
  onDismissExpired,
  sourceNote,
  missingSourceNote,
  expiredHeading,
}: CookReviewBodyProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Expired-ingredient pre-cook warning — non-blocking */}
      {!expiredDismissed && (proposal.expired_items ?? []).length > 0 && (
        <ExpiredIngredientsBanner
          expiredItems={proposal.expired_items ?? []}
          onDismiss={onDismissExpired}
          heading={expiredHeading}
        />
      )}

      {/* Ingredient table — assumed staples and to-taste seasonings are collapsed into summary lines below */}
      {proposal.matches.filter((m: IngredientMatch) => !isQuietLine(m)).length > 0 && (
        <table className="font-sans w-full text-xs">
          <thead>
            <tr className="text-[var(--color-muted)] text-left">
              <th className="pb-1 font-semibold">Ingredient</th>
              <th className="pb-1 font-semibold">Pantry match</th>
              <th className="pb-1 font-semibold text-right">Deduct</th>
              <th className="pb-1 font-semibold text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {proposal.matches
              .map((m: IngredientMatch, origIdx: number) => ({ m, origIdx }))
              .filter(({ m }) => !isQuietLine(m))
              .map(({ m, origIdx }) => {
                const note = sourceNote?.(m) ?? null
                return (
                  <tr key={origIdx} className="border-t border-[var(--color-border)]">
                    <td className="py-1.5 pr-2 font-semibold text-[var(--color-text)]">
                      {m.ingredient_name}
                      {m.match_type === 'substitute' && m.substitution_note && (
                        <span className="block font-normal text-[10px] leading-snug text-[var(--color-muted)] mt-0.5">
                          {m.substitution_note}
                        </span>
                      )}
                      {note && (
                        <span className="block font-normal text-[10px] leading-snug text-[var(--color-muted)] mt-0.5">
                          {note}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-[var(--color-muted)]">
                      {m.pantry_item_name ?? '—'}
                      {m.match_type === 'substitute' && (
                        <span className="block text-[10px] italic mt-0.5">substituted</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-[var(--color-muted)]">
                      {m.status === 'unit_conflict' ? (
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={overrides[String(origIdx)] ?? ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            onOverrideChange(String(origIdx), e.target.value)
                          }
                          className="w-16 text-right border border-[var(--color-border)] rounded px-1 py-0.5 text-xs"
                          placeholder="qty"
                          aria-label={`Deduct quantity for ${m.ingredient_name}`}
                        />
                      ) : (
                        formatQty(m.deduct_qty, m.base_unit)
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{
                          background: statusColor(m.status),
                          color: 'var(--color-charcoal)',
                        }}
                      >
                        {statusLabel(m.status)}
                      </span>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      )}

      {/* Assumed staples — collapsed into one unobtrusive line (#305) */}
      {(() => {
        const assumedNames = proposal.matches
          .filter((m: IngredientMatch) => m.status === 'assumed')
          .map((m: IngredientMatch) => m.ingredient_name)
        if (assumedNames.length === 0) return null
        return (
          <p
            className="font-sans text-[10px] text-[var(--color-muted)] italic"
            aria-label="Assumed culinary staples"
          >
            Basics assumed: {assumedNames.join(', ')}
          </p>
        )
      })()}

      {/* Seasonings with no amount — one quiet line, not counted anywhere (#756) */}
      {(() => {
        const toTasteNames = proposal.matches
          .filter((m: IngredientMatch) => m.status === 'to_taste')
          .map((m: IngredientMatch) => m.ingredient_name)
        if (toTasteNames.length === 0) return null
        return (
          <p
            className="font-sans text-[10px] text-[var(--color-muted)] italic"
            aria-label="Seasonings to taste"
          >
            Not deducted: to taste ({toTasteNames.join(', ')})
          </p>
        )
      })()}

      {/* Missing items */}
      {proposal.missing.length > 0 && (
        <div>
          <p
            className="font-sans text-xs font-bold text-[var(--color-muted)] mb-1"
          >
            Not in pantry
          </p>
          <MissingItemsList
            missing={proposal.missing}
            missingNotes={proposal.missing_notes}
            compoundSuggestions={proposal.compound_suggestions}
            overrides={overrides}
            onOverrideChange={onOverrideChange}
            sourceNote={missingSourceNote}
          />
        </div>
      )}
    </div>
  )
}

export interface CookDeductionSummaryProps {
  summary: ReturnType<typeof summariseDeductions>
  mode: 'confirm' | 'preview'
}

/**
 * The footer summary text — "X of Y ingredients will be deducted", what's
 * not deducted, and the compound-substitution note. Extracted from
 * `CookModal.tsx`'s footer (issue #654) so the meal sheet shows the same
 * copy for its own merged summary.
 */
export function CookDeductionSummary({ summary, mode }: CookDeductionSummaryProps) {
  /** Rows the user could still resolve by typing a quantity. */
  const needsQuantity = summary.skipped.filter((s) => s.reason === 'needs_quantity')
  /** Rows satisfied by a package we cannot measure against — nothing to fix. */
  const imprecise = summary.skipped.filter((s) => s.reason === 'imprecise')
  /** Everything else that will not be deducted. */
  const notDeducted = summary.skipped.filter((s) => s.reason !== 'imprecise')

  if (summary.matchedCount === 0 && summary.compoundDeductions.length === 0) return null

  return (
    <div className="font-sans text-xs leading-snug">
      {summary.matchedCount > 0 && (
        <p
          className={
            notDeducted.length > 0 && mode === 'confirm'
              ? 'font-bold text-[var(--color-text)]'
              : 'text-[var(--color-muted)]'
          }
        >
          {notDeducted.length > 0 && mode === 'confirm' && '⚠️ '}
          {summary.matchesDeductionCount} of {summary.matchedCount} ingredient
          {summary.matchedCount === 1 ? '' : 's'}{' '}
          {mode === 'preview' ? 'will come from your pantry' : 'will be deducted'}
          {needsQuantity.length > 0 && ` — ${needsQuantity.length} need${
            needsQuantity.length === 1 ? 's' : ''
          } a quantity`}
        </p>
      )}
      {notDeducted.length > 0 && (
        <p className="text-[var(--color-muted)] mt-0.5">
          Not {mode === 'preview' ? 'counted' : 'deducted'}:{' '}
          {notDeducted.map((s) => s.name).join(', ')}
        </p>
      )}
      {imprecise.length > 0 && (
        <p className="text-[var(--color-muted)] mt-0.5">
          You have {imprecise.map((s) => s.name).join(', ')} — we can&apos;t tell how
          much of a pack the recipe uses, so the quantity is left as it is.
        </p>
      )}
      {summary.compoundDeductions.length > 0 && (
        <p className="text-[var(--color-muted)] mt-0.5">
          Also {mode === 'preview' ? 'using' : 'deducting'} from your substitution:{' '}
          {summary.compoundDeductions.map((d) => d.componentName).join(', ')}
        </p>
      )}
    </div>
  )
}
