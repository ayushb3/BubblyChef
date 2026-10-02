'use client'

/**
 * The bubbles balance as the kitchen scene's HUD (issue #907): the pixel counter in
 * the wall's top-right corner, inset 8px, like a score on a game screen. It used to
 * sit in the page header (`KitchenHeader`, issues #748, #741).
 *
 * `KitchenWall` mounts it last, so it paints over the wall art (the lights slot's
 * decoration is the one thing it can cover) and, being inside the wall's own
 * stacking context, under every sheet. The wrapper is `pointer-events-none`: the
 * counter is not a control, so a tap near it falls through to the wall. At 375 and
 * 412px it ends above the chalkboard's tap box and far above Bubbly's rows;
 * `e2e/kitchen-balance-hud.spec.ts` measures that.
 *
 * It owns the award-reaction claim (issue #843): while it is on screen its own "+N"
 * tag, which hangs under the number and rises over the wall, is the one reaction and
 * the global `BubblePop` stays quiet. The wrapper keeps the old
 * `kitchen-bubbles-balance-group` testid, the element the claim measures.
 *
 * Mounted only once the balance is known (`KitchenScene` passes nothing while it is
 * loading or failed), so there is never a flash of `0`.
 */
import { useRef } from 'react'
import BubblesCounter from '@/components/ui/BubblesCounter'
import { useClaimBubbleReaction } from '@/lib/bubble-reaction'

export interface KitchenBalanceProps {
  value: number
}

export default function KitchenBalance({ value }: KitchenBalanceProps) {
  const ref = useRef<HTMLDivElement>(null)
  useClaimBubbleReaction(ref, true)
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-2 right-2 z-10"
      data-testid="kitchen-bubbles-balance-group"
    >
      <BubblesCounter value={value} testId="kitchen-bubbles-balance" />
    </div>
  )
}
