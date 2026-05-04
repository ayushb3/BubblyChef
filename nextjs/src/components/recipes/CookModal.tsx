'use client'

import React, { useState, useEffect } from 'react'
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
      return '#b5ead7' // pastel-mint
    case 'shortfall':
      return '#ffdab3' // pastel-peach
    case 'unit_conflict':
      return '#ffdab3' // pastel-peach
    case 'missing':
      return '#e5e7eb' // grey
    default:
      return '#e5e7eb'
  }
}

function statusLabel(status: IngredientMatch['status']): string {
  switch (status) {
    case 'ready':
      return 'Ready'
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

    // Build deductions from matched items that have a deduct_qty
    const deductions: DeductionItem[] = proposal.matches
      .filter((m: IngredientMatch) => m.pantry_item_id != null && m.status !== 'missing')
      .map((m: IngredientMatch) => {
        // For unit_conflict rows, use the user's override qty (or 0 if not set)
        const overrideKey = m.pantry_item_id!
        let deductQty: number
        if (m.status === 'unit_conflict') {
          deductQty = parseFloat(overrides[overrideKey] ?? '0') || 0
        } else {
          deductQty = m.deduct_qty ?? 0
        }
        return {
          pantry_item_id: m.pantry_item_id!,
          deduct_qty: deductQty,
          base_unit: m.base_unit ?? 'item',
        }
      })
      .filter((d: DeductionItem) => d.deduct_qty > 0)

    try {
      await confirmCook(recipeId, deductions)
      setState('success')
      // Auto-close after a short delay so user sees the success state
      setTimeout(() => {
        onCooked()
        onClose()
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
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
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
            boxShadow: '0 8px 32px rgba(255,181,197,0.25)',
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
                Cook it
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
                <p className="text-3xl mb-2">🍳</p>
                <p
                  className="text-sm font-extrabold text-[var(--color-text)]"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  Enjoy your meal!
                </p>
                <p
                  className="text-xs text-[var(--color-muted)] mt-1"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  Pantry updated and recipe marked as cooked.
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
                          </td>
                          <td className="py-1.5 pr-2 text-[var(--color-muted)]">
                            {m.pantry_item_name ?? '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-[var(--color-muted)]">
                            {m.status === 'unit_conflict' ? (
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={overrides[m.pantry_item_id!] ?? ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                  setOverrides((prev: Record<string, string>) => ({
                                    ...prev,
                                    [m.pantry_item_id!]: e.target.value,
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
                style={{ background: '#ffb5c5', fontFamily: 'Nunito, sans-serif' }}
              >
                {state === 'confirming' ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
