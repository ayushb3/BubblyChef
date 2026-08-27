'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { cookRecipe, confirmCook } from '@/lib/api/recipes'
import type { CookProposal, CompoundSuggestion, IngredientMatch, DeductionItem } from '@/types/recipes'

interface CookModalProps {
  recipeId: string
  recipeTitle: string
  onClose: () => void
  onCooked: () => void
  /** When true, success state offers "Add to library?" instead of the timer redirect. */
  isDraft?: boolean
  /** Called when user taps "Add to library" in the draft success state. */
  onAddToLibrary?: () => Promise<void>
  /**
   * Which question the modal is answering (#267).
   *
   * - 'confirm' (default) — "I already cooked this." Deducts on confirm. This is
   *   the original behaviour, reached from "I already made this" and from
   *   "Finished cooking" at the end of a cook session.
   * - 'preview' — "What will this cost me?" Shows the same pantry match as a
   *   plan, deducts nothing, and hands off to cooking. The substitute/shortfall
   *   information is most useful before you start, not as an audit afterwards.
   */
  mode?: 'confirm' | 'preview'
  /** Called when the user starts cooking from a preview. Required for 'preview'. */
  onStartCooking?: () => void
}

type ModalState = 'loading' | 'review' | 'confirming' | 'success' | 'error'

/** Matches the skeleton idiom in src/app/loading.tsx. */
const PULSE = 'rounded animate-pulse motion-reduce:animate-none'
const PULSE_BG = { background: 'var(--color-border)' } as const

const SKELETON_ROWS = ['70%', '55%', '80%', '45%'] as const

/**
 * What the wait is actually spent on, narrated in order (audit B8).
 *
 * The cook match runs a deterministic pass over the pantry, then sends only the
 * leftovers to the model in one batch — measured at 4.9–6.2s end to end, nearly
 * all of it the model call. A single static line for six seconds reads as a
 * hang, so the stages advance on a timer to show the work is ongoing.
 *
 * These are honest labels for real phases, not a fake progress bar: the request
 * gives no completion signal, so the copy describes what is happening rather
 * than claiming a percentage. The last stage is deliberately open-ended — it
 * stays put until the response lands however long that takes.
 */
const LOADING_STAGES = [
  { label: 'Reading the recipe…', hint: 'Working out what each ingredient needs.' },
  { label: 'Checking your pantry…', hint: 'Matching ingredients against what you have.' },
  { label: 'Finding substitutes…', hint: 'Looking for stand-ins for anything missing.' },
] as const

/** Rough duration of the first two stages; the last one holds until the response. */
const STAGE_MS = 1400

function statusColor(status: IngredientMatch['status']): string {
  switch (status) {
    case 'ready':
      return 'var(--color-fresh)'
    case 'substitute':
      return 'var(--color-expiring)'
    case 'shortfall':
      return 'var(--color-expiring)'
    case 'unit_conflict':
      return 'var(--color-expiring)'
    case 'missing':
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
    case 'unit_conflict':
      return 'Unit conflict'
    case 'missing':
      return 'Missing'
    default:
      return status
  }
}

function formatQty(qty: number | null, unit: string | null): string {
  if (qty == null) return '—'
  const rounded = Math.round(qty * 100) / 100
  return unit ? `${rounded} ${unit}` : String(rounded)
}

/**
 * Splits the proposal into what will actually be deducted and what will not.
 *
 * The two are derived together on purpose: the confirm payload and the summary
 * shown above the button must never disagree. Previously the payload was built
 * inline at confirm time and rows that fell out (`deductQty <= 0`) simply
 * vanished, so the user was told nothing about ingredients their pantry never
 * gave up (#245).
 */
