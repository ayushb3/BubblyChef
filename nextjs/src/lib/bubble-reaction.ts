/**
 * Who shows the "+N" when the bubbles balance rises (issue #843).
 *
 * There are two reactions to an award: the global `BubblePop` (pinned top-right,
 * mounted once in `Providers`, visible on every page) and the header counter's
 * own "+N" tag (`BubblesCounter`, anchored under the number on the kitchen
 * home). Both watch the same balance, so after a put-away the home showed two at
 * once. The rule is one award moment per award: where the counter is on screen,
 * its tag is the reaction and `BubblePop` stays quiet; everywhere else `BubblePop`
 * keeps the job.
 *
 * A counter that is the reaction calls `useClaimBubbleReaction(true)` while it is
 * mounted and showing a balance; `BubblePop` reads `useBubbleReactionClaimed()`.
 * A count, not a flag, so two mounted counters (or a counter that remounts) never
 * release each other's claim.
 */
import { useEffect, useSyncExternalStore } from 'react'

let claims = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Claim the award reaction for as long as `active` is true and the caller is mounted. */
export function useClaimBubbleReaction(active: boolean): void {
  useEffect(() => {
    if (!active) return
    claims++
    emit()
    return () => {
      claims--
      emit()
    }
  }, [active])
}

/** True while a visible counter is showing its own "+N", so `BubblePop` must not. */
export function useBubbleReactionClaimed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => claims > 0,
    () => false,
  )
}
