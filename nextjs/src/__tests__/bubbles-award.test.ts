/**
 * @jest-environment node
 *
 * Unit tests for `awardBubbles` (issue #520). Exercises the three cases the
 * issue's acceptance criteria calls out: a correct amount, a duplicate award
 * returning 0, and a thrown insert error returning 0 without throwing.
 */

const selectMock = jest.fn()
const upsertMock = jest.fn(() => ({ select: selectMock }))
const fromMock = jest.fn(() => ({ upsert: upsertMock }))

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fromMock }),
}))

import { awardBubbles, BUBBLE_AMOUNTS } from '@/lib/bubbles'

describe('awardBubbles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the configured amount for the event type on a fresh award', async () => {
    selectMock.mockResolvedValueOnce({ data: [{ id: 'evt-1' }], error: null })

    const amount = await awardBubbles('user-1', 'pantry_add', 'item-1')

    expect(amount).toBe(BUBBLE_AMOUNTS.pantry_add)
    expect(fromMock).toHaveBeenCalledWith('bubble_events')
    expect(upsertMock).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        event_type: 'pantry_add',
        amount: BUBBLE_AMOUNTS.pantry_add,
        ref_key: 'item-1',
      },
      { onConflict: 'user_id,event_type,ref_key', ignoreDuplicates: true },
    )
  })

  it('returns 0 when the award is a duplicate (ignoreDuplicates swallows it)', async () => {
    selectMock.mockResolvedValueOnce({ data: [], error: null })

    const amount = await awardBubbles('user-1', 'pantry_add', 'item-1')

    expect(amount).toBe(0)
  })

  it('returns 0 and does not throw when the insert errors', async () => {
    selectMock.mockResolvedValueOnce({ data: null, error: { message: 'db down' } })

    await expect(awardBubbles('user-1', 'recipe_save', 'recipe-1')).resolves.toBe(0)
  })

  it('returns 0 and does not throw when the client throws synchronously', async () => {
    selectMock.mockImplementationOnce(() => {
      throw new Error('network error')
    })

    await expect(awardBubbles('user-1', 'cook_confirm', 'recipe-1:2026-09-22')).resolves.toBe(0)
  })
})