export function summariseDeductions(
  proposal: CookProposal,
  overrides: Record<string, string>,
): {
  deductions: DeductionItem[]
  /** Matched rows that will NOT be deducted, and why. */
  skipped: Array<{ name: string; reason: 'needs_quantity' | 'no_quantity' }>
  /** Count of matched (non-missing) rows considered. */
  matchedCount: number
} {
  const byPantryItem = new Map<string, DeductionItem>()
  const skipped: Array<{ name: string; reason: 'needs_quantity' | 'no_quantity' }> = []
  let matchedCount = 0

  proposal.matches.forEach((m: IngredientMatch, i: number) => {
    if (m.pantry_item_id == null || m.status === 'missing') return
    matchedCount += 1

    // For unit_conflict rows, use the user's override qty (or 0 if not set).
    // Keyed by row index, not pantry item — two rows sharing an item still
    // need their own input.
    const isConflict = m.status === 'unit_conflict'
    const deductQty = isConflict
      ? parseFloat(overrides[String(i)] ?? '0') || 0
      : (m.deduct_qty ?? 0)

    if (deductQty <= 0) {
      skipped.push({
        name: m.ingredient_name,
        reason: isConflict ? 'needs_quantity' : 'no_quantity',
      })
      return
    }

    // Several recipe lines can resolve to one pantry row — literal duplicates,
    // or names the backend collapses onto the same item (cheddar and parmesan
    // both normalize to "cheese"). Emitting one entry per match would then send
    // two deductions for one row, and the server applies each as a
    // read-modify-write. The backend sums defensively too; doing it here keeps
    // the payload honest about what is actually being deducted.
    const id = m.pantry_item_id
    const existing = byPantryItem.get(id)
    if (existing) {
      existing.deduct_qty += deductQty
    } else {
      byPantryItem.set(id, {
        pantry_item_id: id,
        deduct_qty: deductQty,
        base_unit: m.base_unit ?? 'item',
      })
    }
  })

  return { deductions: Array.from(byPantryItem.values()), skipped, matchedCount }
}

