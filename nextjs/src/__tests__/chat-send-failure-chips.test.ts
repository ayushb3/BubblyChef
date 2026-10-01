/**
 * Issue #847 — the pills under a failed-send reply offer Retry first, then a
 * way to take the text back. The generic "Try another" / "Tell me more" are not
 * offered: they would just fail the same way.
 */
import { resolveSendFailureChips } from '@/lib/chat-chips'

describe('resolveSendFailureChips (#847)', () => {
  it('offers Retry first, then Dismiss, both as client actions', () => {
    const chips = resolveSendFailureChips()
    expect(chips.map((c) => c.label)).toEqual(['Retry', 'Dismiss'])
    expect(chips.map((c) => [c.kind, c.action])).toEqual([
      ['action', 'retry_send'],
      ['action', 'dismiss_send'],
    ])
  })

  it('has no generic follow-up pills', () => {
    const labels = resolveSendFailureChips().map((c) => c.label)
    expect(labels).not.toContain('Try another')
    expect(labels).not.toContain('Tell me more')
  })
})
