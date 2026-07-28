/**
 * Issues #143 (dashboard tip → primed chat) and #138 (expiring item → seeded
 * "cook this now" chat).
 *
 * The seeded message text is the *only* channel the AI service has for the
 * must-use ingredient — it runs an LLM structured-output pass over the message,
 * with no regex fallback and no API field. So these assertions on the exact
 * wording are load-bearing, not cosmetic: changing them silently breaks the
 * binding between the tapped item and the recipe that comes back.
 */
import {
  cookThisHref,
  deriveChatSeed,
  expiryPhrase,
  tipChatHref,
  tipSeedMessage,
  ingredientSeedMessage,
} from '@/lib/chat-seed'

/** Parse a `/chat?...` href back into something `deriveChatSeed` can read. */
function paramsOf(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf('?') + 1))
}

describe('no context bleed', () => {
  it('returns no seed for a bare /chat (bottom-nav entry)', () => {
    expect(deriveChatSeed(new URLSearchParams(''))).toBeNull()
  })

  it('returns no seed for unrelated params', () => {
    expect(deriveChatSeed(new URLSearchParams('mode=recipe&foo=bar'))).toBeNull()
  })

  it('ignores blank or whitespace-only params', () => {
    expect(deriveChatSeed(new URLSearchParams('tip='))).toBeNull()
    expect(deriveChatSeed(new URLSearchParams('use=%20%20'))).toBeNull()
  })

  it('ignores a stray expires= with no ingredient', () => {
    expect(deriveChatSeed(new URLSearchParams('expires=2026-07-29'))).toBeNull()
  })
})

describe('?use= seed (#138)', () => {
  it('emits the phrasing the backend extractor was tuned against', () => {
    expect(ingredientSeedMessage('eggs')).toBe(
      'What can I make with my eggs before they go bad?',
    )
  })

  it('keeps the "with my <name>" anchor the extractor keys on', () => {
    const seed = deriveChatSeed(new URLSearchParams('use=spinach'))
    expect(seed?.message).toContain('with my spinach')
  })

  it('interpolates the pantry name verbatim — no pluralising or title-casing', () => {
    const name = 'large free-range eggs'
    const seed = deriveChatSeed(paramsOf(cookThisHref(name)))
    expect(seed?.message).toBe('What can I make with my large free-range eggs before they go bad?')
    expect(seed?.card.title).toBe('Using your large free-range eggs')
  })

  it('reflects the ingredient and its expiry in the context card', () => {
    const now = new Date('2026-07-28T09:00:00Z')
    const seed = deriveChatSeed(new URLSearchParams('use=eggs&expires=2026-07-29'), now)
    expect(seed?.kind).toBe('use')
    expect(seed?.card.title).toBe('Using your eggs')
    expect(seed?.card.subtitle).toBe('expires tomorrow')
  })

  it('falls back to a generic subtitle when no expiry is supplied', () => {
    const seed = deriveChatSeed(new URLSearchParams('use=eggs'))
    expect(seed?.card.subtitle).toBe('before it goes bad')
  })

  it('round-trips names containing spaces and punctuation through the href', () => {
    const name = "chef's & co. crème fraîche"
    const seed = deriveChatSeed(paramsOf(cookThisHref(name, '2026-08-01')))
    expect(seed?.message).toContain(`with my ${name}`)
  })

  it('gives distinct seeds distinct keys so dismissal does not leak across items', () => {
    const a = deriveChatSeed(paramsOf(cookThisHref('eggs')))
    const b = deriveChatSeed(paramsOf(cookThisHref('spinach')))
    expect(a?.key).not.toBe(b?.key)
  })
})

describe('?tip= seed (#143)', () => {
  const tip = 'Pasta water makes sauces silky.'

  it('carries the tip text verbatim into the message sent to Bubbles', () => {
    const seed = deriveChatSeed(paramsOf(tipChatHref(tip)))
    expect(seed?.kind).toBe('tip')
    expect(seed?.message).toContain(tip)
  })

  it('asks for the why and the when, which is what the issue calls for', () => {
    expect(tipSeedMessage(tip)).toBe(
      `Tell me more about this kitchen tip: "${tip}" — why does it work, and when should I use it?`,
    )
  })

  it('shows the tip in a dismissible context card', () => {
    const seed = deriveChatSeed(paramsOf(tipChatHref(tip)))
    expect(seed?.card.label).toBe("Today's tip")
    expect(seed?.card.title).toBe(tip)
    expect(seed?.card.dismissLabel).toMatch(/dismiss/i)
  })

  it('wins over ?use= if both are somehow present', () => {
    expect(deriveChatSeed(new URLSearchParams('tip=Salt+early&use=eggs'))?.kind).toBe('tip')
  })
})

describe('expiryPhrase', () => {
  const now = new Date('2026-07-28T09:00:00Z')

  it.each([
    ['2026-07-27', 'already expired'],
    ['2026-07-28', 'expires today'],
    ['2026-07-29', 'expires tomorrow'],
    ['2026-08-01', 'expires in 4 days'],
  ])('%s → %s', (date, expected) => {
    expect(expiryPhrase(date, now)).toBe(expected)
  })

  it('returns null for missing or unparseable dates', () => {
    expect(expiryPhrase(null, now)).toBeNull()
    expect(expiryPhrase(undefined, now)).toBeNull()
    expect(expiryPhrase('not-a-date', now)).toBeNull()
  })
})