export default function CookModal({
  recipeId,
  recipeTitle,
  onClose,
  onCooked,
  isDraft = false,
  onAddToLibrary,
  mode = 'confirm',
  onStartCooking,
}: CookModalProps) {
  const router = useRouter()
  const [state, setState] = useState<ModalState>('loading')
  const [proposal, setProposal] = useState<CookProposal | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [addingToLibrary, setAddingToLibrary] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [loadingStage, setLoadingStage] = useState(0)
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Advance the loading copy while the match runs, stopping on the last stage
  // rather than looping — a cycling message would suggest repeated work.
  useEffect(() => {
    if (state !== 'loading') return
    const id = setInterval(() => {
      setLoadingStage((s) => (s < LOADING_STAGES.length - 1 ? s + 1 : s))
    }, STAGE_MS)
    return () => clearInterval(id)
  }, [state])

  useEffect(() => {
    let cancelled = false
    cookRecipe(recipeId)
      .then((p) => {
        if (!cancelled) {
          setProposal(p)
          setState('review')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load cook proposal')
          setState('error')
        }
      })
    return () => {
      cancelled = true
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    }
  }, [recipeId])

  // Recomputed as the user fills in override quantities, so the summary above
  // the button always describes the payload the button will actually send.
  const summary = proposal ? summariseDeductions(proposal, overrides) : null
  /** Rows the user could still resolve by typing a quantity. */
  const needsQuantity = summary?.skipped.filter((s) => s.reason === 'needs_quantity') ?? []
  const hasUnresolved = needsQuantity.length > 0

  const handleConfirm = async () => {
    if (!proposal || !summary) return
    setState('confirming')

    const { deductions } = summary

    try {
      await confirmCook(recipeId, deductions)
      setState('success')
      if (!isDraft) {
        redirectTimerRef.current = setTimeout(() => {
          onCooked()
          onClose()
          router.push(`/chat?cooking=${encodeURIComponent(recipeId)}`)
        }, 1200)
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to confirm cook')
      setState('error')
    }
  }

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {/* Sheet */}
        <motion.div
          className="w-full max-w-md mx-2 mb-4 sm:mb-0 rounded-2xl overflow-hidden flex flex-col"
          style={{
            background: 'var(--color-surface)',
            boxShadow: '0 8px 32px color-mix(in srgb, var(--color-primary) 25%, transparent)',
            maxHeight: '85vh',
          }}
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          {/* Header */}
          <div
            className="px-5 py-4 flex items-center justify-between flex-shrink-0 border-b border-[var(--color-border)]"
            style={{ background: 'var(--color-bg)' }}
          >
            <div>
              <h2
                className="text-base font-extrabold text-[var(--color-text)]"
                style={{ fontFamily: 'Nunito, sans-serif' }}
              >
                {mode === 'preview' ? "What you'll use" : 'Mark as cooked'}
              </h2>
              <p
                className="text-xs text-[var(--color-muted)] mt-0.5 line-clamp-1"
                style={{ fontFamily: 'Nunito, sans-serif' }}
              >
                {recipeTitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-xl leading-none px-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {state === 'loading' && (
              <div role="status" aria-live="polite" className="flex flex-col gap-4 py-2">
                <span className="sr-only">Matching recipe ingredients against your pantry</span>

                <div className="flex items-center gap-2.5">
                  <div
                    className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin motion-reduce:animate-none shrink-0"
                    style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
                  />
                  <p
                    className="text-sm font-semibold text-[var(--color-text)]"
                    style={{ fontFamily: 'Nunito, sans-serif' }}
                  >
                    {LOADING_STAGES[loadingStage].label}
                  </p>
                </div>

                {/* Skeleton rows standing in for the match table. Gives the wait a
                    shape that matches what arrives, so the modal doesn't jump
                    from a centred spinner to a dense table (#245 / audit B8). */}
                <div className="flex flex-col gap-2" aria-hidden="true">
                  {SKELETON_ROWS.map((width, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div
                        className={`h-3 ${PULSE} flex-1`}
                        style={{ ...PULSE_BG, maxWidth: width }}
                      />
                      <div className={`h-3 w-12 ${PULSE}`} style={PULSE_BG} />
                      <div className={`h-4 w-14 rounded-full ${PULSE}`} style={PULSE_BG} />
                    </div>
                  ))}
                </div>

                <p
                  className="text-xs text-[var(--color-muted)]"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  {LOADING_STAGES[loadingStage].hint}
                </p>
              </div>
            )}

            {state === 'error' && (
              <div className="py-8 text-center">
                <p className="text-sm font-semibold text-red-500" style={{ fontFamily: 'Nunito, sans-serif' }}>
                  {errorMsg || 'Something went wrong. Please try again.'}
                </p>
              </div>
            )}

            {state === 'success' && (
              <div className="py-8 text-center flex flex-col items-center gap-3">
                <p className="text-3xl">✅</p>
                <p
                  className="text-sm font-extrabold text-[var(--color-text)]"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  Pantry updated!
                </p>
                {isDraft ? (
                  <>
                    <p
                      className="text-sm text-[var(--color-muted)]"
                      style={{ fontFamily: 'Nunito, sans-serif' }}
                    >
                      Add <span className="font-semibold">{recipeTitle}</span> to your library?
                    </p>
                    <div className="flex gap-2 w-full mt-1">
                      <button
                        onClick={() => { onCooked(); onClose() }}
                        className="flex-1 py-2 rounded-full text-sm font-bold border border-[var(--color-border)] text-[var(--color-muted)] active:scale-95 transition-transform"
                        style={{ fontFamily: 'Nunito, sans-serif' }}
                      >
                        Not now
                      </button>
                      <button
                        onClick={async () => {
                          if (!onAddToLibrary) return
                          setAddingToLibrary(true)
                          try { await onAddToLibrary() } finally { setAddingToLibrary(false) }
                          onCooked(); onClose()
                        }}
                        disabled={addingToLibrary}
                        className="flex-1 py-2 rounded-full text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-transform"
                        style={{ background: 'var(--color-primary-dark)', fontFamily: 'Nunito, sans-serif' }}
                      >
                        {addingToLibrary ? 'Saving...' : 'Add to library'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p
                    className="text-xs text-[var(--color-muted)] mt-1"
                    style={{ fontFamily: 'Nunito, sans-serif' }}
                  >
                    Ingredients deducted — taking you to chat.
                  </p>
                )}
              </div>
            )}

            {(state === 'review' || state === 'confirming') && proposal && (
              <div className="flex flex-col gap-4">
                {/* Ingredient table */}
                {proposal.matches.length > 0 && (
                  <table className="w-full text-xs" style={{ fontFamily: 'Nunito, sans-serif' }}>
                    <thead>
                      <tr className="text-[var(--color-muted)] text-left">
                        <th className="pb-1 font-semibold">Ingredient</th>
                        <th className="pb-1 font-semibold">Pantry match</th>
                        <th className="pb-1 font-semibold text-right">Deduct</th>
                        <th className="pb-1 font-semibold text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.matches.map((m: IngredientMatch, i: number) => (
                        <tr key={i} className="border-t border-[var(--color-border)]">
                          <td className="py-1.5 pr-2 font-semibold text-[var(--color-text)]">
                            {m.ingredient_name}
                            {m.match_type === 'substitute' && m.substitution_note && (
                              <span className="block font-normal text-[10px] leading-snug text-[var(--color-muted)] mt-0.5">
                                {m.substitution_note}
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
                                value={overrides[String(i)] ?? ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                  setOverrides((prev: Record<string, string>) => ({
                                    ...prev,
                                    [String(i)]: e.target.value,
                                  }))
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
                                color: '#4a4a4a',
                              }}
                            >
                              {statusLabel(m.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Missing items */}
                {proposal.missing.length > 0 && (
                  <div>
                    <p
                      className="text-xs font-bold text-[var(--color-muted)] mb-1"
                      style={{ fontFamily: 'Nunito, sans-serif' }}
                    >
                      Not in pantry
                    </p>
                    <div className="flex flex-col gap-2">
                      {proposal.missing.map((name: string) => {
                        const suggestion = (proposal.compound_suggestions ?? []).find(
                          (s: CompoundSuggestion) =>
                            s.ingredient_name.toLowerCase() === name.toLowerCase(),
                        )
                        return (
                          <div key={name} className="flex flex-col gap-0.5">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-[var(--color-border)] text-[var(--color-muted)] self-start"
                              style={{ fontFamily: 'Nunito, sans-serif' }}
                            >
                              ⚠️ {name}
                            </span>
                            {suggestion && (
                              <div
                                className="ml-2 text-[10px] leading-snug text-[var(--color-muted)]"
                                style={{ fontFamily: 'Nunito, sans-serif' }}
                                aria-label={`Compound substitution suggestion for ${name}`}
                              >
                                <span className="font-semibold">
                                  Try combining:{' '}
                                </span>
                                {suggestion.components.join(' + ')}
                                <span className="block italic mt-0.5">{suggestion.note}</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer actions */}
          {(state === 'review' || state === 'confirming') && (
            <div
              className="px-5 py-3 flex flex-col gap-2.5 flex-shrink-0 border-t border-[var(--color-border)]"
              style={{ background: 'var(--color-bg)' }}
            >
              {/* What will actually happen, stated before the button that does it.
                  In confirm mode a partial deduction is a warning; in preview
                  nothing is being written, so the same numbers are just a plan. */}
              {summary && summary.matchedCount > 0 && (
                <div
                  className="text-xs leading-snug"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  <p
                    className={
                      summary.skipped.length > 0 && mode === 'confirm'
                        ? 'font-bold text-[var(--color-text)]'
                        : 'text-[var(--color-muted)]'
                    }
                  >
                    {summary.skipped.length > 0 && mode === 'confirm' && '⚠️ '}
                    {summary.deductions.length} of {summary.matchedCount} ingredient
                    {summary.matchedCount === 1 ? '' : 's'}{' '}
                    {mode === 'preview' ? 'will come from your pantry' : 'will be deducted'}
                    {needsQuantity.length > 0 && ` — ${needsQuantity.length} need${
                      needsQuantity.length === 1 ? 's' : ''
                    } a quantity`}
                  </p>
                  {summary.skipped.length > 0 && (
                    <p className="text-[var(--color-muted)] mt-0.5">
                      Not {mode === 'preview' ? 'counted' : 'deducted'}:{' '}
                      {summary.skipped.map((s) => s.name).join(', ')}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  disabled={state === 'confirming'}
                  className="flex-1 py-2 rounded-full text-sm font-bold border border-[var(--color-border)] text-[var(--color-muted)] active:scale-95 transition-transform disabled:opacity-50"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  {mode === 'preview' ? 'Back' : 'Cancel'}
                </button>
                {mode === 'preview' ? (
                  <button
                    onClick={onStartCooking}
                    className="flex-1 py-2 rounded-full text-sm font-bold text-white active:scale-95 transition-transform"
                    style={{ background: 'var(--color-primary-dark)', fontFamily: 'Nunito, sans-serif' }}
                  >
                    Start cooking →
                  </button>
                ) : (
                  <button
                    onClick={handleConfirm}
                    disabled={state === 'confirming'}
                    /* Demoted to a secondary treatment while rows are unresolved:
                       confirming then silently drops them, so it should not look
                       like the obviously-correct action (#245). Still reachable —
                       some quantities genuinely cannot be measured. */
                    className={[
                      'flex-1 py-2 rounded-full text-sm font-bold active:scale-95 transition-transform disabled:opacity-50',
                      hasUnresolved
                        ? 'border-2 border-[var(--color-primary-dark)] text-[var(--color-primary-dark)]'
                        : 'text-white',
                    ].join(' ')}
                    style={{
                      background: hasUnresolved ? 'transparent' : 'var(--color-primary-dark)',
                      fontFamily: 'Nunito, sans-serif',
                    }}
                  >
                    {state === 'confirming'
                      ? 'Saving...'
                      : hasUnresolved
                      ? 'Cook anyway'
                      : 'Yes, I cooked this'}
                  </button>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
