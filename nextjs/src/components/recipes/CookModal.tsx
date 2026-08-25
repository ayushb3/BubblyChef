'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { cookRecipe, confirmCook } from '@/lib/api/recipes'
import type { CookProposal, IngredientMatch, DeductionItem } from '@/types/recipes'

interface CookModalProps {
  recipeId: string
  recipeTitle: string
  onClose: () => void
  onCooked: () => void
}

type ModalState = 'loading' | 'review' | 'confirming' | 'success' | 'error'

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

export default function CookModal({
  recipeId,
  recipeTitle,
  onClose,
  onCooked,
}: CookModalProps) {
  const router = useRouter()
  const [state, setState] = useState<ModalState>('loading')
  const [proposal, setProposal] = useState<CookProposal | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  // Editable override quantities for unit_conflict rows (keyed by pantry_item_id)
  const [overrides, setOverrides] = useState<Record<string, string>>({})

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
    }
  }, [recipeId])

  const handleConfirm = async () => {
    if (!proposal) return
    setState('confirming')

    // Build deductions from matched items that have a deduct_qty, summing any
    // that land on the same pantry item.
    //
    // Several recipe lines can resolve to one pantry row — literal duplicates,
    // or names the backend collapses onto the same item (cheddar and parmesan
    // both normalize to "cheese"). Emitting one entry per match would then send
    // two deductions for one row, and the server applies each as a
    // read-modify-write. The backend sums defensively too; doing it here keeps
    // the payload honest about what is actually being deducted.
    const byPantryItem = new Map<string, DeductionItem>()

    proposal.matches.forEach((m: IngredientMatch, i: number) => {
      if (m.pantry_item_id == null || m.status === 'missing') return

      // For unit_conflict rows, use the user's override qty (or 0 if not set).
      // Keyed by row index, not pantry item — two rows sharing an item still
      // need their own input.
      const deductQty =
        m.status === 'unit_conflict'
          ? parseFloat(overrides[String(i)] ?? '0') || 0
          : (m.deduct_qty ?? 0)

      if (deductQty <= 0) return

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

    const deductions: DeductionItem[] = Array.from(byPantryItem.values())

    try {
      await confirmCook(recipeId, deductions)
      setState('success')
      // Hold the success state briefly so the user sees the deduction land,
      // then hand off to chat with this recipe as context (issue #122).
      // router.push is a client-side transition — no full reload.
      setTimeout(() => {
        onCooked()
        onClose()
        router.push(`/chat?cooking=${encodeURIComponent(recipeId)}`)
      }, 1200)
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
                Mark as cooked
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
              <div className="flex flex-col items-center gap-3 py-10">
                <div
                  className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
                />
                <p
                  className="text-sm text-[var(--color-muted)]"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  Checking your pantry...
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
              <div className="py-8 text-center">
                <p className="text-3xl mb-2">✅</p>
                <p
                  className="text-sm font-extrabold text-[var(--color-text)]"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  Pantry updated!
                </p>
                <p
                  className="text-xs text-[var(--color-muted)] mt-1"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  Ingredients deducted — taking you to chat.
                </p>
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
                    <div className="flex flex-wrap gap-1.5">
                      {proposal.missing.map((name: string) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-[var(--color-border)] text-[var(--color-muted)]"
                          style={{ fontFamily: 'Nunito, sans-serif' }}
                        >
                          ⚠️ {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer actions */}
          {(state === 'review' || state === 'confirming') && (
            <div
              className="px-5 py-4 flex gap-2 flex-shrink-0 border-t border-[var(--color-border)]"
              style={{ background: 'var(--color-bg)' }}
            >
              <button
                onClick={onClose}
                disabled={state === 'confirming'}
                className="flex-1 py-2 rounded-full text-sm font-bold border border-[var(--color-border)] text-[var(--color-muted)] active:scale-95 transition-transform disabled:opacity-50"
                style={{ fontFamily: 'Nunito, sans-serif' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={state === 'confirming'}
                className="flex-1 py-2 rounded-full text-sm font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                style={{ background: 'var(--color-primary-dark)', fontFamily: 'Nunito, sans-serif' }}
              >
                {state === 'confirming' ? 'Saving...' : 'Yes, I cooked this'}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
