'use client'

/**
 * The card's place under the kitchen scene (issue #755): decides what goes there
 * and wires it. Exactly one thing is ever in it, never a stack:
 *
 *  - a pending milestone unlock offer (`UnlockOffer`), which takes the card's place
 *    for as long as it is pending;
 *  - otherwise the one Bubbles card the picker (`lib/kitchen/home-card.ts`) returns
 *    for the snapshot gathered here, or nothing when there is none;
 *  - while any of that is still loading, the card's skeleton, so nothing shifts.
 *
 * What this adds on top of the picker is the *visit*:
 *
 *  - The seen and dismissed records are read once, when home mounts. The picker caps
 *    a nudge to once a day against that snapshot, so a nudge stays up for the visit it
 *    first appears on (it is only recorded as seen once it is on screen) and a later
 *    visit that day falls through to the next case.
 *  - The card is latched when it first shows. If what it was about changes under it
 *    (the scan was put away, the plan moved, the cook finished) it goes away rather
 *    than being replaced by the next case: answering a card closes it, it does not
 *    start a feed. Its own "Another tip" re-latches, because the tip is the same card
 *    saying something else.
 *  - The cross hides it for the rest of the visit and records the dismissal, which
 *    holds until the nudge's fingerprint changes.
 *
 * Nothing here writes to the pantry. Put it away opens the put-away sheet (which
 * owns the write); the rest only touch the device-local records.
 */
import { useEffect, useMemo, useState } from 'react'
import BubblesCard, { BubblesCardSkeleton } from '@/components/kitchen/BubblesCard'
import UnlockOffer from '@/components/kitchen/UnlockOffer'
import type { BubblesState } from '@/components/ui/BubblesMascot'
import { useCookResume } from '@/hooks/useCookResume'
import { usePlannedTonight } from '@/hooks/usePlannedTonight'
import { useStarterContext } from '@/lib/api/starter-context'
import { useKitchenOffer } from '@/lib/api/kitchen'
import type { ExpiryPriority } from '@/lib/expiry-priority'
import {
  dismissNudge,
  markNudgeSeen,
  readHomeCardRecords,
} from '@/lib/kitchen/home-card-store'
import {
  pickHomeCard,
  type ExpiringItem,
  type HomeCard,
  type HomeCardActionId,
} from '@/lib/kitchen/home-card'
import {
  clearPendingPutAway,
  pendingLineCount,
  type PendingPutAway,
} from '@/lib/kitchen/pending-putaway'
import { movePlannedToTomorrow } from '@/lib/kitchen/planned-tonight'

export interface HomeCardSlotProps {
  /** The pantry, expiring and daily-tip reads have settled (the card waits for them). */
  loaded: boolean
  /** Items in the pantry, or `null` when the read failed (unknown is not empty). */
  pantryCount: number | null
  expiring: ExpiringItem[]
  /** `user_profiles.expiry_priority`, read server-side by the page. */
  expiryPriority: ExpiryPriority
  /** Today's tip from the daily-tip endpoint, or `null` when it could not be reached. */
  tip: string | null
  /** The scan waiting to be put away, if one is. */
  pending: PendingPutAway | null
  /** Food is sitting expired and unused: Bubbles looks worried (#525). */
  hasUnusedExpired: boolean
  /** Put it away: open the put-away sheet. */
  onPutAway: () => void
}

/** Bubbles' face on a card (#593): it matches what the card is saying. */
function moodFor(card: HomeCard, hasUnusedExpired: boolean): BubblesState {
  if (hasUnusedExpired) return 'worried'
  if (card.kind === 'expiring') return 'surprised'
  if (card.kind === 'mealtime') return 'thinking'
  return 'happy'
}

export default function HomeCardSlot({
  loaded,
  pantryCount,
  expiring,
  expiryPriority,
  tip,
  pending,
  hasUnusedExpired,
  onPutAway,
}: HomeCardSlotProps) {
  const { data: offer, isLoading: offerLoading } = useKitchenOffer()
  const offerPending = !!offer && Array.isArray(offer.options) && offer.options.length > 0

  const starter = useStarterContext(true)
  const { cook, ready: cookReady, finish } = useCookResume()
  const planned = usePlannedTonight()

  // The visit: one clock read and one read of the records, when home mounts.
  const [now] = useState(() => new Date())
  const [records] = useState(() => readHomeCardRecords())
  const [tipTaps, setTipTaps] = useState(0)
  const [closed, setClosed] = useState(false)
  const [latched, setLatched] = useState<string | null>(null)

  const ready = loaded && cookReady && !offerLoading
  const card = useMemo(
    () =>
      ready
        ? pickHomeCard({
            now,
            cook,
            pending: pending
              ? { savedAt: pending.savedAt, itemCount: pendingLineCount(pending) }
              : null,
            planned,
            pantryCount,
            expiring,
            expiryPriority,
            starter: starter.data ?? null,
            tip,
            tipTaps,
            seen: records.seen,
            dismissed: records.dismissed,
          })
        : null,
    [ready, now, cook, pending, planned, pantryCount, expiring, expiryPriority, starter.data, tip, tipTaps, records],
  )

  // Cases 3 and 4 read the starter context (the make-again option, the pills): wait
  // for it rather than show them without and then swap.
  const waitingOnStarter =
    (card?.kind === 'mealtime' || card?.kind === 'expiring') && starter.isLoading
  const settled = ready && !waitingOnStarter

  // The card is only *on screen* when nothing else holds its place: a pending unlock
  // offer renders instead of it. Latching and the seen record follow what is on
  // screen, not what was picked, so an offer does not use up the day's nudge.
  const cardOnScreen = settled && !offerPending

  // Latch the first card shown (adjusting state while rendering, React's pattern for
  // state derived from other state).
  if (cardOnScreen && card && latched === null) setLatched(card.fingerprint)
  // The first-run prompt is the one latched card that stops being true mid-visit:
  // once the pantry has food, follow the new card instead of hiding it (#916).
  if (cardOnScreen && card && latched?.startsWith('empty:') && card.kind !== 'empty') {
    setLatched(card.fingerprint)
  }
  const visible = cardOnScreen && card !== null && card.fingerprint === latched && !closed
  const shown = visible ? card : null

  const shownFingerprint = shown?.fingerprint ?? null
  useEffect(() => {
    if (shownFingerprint) markNudgeSeen(shownFingerprint, now)
  }, [shownFingerprint, now])

  const onAction = (action: HomeCardActionId) => {
    switch (action) {
      case 'put-away':
        onPutAway()
        break
      case 'discard-scan':
        clearPendingPutAway()
        break
      case 'move-tomorrow':
        movePlannedToTomorrow()
        break
      case 'finish-cook':
        finish()
        break
      case 'another-tip':
        setTipTaps((n) => n + 1)
        setLatched(null)
        break
    }
  }

  const onDismiss = () => {
    if (shown) dismissNudge(shown.fingerprint)
    setClosed(true)
  }

  return (
    <div className="w-full px-4 pt-3" data-testid="home-card-slot">
      {offerPending ? (
        <UnlockOffer />
      ) : !settled ? (
        <BubblesCardSkeleton />
      ) : shown ? (
        <BubblesCard
          key={shown.fingerprint}
          card={shown}
          mood={moodFor(shown, hasUnusedExpired)}
          onAction={onAction}
          onDismiss={onDismiss}
        />
      ) : null}
    </div>
  )
}
