/**
 * Issue #905: the "You haven't cooked in a while — want a suggestion?" nudge
 * opens a new chat and auto-sends a pantry-aware suggestion request through the
 * `?suggest=1` deep-link seed. The wording is the user's own voice, since it is
 * sent as the first message.
 */
import { deriveChatSeed, suggestHref, SUGGEST_MESSAGE } from '@/lib/chat-seed'

describe('?suggest= seed (#905)', () => {
  it('suggestHref() builds /chat?suggest=1', () => {
    expect(suggestHref()).toBe('/chat?suggest=1')
  })

  it("?suggest=1 seeds the haven't-cooked suggestion request, with a context card", () => {
    const seed = deriveChatSeed(new URLSearchParams('suggest=1'))
    expect(seed?.kind).toBe('suggest')
    expect(seed?.key).toBe('suggest')
    expect(seed?.message).toBe(SUGGEST_MESSAGE)
    expect(seed?.message).toBe("I haven't cooked in a while. What should I make today?")
    expect(seed?.context).toBeUndefined()
    expect(seed?.card.title).toBeTruthy()
    expect(seed?.card.dismissLabel).toBeTruthy()
  })

  it('round-trips through suggestHref()', () => {
    const href = suggestHref()
    const seed = deriveChatSeed(new URLSearchParams(href.slice(href.indexOf('?') + 1)))
    expect(seed?.kind).toBe('suggest')
  })

  it('a blank or non-1 value is not a seed', () => {
    expect(deriveChatSeed(new URLSearchParams('suggest='))).toBeNull()
    expect(deriveChatSeed(new URLSearchParams('suggest=0'))).toBeNull()
    expect(deriveChatSeed(new URLSearchParams('suggest=banana'))).toBeNull()
  })

  it('precedence: meal and plan win, suggest wins over ask, tip and use', () => {
    expect(deriveChatSeed(new URLSearchParams('suggest=1&plan=dinner'))?.kind).toBe('plan')
    expect(deriveChatSeed(new URLSearchParams('suggest=1&ask=hi'))?.kind).toBe('suggest')
    expect(deriveChatSeed(new URLSearchParams('suggest=1&tip=x'))?.kind).toBe('suggest')
    expect(deriveChatSeed(new URLSearchParams('suggest=1&use=eggs'))?.kind).toBe('suggest')
  })
})
