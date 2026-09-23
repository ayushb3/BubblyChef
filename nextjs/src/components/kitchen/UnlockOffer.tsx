'use client'

/**
 * "Pick 1 of 3" milestone unlock card (issue #522).
 *
 * Renders nothing while `useKitchenOffer()` is loading or has no offer —
 * mounted unconditionally under `KitchenScene` in `HeroHome`, so the home
 * screen must never shift layout on a plain page load with no pending
 * milestone.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import { useKitchenOffer, claimUnlock } from '@/lib/api/kitchen'
import { SLOTS } from '@/lib/kitchen/slots'

const SLOT_LABEL_BY_KEY = new Map(SLOTS.map((s) => [s.key, s.label]))

export default function UnlockOffer() {
  const { data: offer, isLoading } = useKitchenOffer()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [claimedId, setClaimedId] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (decorationId: string) => {
      if (!offer) throw new Error('No offer to claim')
      return claimUnlock(offer.milestone_key, decorationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decorations'] })
      queryClient.invalidateQueries({ queryKey: ['kitchen-offer'] })
    },
    onError: (err: Error) => {
      setError(err.message || 'Could not claim that decoration')
      setClaimedId(null)
    },
  })

  // `useMutation`'s `isSuccess` stays true until `reset()` is called or a new
  // `mutate` runs — it does not clear itself when the invalidated
  // `['kitchen-offer']` query refetches. Multiple milestones can be pending
  // at once (an overshoot, or a user returning after a while), so once this
  // component's `offer` moves on to the next milestone, reset the mutation
  // so that milestone's card renders instead of staying hidden behind the
  // previous claim's success state.
  const previousMilestoneKey = useRef<string | null>(null)
  useEffect(() => {
    if (!offer) return
    if (previousMilestoneKey.current !== null && previousMilestoneKey.current !== offer.milestone_key) {
      mutation.reset()
      setClaimedId(null)
      setError(null)
    }
    previousMilestoneKey.current = offer.milestone_key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.milestone_key])

  const handlePick = (decorationId: string) => {
    setError(null)
    setClaimedId(decorationId)
    mutation.mutate(decorationId)
  }

  // Defends against any response shape that isn't a real offer — including,
  // in tests, a shared fetch mock's catch-all fallback for an endpoint it
  // doesn't know about — rather than trusting `options` is always an array.
  if (isLoading || !offer || !Array.isArray(offer.options) || offer.options.length === 0) {
    return null
  }

  return (
    <AnimatePresence>
      {!mutation.isSuccess && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          className="w-full max-w-[480px] mb-4 rounded-2xl p-4 border border-[var(--color-border)]"
          style={{ background: 'var(--color-surface)' }}
        >
          <p className="text-sm font-semibold text-[var(--color-text)] text-center mb-3">
            You reached 🫧 {offer.threshold}! Pick one for your kitchen
          </p>
          <div className="grid grid-cols-3 gap-2">
            {offer.options.map((option) => {
              const isPicking = mutation.isPending && claimedId === option.id
              return (
                <SpringButton
                  key={option.id}
                  onClick={() => handlePick(option.id)}
                  disabled={mutation.isPending}
                  className="flex flex-col items-center gap-1 rounded-xl p-3 border border-[var(--color-border)] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'var(--color-bg)' }}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {option.emoji}
                  </span>
                  <span className="text-xs font-semibold text-[var(--color-text)] text-center">
                    {option.name}
                  </span>
                  <span className="text-[10px] text-[var(--color-muted)]">
                    {SLOT_LABEL_BY_KEY.get(option.slot) ?? option.slot}
                  </span>
                  {isPicking && (
                    <span className="text-[10px] text-[var(--color-primary)]">Placing…</span>
                  )}
                </SpringButton>
              )
            })}
          </div>
          {error && (
            <p className="mt-2 text-xs text-center text-[#ff9aa2]" role="alert">
              {error}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
