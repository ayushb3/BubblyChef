/**
 * Issue #654 (S8) — `lib/cook-awards.ts`, the one place a cook confirm's
 * bubble award keys are built. `cookAwardRefs` and `rescueCandidates` are
 * pure; `readExpiryByItemId` and `awardCookBubbles` are exercised through
 * light fakes, mirroring `meals-ai-proxy-routes.test.ts`'s style.
 */

import { cookAwardRefs, rescueCandidates, readExpiryByItemId, awardCookBubbles } from '@/lib/cook-awards'

jest.mock('@/lib/bubbles', () => ({
  awardBubbles: jest.fn(async () => 10),
  RESCUE_CAP_PER_COOK: 3,
}))

import { awardBubbles } from '@/lib/bubbles'

const awardBubblesMock = awardBubbles as jest.Mock

afterEach(() => {
  jest.clearAllMocks()
})

describe('cookAwardRefs', () => {
  it('a recipe subject with a recipe_id: cook_confirm keyed, no meal_bonus', () => {
    const refs = cookAwardRefs({ kind: 'recipe', recipeId: 'recipe-1' }, '2026-09-29')
    expect(refs.cookConfirm).toBe('recipe-1:2026-09-29')
    expect(refs.mealBonus).toBeNull()
    expect(refs.rescue('item-1')).toBe('item-1:2026-09-29')
  })

  it('a recipe subject with no recipe_id: no cook_confirm award', () => {
    const refs = cookAwardRefs({ kind: 'recipe', recipeId: null }, '2026-09-29')
    expect(refs.cookConfirm).toBeNull()
  })

  it('a meal subject: cook_confirm and meal_bonus both meal:<id>:<date>', () => {
    const refs = cookAwardRefs({ kind: 'meal', mealId: 'meal-1' }, '2026-09-29')
    expect(refs.cookConfirm).toBe('meal:meal-1:2026-09-29')
    expect(refs.mealBonus).toBe('meal:meal-1:2026-09-29')
    expect(refs.rescue('item-1')).toBe('item-1:2026-09-29')
  })
})

describe('rescueCandidates', () => {
  const expiry = new Map<string, string | null>([
    ['item-1', '2026-09-30'], // 1 day out — expiring soon
    ['item-2', '2026-09-30'],
    ['item-3', '2026-09-30'],
    ['item-4', '2026-09-30'], // 4th expiring-soon — must be capped out
    ['item-5', '2027-01-01'], // far out — not expiring soon
    ['item-6', null],
  ])
  const validDate = '2026-09-29'

  it('filters to expiring-soon, de-duplicates, and caps at RESCUE_CAP_PER_COOK', () => {
    const ids = ['item-1', 'item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6']
    expect(rescueCandidates(ids, expiry, validDate)).toEqual(['item-1', 'item-2', 'item-3'])
  })

  it('excludes ids the confirm refused to deduct (N4)', () => {
    const ids = ['item-1', 'item-2', 'item-3']
    expect(rescueCandidates(ids, expiry, validDate, ['item-2'])).toEqual(['item-1', 'item-3'])
  })

  it('preserves the input order', () => {
    const ids = ['item-3', 'item-1', 'item-2']
    expect(rescueCandidates(ids, expiry, validDate)).toEqual(['item-3', 'item-1', 'item-2'])
  })
})

describe('readExpiryByItemId', () => {
  it('maps id -> expiry_date for the given ids', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [
                { id: 'item-1', expiry_date: '2026-09-30' },
                { id: 'item-2', expiry_date: null },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    const result = await readExpiryByItemId(supabase as never, 'user-1', ['item-1', 'item-2'])
    expect(result.get('item-1')).toBe('2026-09-30')
    expect(result.get('item-2')).toBeNull()
  })

  it('returns an empty map, and never queries, for an empty id list', async () => {
    const fromSpy = jest.fn()
    const supabase = { from: fromSpy }
    const result = await readExpiryByItemId(supabase as never, 'user-1', [])
    expect(result.size).toBe(0)
    expect(fromSpy).not.toHaveBeenCalled()
  })
})

describe('awardCookBubbles', () => {
  it('awards cook_confirm, then meal_bonus, then each rescue, in that order', async () => {
    const refs = cookAwardRefs({ kind: 'meal', mealId: 'meal-1' }, '2026-09-29')
    await awardCookBubbles('user-1', refs, ['item-1', 'item-2'])

    expect(awardBubblesMock.mock.calls).toEqual([
      ['user-1', 'cook_confirm', 'meal:meal-1:2026-09-29'],
      ['user-1', 'meal_bonus', 'meal:meal-1:2026-09-29'],
      ['user-1', 'rescue', 'item-1:2026-09-29'],
      ['user-1', 'rescue', 'item-2:2026-09-29'],
    ])
  })

  it('skips a null cookConfirm / mealBonus rather than awarding a null ref', async () => {
    const refs = cookAwardRefs({ kind: 'recipe', recipeId: null }, '2026-09-29')
    await awardCookBubbles('user-1', refs, [])
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })
})
