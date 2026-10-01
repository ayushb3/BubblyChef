/**
 * Chat scroll anchoring (issue #811) — the pure decisions.
 *
 * A meal-options or recipe reply is taller than the screen, so scrolling to the
 * bottom as it arrives leaves the reader at the END of it with the first card
 * off the top. Instead, sending a message scrolls so that the message sits near
 * the top of the thread and the reply streams in below it.
 *
 * jsdom cannot measure layout, so everything the scroll hook (`useChatScroll`)
 * has to *decide* lives here as functions over plain numbers.
 */

/** Gap kept above the sent message when it is anchored to the top. */
export const ANCHOR_OFFSET_PX = 8

/** How far from the bottom still counts as "at the bottom" (sub-pixel rounding, momentum). */
export const NEAR_BOTTOM_PX = 24

export interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/** True when the thread is scrolled to (or within a few pixels of) its end. */
export function isNearBottom(
  { scrollTop, clientHeight, scrollHeight }: ScrollMetrics,
  threshold: number = NEAR_BOTTOM_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

/**
 * Whether the turn (the sent message plus its reply so far) is as tall as the
 * viewport below the anchor. Once it is, there is no more room to "follow".
 */
export function replyFillsViewport({
  turnHeight,
  clientHeight,
}: {
  turnHeight: number
  clientHeight: number
}): boolean {
  return turnHeight >= clientHeight - ANCHOR_OFFSET_PX
}

/**
 * Blank space needed under the thread so the anchored message can actually be
 * scrolled to the top. `anchorTop` is the message's distance from the top of the
 * scrollable content; `contentHeight` is the content height WITHOUT the spacer.
 * Shrinks to zero as the reply grows tall enough to hold the viewport itself.
 */
export function requiredSpacer({
  anchorTop,
  contentHeight,
  clientHeight,
}: {
  anchorTop: number
  contentHeight: number
  clientHeight: number
}): number {
  return Math.max(0, anchorTop - ANCHOR_OFFSET_PX + clientHeight - contentHeight)
}

export type TurnScrollAction =
  /** Keep the sent message where it was anchored. */
  | 'pin-anchor'
  /** The user tapped "jump to latest" mid-stream: track the end of the reply. */
  | 'follow-bottom'
  /** Leave the scroll position alone. */
  | 'none'

/**
 * What to do with the scroll position when the thread's content changes during
 * a turn.
 *
 * - The user scrolled during this turn: never touch it again (beats everything).
 * - They jumped to the latest: follow the bottom, whatever the reply's length.
 * - The reply now fills the viewport: stop following, so the top of the reply
 *   (its first card) stays in view.
 * - Otherwise the reply is still short: keep the anchor pinned.
 */
export function decideTurnScroll({
  userScrolled,
  following,
  replyFillsViewport: fills,
}: {
  userScrolled: boolean
  following: boolean
  replyFillsViewport: boolean
}): TurnScrollAction {
  if (userScrolled) return 'none'
  if (following) return 'follow-bottom'
  if (fills) return 'none'
  return 'pin-anchor'
}
