'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import { cookRecipe, confirmCook } from '@/lib/api/recipes'
import type { CookProposal } from '@/types/recipes'
import { skippedDeductionNames, type SkippedDeductionNames } from '@/lib/cook-skipped'
import SkippedDeductionsNotice from '@/components/cook/SkippedDeductionsNotice'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'
import { endCookSession, isCookSessionEnded } from '@/lib/cook-session'
import {
  CookReviewBody,
  CookDeductionSummary,
  summariseDeductions,
  MissingItemsList,
  compoundOverrideKey,
  effectiveCompoundOverride,
  ExpiredIngredientsBanner,
  dedupeByPantryItemId,
} from '@/components/recipes/CookReviewBody'

// Issue #654 PR A: CookReviewBody.tsx now owns these — re-exported so every
// existing import path (`assumed-staples.test.tsx`, `cook-flow-redesign.test.tsx`,
// `cook-session-teardown.test.tsx`, and any other caller) keeps working
// unchanged.
export {
  summariseDeductions,
  MissingItemsList,
  compoundOverrideKey,
  effectiveCompoundOverride,
  ExpiredIngredientsBanner,
  dedupeByPantryItemId,
}

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
  const queryClient = useQueryClient()
  const [state, setState] = useState<ModalState>('loading')
  const [proposal, setProposal] = useState<CookProposal | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [addingToLibrary, setAddingToLibrary] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [loadingStage, setLoadingStage] = useState(0)
  const [expiredDismissed, setExpiredDismissed] = useState(false)
  // Issue #621: pantry items the server refused to deduct. While any are
  // shown the auto-redirect is paused (too short to read), so every exit runs
  // the same continue path the timer would have.
  const [skipped, setSkipped] = useState<SkippedDeductionNames>({ names: [], unnamed: 0 })
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const continuedRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const skippedCount = skipped.names.length + skipped.unnamed
  const showSkippedNotice = state === 'success' && skippedCount > 0
  // Non-draft only: a draft never auto-redirected, and its exits stay as-is.
  const pausedForNotice = showSkippedNotice && !isDraft

  // The hand-off to chat: what the redirect timer does, and what Continue,
  // ✕, the backdrop and Escape do while the notice pauses it. Once only, so
  // Continue then a quick Escape can't call `onCooked` twice.
  const continueToChat = () => {
    if (continuedRef.current) return
    continuedRef.current = true
    onCooked()
    onClose()
    router.push(`/chat?cooking=${encodeURIComponent(recipeId)}`)
  }
  const dismiss = () => {
    if (pausedForNotice) continueToChat()
    else onClose()
  }
  useModalFocusTrap(true, dismiss, panelRef)

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
    setExpiredDismissed(false)
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
  // The footer text itself now lives in CookDeductionSummary (issue #654);
  // this stays only for the confirm button's "Cook anyway" demotion below.
  const summary = proposal ? summariseDeductions(proposal, overrides) : null
  const hasUnresolved = summary?.skipped.some((s) => s.reason === 'needs_quantity') ?? false

  const handleConfirm = async () => {
    if (!proposal || !summary) return
    // Two-tab double deduction guard (PR #475), checkpoint 2: the sheet can
    // sit open for a while between loading its proposal and the user tapping
    // confirm — long enough for a *different* tab (or window) to confirm
    // this exact same recipe's deduction in the meantime. Re-check right
    // here, immediately before the network call that actually deducts,
    // rather than trusting whatever was true when the sheet opened.
    if (isCookSessionEnded(recipeId)) {
      onCooked()
      onClose()
      return
    }
    setState('confirming')

    const { deductions } = summary

    try {
      // `?.` is deliberate: a mock (or a future proxy) that resolves nothing
      // must still land in the normal success flow.
      const res = await confirmCook(recipeId, deductions)
      const skippedNow = skippedDeductionNames(proposal, res?.deductions_skipped ?? [])
      queryClient.invalidateQueries({ queryKey: ['bubbles'] })
      // #440 — the deduction just landed, so this cook session is over
      // regardless of which page/flow confirmed it. Recorded outside React
      // state because the non-draft branch below navigates to a fresh mount
      // of /chat, which would otherwise have no way to know a deduction it
      // didn't witness already happened and re-offer "Finished cooking".
      endCookSession(recipeId)
      setSkipped(skippedNow)
      setState('success')
      if (!isDraft && skippedNow.names.length + skippedNow.unnamed === 0) {
        redirectTimerRef.current = setTimeout(continueToChat, 1200)
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
          if (e.target === e.currentTarget) dismiss()
        }}
      >
        {/* Sheet */}
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cook-modal-title"
          tabIndex={-1}
          className="w-full max-w-md mx-2 mb-4 sm:mb-0 rounded-2xl overflow-hidden flex flex-col outline-none"
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
                id="cook-modal-title"
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
              onClick={dismiss}
              className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-xl leading-none px-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
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
                  <BubblesMascot state="thinking" size={32} />
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
                <BubblesMascot state="celebrate" size={80} />
                <p
                  className="text-sm font-extrabold text-[var(--color-text)]"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  Pantry updated!
                </p>
                {showSkippedNotice && (
                  <SkippedDeductionsNotice names={skipped.names} unnamed={skipped.unnamed} />
                )}
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
                ) : pausedForNotice ? (
                  <button
                    type="button"
                    onClick={continueToChat}
                    className="min-h-[44px] px-6 rounded-full text-sm font-bold text-white active:scale-95 transition-transform"
                    style={{ background: 'var(--color-primary-dark)', fontFamily: 'Nunito, sans-serif' }}
                    data-testid="cook-modal-continue"
                  >
                    Continue
                  </button>
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
              <CookReviewBody
                proposal={proposal}
                overrides={overrides}
                onOverrideChange={(key, value) =>
                  setOverrides((prev: Record<string, string>) => ({ ...prev, [key]: value }))
                }
                expiredDismissed={expiredDismissed}
                onDismissExpired={() => setExpiredDismissed(true)}
              />
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
              {summary && <CookDeductionSummary summary={summary} mode={mode} />}

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
