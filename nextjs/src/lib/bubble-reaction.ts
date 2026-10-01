/**
 * Who shows the "+N" when the bubbles balance rises (issue #843).
 *
 * There are two reactions to an award: the global `BubblePop` (pinned top-right,
 * mounted once in `Providers`, visible on every page) and the header counter's
 * own "+N" tag (`BubblesCounter`, anchored under the number on the kitchen
 * home). Both watch the same balance, so after a put-away the home showed two at
 * once. The rule is one award moment per award: while the counter is actually on
 * screen, its tag is the reaction and `BubblePop` stays quiet; otherwise (the home
 * scrolled so the header is out of view, or any other page) `BubblePop` shows, so
 * an award is never left with no visible "+N".
 *
 * "On screen" is measured, not assumed: the header is not sticky, so mounted is
 * not the same as visible. A counter registers its element with
 * `useClaimBubbleReaction(ref, active)`; an `IntersectionObserver` tracks whether
 * at least half of it is in the viewport (the tag hangs just under it). Where
 * `IntersectionObserver` does not exist, the element's rectangle is checked at the
 * moment of the award instead. `BubblePop` asks `isBubbleReactionClaimed()` when a
 * balance rise arrives. Several registered counters are fine: any visible one claims.
 */
import { useEffect, type RefObject } from 'react'

interface Claim {
  el: Element
  /** An observer is tracking `visible`; without one the rectangle is read on demand. */
  observed: boolean
  visible: boolean
}

const claims = new Set<Claim>()

/** The element's box overlaps the viewport by any amount (the no-observer fallback). */
function rectInView(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > 0 &&
    r.top < window.innerHeight &&
    r.right > 0 &&
    r.left < window.innerWidth
  )
}

/** Claim the award reaction while `active` and the element behind `ref` is on screen. */
export function useClaimBubbleReaction(ref: RefObject<Element | null>, active: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    const claim: Claim = {
      el,
      observed: typeof IntersectionObserver !== 'undefined',
      visible: false,
    }
    claims.add(claim)
    let observer: IntersectionObserver | null = null
    if (claim.observed) {
      observer = new IntersectionObserver(
        (entries) => {
          const last = entries[entries.length - 1]
          if (last) claim.visible = last.isIntersecting && last.intersectionRatio >= 0.5
        },
        { threshold: [0, 0.5, 1] },
      )
      observer.observe(el)
    }
    return () => {
      observer?.disconnect()
      claims.delete(claim)
    }
  }, [ref, active])
}

/** True while a counter is on screen showing its own "+N", so `BubblePop` must not. */
export function isBubbleReactionClaimed(): boolean {
  for (const claim of claims) {
    if (claim.observed ? claim.visible : rectInView(claim.el)) return true
  }
  return false
}
