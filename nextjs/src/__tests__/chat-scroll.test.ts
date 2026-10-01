/**
 * Issue #811 — chat scroll anchoring. jsdom can't measure layout, so the
 * decisions the hook makes are pure functions over numbers, tested here; the
 * real scrolling is covered by e2e/chat-scroll-anchor.spec.ts.
 */

import {
  ANCHOR_OFFSET_PX,
  decideTurnScroll,
  isNearBottom,
  replyFillsViewport,
  requiredSpacer,
} from '@/lib/chat-scroll'

describe('decideTurnScroll — follow the reply only until it fills the viewport', () => {
  it('keeps the anchor pinned while the reply is shorter than the viewport', () => {
    expect(
      decideTurnScroll({ userScrolled: false, following: false, replyFillsViewport: false }),
    ).toBe('pin-anchor')
  })

  it('stops following once the reply fills the viewport, so its top stays in view', () => {
    expect(
      decideTurnScroll({ userScrolled: false, following: false, replyFillsViewport: true }),
    ).toBe('none')
  })

  it('stops all auto-scrolling for the turn once the user has scrolled', () => {
    expect(
      decideTurnScroll({ userScrolled: true, following: false, replyFillsViewport: false }),
    ).toBe('none')
    expect(
      decideTurnScroll({ userScrolled: true, following: false, replyFillsViewport: true }),
    ).toBe('none')
  })

  it('follows the bottom after "jump to latest", however long the reply is', () => {
    expect(
      decideTurnScroll({ userScrolled: false, following: true, replyFillsViewport: true }),
    ).toBe('follow-bottom')
  })

  it('a user scroll beats a jump-to-latest follow', () => {
    expect(
      decideTurnScroll({ userScrolled: true, following: true, replyFillsViewport: true }),
    ).toBe('none')
  })
})

describe('replyFillsViewport', () => {
  it('is false while the user message plus reply fit below the anchor offset', () => {
    expect(replyFillsViewport({ turnHeight: 300, clientHeight: 600 })).toBe(false)
  })

  it('is true once the turn is as tall as the viewport minus the anchor offset', () => {
    expect(replyFillsViewport({ turnHeight: 600 - ANCHOR_OFFSET_PX, clientHeight: 600 })).toBe(true)
    expect(replyFillsViewport({ turnHeight: 1400, clientHeight: 600 })).toBe(true)
  })
})

describe('requiredSpacer — blank room so the sent message can reach the top', () => {
  it('is the room missing below the content to put the anchor at the top', () => {
    // User message sits 900px down a 1000px-tall thread, in a 600px viewport:
    // scrolling it to (900 - offset) needs content to reach 900 - offset + 600.
    expect(
      requiredSpacer({ anchorTop: 900, contentHeight: 1000, clientHeight: 600 }),
    ).toBe(900 - ANCHOR_OFFSET_PX + 600 - 1000)
  })

  it('shrinks to nothing as the reply grows past the viewport', () => {
    expect(
      requiredSpacer({ anchorTop: 900, contentHeight: 900 + 600, clientHeight: 600 }),
    ).toBe(0)
    expect(
      requiredSpacer({ anchorTop: 900, contentHeight: 5000, clientHeight: 600 }),
    ).toBe(0)
  })

  it('never goes negative', () => {
    expect(requiredSpacer({ anchorTop: 0, contentHeight: 4000, clientHeight: 600 })).toBe(0)
  })
})

describe('isNearBottom — drives the "jump to latest" pill', () => {
  it('is true at the very bottom', () => {
    expect(isNearBottom({ scrollTop: 400, clientHeight: 600, scrollHeight: 1000 })).toBe(true)
  })

  it('is true within the slack of a few pixels', () => {
    expect(isNearBottom({ scrollTop: 380, clientHeight: 600, scrollHeight: 1000 })).toBe(true)
  })

  it('is false when a screen of content is still below', () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 600, scrollHeight: 1000 })).toBe(false)
  })

  it('is true when nothing overflows at all', () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 600, scrollHeight: 400 })).toBe(true)
  })
})
