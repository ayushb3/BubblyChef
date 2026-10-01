'use client'

/**
 * "Pick 1 of 3" milestone unlock card (issue #522).
 *
 * Issue #755: it renders in the Bubbles card's slot (a pending offer takes the
 * card's place; the two are never stacked), so it wears the card's frame, a
 * PixelPanel with the illustrated Bubbles, and its options are keycaps. Each shows
 * the decoration's pixel art (the catalog's `art`), falling back to the emoji for
 * an entry without any.
 *
 * Renders nothing while `useKitchenOffer()` is loading or has no offer —
 * mounted unconditionally under `KitchenScene` in `HeroHome`, so the home
 * screen must never shift layout on a plain page load with no pending
 * milestone.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import BubblesMascot from '@/components/ui/BubblesMascot'
import PixelPanel from '@/components/ui/PixelPanel'
import SpringButton from '@/components/ui/SpringButton'
import { useKitchenOffer, claimUnlock } from '@/lib/api/kitchen'
import { CATALOG, type Decoration } from '@/lib/kitchen/catalog'
import { SLOTS } from '@/lib/kitchen/slots'

const SLOT_LABEL_BY_KEY = new Map(SLOTS.map((s) => [s.key, s.label]))
const ART_BY_ID = new Map(CATALOG.map((d) => [d.id, d.art]))

/** The decoration's pixel art, from the offer or else the catalog; `undefined` = draw the emoji. */
function artFor(option: Decoration): string | undefined {
  return option.art ?? ART_BY_ID.get(option.id)
}

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
          className="w-full"
          data-testid="unlock-offer"
        >
          <PixelPanel>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <BubblesMascot state="celebrate" size={44} animate={false} className="shrink-0" />
                <p className="min-w-0 flex-1 text-[15px] leading-[22px] font-semibold text-[color:var(--color-text)]">
                  You reached 🫧 {offer.threshold}! Pick one for your kitchen
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {offer.options.map((option) => {
                  const isPicking = mutation.isPending && claimedId === option.id
                  const art = artFor(option)
                  return (
                    <SpringButton
                      variant="secondary"
                      key={option.id}
                      onClick={() => handlePick(option.id)}
                      disabled={mutation.isPending}
                      className="flex h-auto min-w-0 flex-col items-center gap-1 px-1.5 py-2.5 text-center whitespace-normal!"
                    >
                      {art ? (
                        <Image
                          src={art}
                          alt=""
                          width={40}
                          height={40}
                          unoptimized
                          className="h-10 w-10 object-contain [image-rendering:pixelated]"
                        />
                      ) : (
                        <span className="text-2xl leading-10" aria-hidden="true">
                          {option.emoji}
                        </span>
                      )}
                      <span className="text-xs leading-4 font-extrabold text-[color:var(--color-text)]">
                        {option.name}
                      </span>
                      <span className="text-[11px] leading-4 font-semibold text-[color:var(--color-muted)]">
                        {SLOT_LABEL_BY_KEY.get(option.slot) ?? option.slot}
                      </span>
                      {isPicking && (
                        <span className="text-[11px] leading-4 font-bold text-[color:var(--color-text)]">
                          Placing…
                        </span>
                      )}
                    </SpringButton>
                  )
                })}
              </div>
              {error && (
                <p className="text-center text-xs text-[var(--color-coral)]" role="alert">
                  {error}
                </p>
              )}
            </div>
          </PixelPanel>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
