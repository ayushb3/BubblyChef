/**
 * `?ask=` seed (issue #755): the link form of a starter pill. The Bubbles card's
 * pills that have no dedicated seed (plan / use / tip / meal) send the same text a
 * tap on the pill inside the chat would.
 */
import { askHref, deriveChatSeed } from '@/lib/chat-seed'

describe('askHref', () => {
  it('puts the text in one ask param', () => {
    expect(askHref('Surprise me')).toBe('/chat?ask=Surprise+me')
  })
})

describe('deriveChatSeed: ask', () => {
  const seed = (qs: string) => deriveChatSeed(new URLSearchParams(qs), new Date(2026, 9, 1, 12))

  it('auto-sends the text as the first message', () => {
    const s = seed('ask=Something+in+20+minutes')!
    expect(s.kind).toBe('ask')
    expect(s.message).toBe('Something in 20 minutes')
    expect(s.key).toBe('ask:Something in 20 minutes')
    expect(s.card.title).toBe('Something in 20 minutes')
  })

  it('cleans control characters and bounds the length', () => {
    const s = seed(`ask=${encodeURIComponent('a\nb\u0000c ' + 'x'.repeat(400))}`)!
    expect(s.message).not.toMatch(/[\u0000-\u001f]/)
    expect(s.message.length).toBeLessThanOrEqual(160)
  })

  it('a blank ask is no seed', () => {
    expect(seed('ask=%20%20')).toBeNull()
  })

  it('plan and meal still win over ask, ask wins over tip and use', () => {
    expect(seed('plan=dinner&ask=hi')!.kind).toBe('plan')
    expect(seed('ask=hi&tip=a+tip')!.kind).toBe('ask')
    expect(seed('ask=hi&use=kale')!.kind).toBe('ask')
  })
})
