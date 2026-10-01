/**
 * "Plan dinner around these" (issue #749): the storage sheet's Use first key
 * seeds the plan-dinner chat with the foods that need using. A bare
 * `?plan=dinner` is unchanged (chat-seed.test.ts).
 */
import { deriveChatSeed, planDinnerHref, PLAN_DINNER_MESSAGE } from '@/lib/chat-seed'

describe('planDinnerHref with foods', () => {
  it('stays the bare plan link with no foods', () => {
    expect(planDinnerHref()).toBe('/chat?plan=dinner')
    expect(planDinnerHref([])).toBe('/chat?plan=dinner')
  })

  it('carries the foods in one param, whatever characters their names have', () => {
    const href = planDinnerHref(['Romaine', 'Chicken thighs', 'Mac & cheese, large'])
    expect(href.startsWith('/chat?plan=dinner&with=')).toBe(true)
    const seed = deriveChatSeed(new URL(href, 'http://x').searchParams)
    expect(seed?.kind).toBe('plan')
    expect(seed?.message).toContain('Romaine, Chicken thighs and Mac & cheese, large')
  })
})

describe('deriveChatSeed for a plan with foods', () => {
  it('still opens with the plan-dinner request, then names the foods', () => {
    const seed = deriveChatSeed(new URLSearchParams('plan=dinner&with=Romaine|Greek yogurt'))
    expect(seed?.kind).toBe('plan')
    expect(seed?.message.startsWith(PLAN_DINNER_MESSAGE)).toBe(true)
    expect(seed?.message).toBe('Plan dinner for tonight, built around my Romaine and Greek yogurt')
    expect(seed?.card.subtitle).toBe('Using your Romaine and Greek yogurt')
  })

  it('reads one food, and three, in plain English', () => {
    expect(deriveChatSeed(new URLSearchParams('plan=dinner&with=Eggs'))?.message).toMatch(/my Eggs$/)
    expect(deriveChatSeed(new URLSearchParams('plan=dinner&with=A|B|C'))?.message).toMatch(
      /my A, B and C$/,
    )
  })

  it('keys the one-shot send by the foods, so a different list is a new request', () => {
    const a = deriveChatSeed(new URLSearchParams('plan=dinner&with=A'))
    const b = deriveChatSeed(new URLSearchParams('plan=dinner&with=B'))
    const bare = deriveChatSeed(new URLSearchParams('plan=dinner'))
    expect(new Set([a?.key, b?.key, bare?.key]).size).toBe(3)
  })

  it('cleans and caps what a crafted link carries', () => {
    const many = Array.from({ length: 12 }, (_, n) => `Food ${n}`).join('|')
    const seed = deriveChatSeed(new URLSearchParams({ plan: 'dinner', with: `  |x\nline\u0000|${many}` }))
    expect(seed?.message).not.toMatch(/[\n\u0000]/)
    expect(seed?.message.split(' and ').length).toBe(2)
    // at most six foods
    expect((seed?.message.match(/Food|x line/g) ?? []).length).toBeLessThanOrEqual(6)
  })

  it('ignores a blank list', () => {
    expect(deriveChatSeed(new URLSearchParams('plan=dinner&with= | '))?.message).toBe(
      PLAN_DINNER_MESSAGE,
    )
  })
})
