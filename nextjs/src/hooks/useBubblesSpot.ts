'use client'

/**
 * Where the pixel Bubbles should stand right now (issue #752): the spot picker
 * (`lib/kitchen/bubbles-spot.ts`) fed with the three live signals.
 *
 *  - `scanOpen`: a receipt scan or the put-away sheet is open. The caller owns
 *    that state (home has none yet; the put-away ticket wires it).
 *  - the cook session, read from storage (`isCookingNow`), kept current: it is
 *    a `useSyncExternalStore`, so it is `false` on the server and the first
 *    client render, then the real answer, with no hydration mismatch. Another tab
 *    starting or ending a cook fires `storage`; a tab brought back to the front
 *    fires `visibilitychange` and `focus`, which covers a browser that throttled
 *    the event while the tab was hidden. Coming back to home in the same tab
 *    remounts this, which reads storage fresh.
 *  - `places`: whether anything is going off (`hasWilting`).
 */
import { useSyncExternalStore } from 'react'
import { hasWilting, isCookingNow, pickBubblesSpot, type BubblesSpot } from '@/lib/kitchen/bubbles-spot'
import type { PlaceSummaries } from '@/lib/kitchen/places'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener('focus', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener('focus', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

export interface UseBubblesSpotInput {
  /** `null` while the pantry is loading or failed to load. */
  places: PlaceSummaries | null
  /** A scan or the put-away sheet is open. Defaults to closed. */
  scanOpen?: boolean
}

export function useBubblesSpot({ places, scanOpen = false }: UseBubblesSpotInput): {
  spot: BubblesSpot
  cooking: boolean
} {
  const cooking = useSyncExternalStore(subscribe, isCookingNow, () => false)
  const spot = pickBubblesSpot({ scanOpen, cooking, wilting: hasWilting(places) })
  return { spot, cooking }
}
