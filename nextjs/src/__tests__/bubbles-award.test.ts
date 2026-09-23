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

import {
  awardBubbles,
  BUBBLE_AMOUNTS,
  isRateLimited,
  mostRecentEventCreatedAt,
  RATE_LIMIT_COOLDOWN_MS,
} from '@/lib/bubbles'

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

/**
 * Unit tests for `isRateLimited` (issue #550/#595 review): the 20h cooldown
 * on `created_at` is the actual anti-abuse boundary for `daily_visit` and
 * `cook_confirm` — client-supplied date/offset are not trustworthy for this,
 * see `mostRecentEventCreatedAt` below and its call sites.
 */
describe('isRateLimited', () => {
  it('is not rate limited when there is no prior event', () => {
    expect(isRateLimited(null)).toBe(false)
  })

  it('is rate limited just under the cooldown', () => {
    const now = Date.parse('2026-09-24T00:00:00.000Z')
    const last = new Date(now - (RATE_LIMIT_COOLDOWN_MS - 1)).toISOString()
    expect(isRateLimited(last, now)).toBe(true)
  })

  it('is not rate limited once the cooldown has fully elapsed', () => {
    const now = Date.parse('2026-09-24T00:00:00.000Z')
    const last = new Date(now - RATE_LIMIT_COOLDOWN_MS).toISOString()
    expect(isRateLimited(last, now)).toBe(false)
  })

  it('is not rate limited for an unparseable timestamp (fails open rather than throwing)', () => {
    expect(isRateLimited('not-a-timestamp')).toBe(false)
  })

  it('defaults the cooldown window to 20 hours', () => {
    expect(RATE_LIMIT_COOLDOWN_MS).toBe(20 * 60 * 60 * 1000)
  })
})

/**
 * Unit tests for `mostRecentEventCreatedAt` — reads through the
 * request-scoped (RLS-bound) client, not the service-role one `awardBubbles`
 * uses, and re-filters `event_type`/`ref_key` in JS so it stays correct even
 * against a query double that doesn't actually apply `.eq()`/`.like()`.
 */
describe('mostRecentEventCreatedAt', () => {
  function chainableSupabase(rows: Array<Record<string, unknown>>) {
    const obj: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'order', 'like']) {
      obj[method] = () => obj
    }
    obj.limit = async () => ({ data: rows, error: null })
    return { from: () => obj }
  }

  it('returns null when there are no matching rows', async () => {
    const supabase = chainableSupabase([])
    const result = await mostRecentEventCreatedAt(
      supabase as never,
      'user-1',
      'daily_visit',
    )
    expect(result).toBeNull()
  })

  it('returns the created_at of the most recent matching row', async () => {
    const supabase = chainableSupabase([
      { event_type: 'daily_visit', ref_key: '2026-09-20', created_at: '2026-09-20T12:00:00.000Z' },
      { event_type: 'daily_visit', ref_key: '2026-09-22', created_at: '2026-09-22T12:00:00.000Z' },
      { event_type: 'daily_visit', ref_key: '2026-09-21', created_at: '2026-09-21T12:00:00.000Z' },
    ])
    const result = await mostRecentEventCreatedAt(supabase as never, 'user-1', 'daily_visit')
    expect(result).toBe('2026-09-22T12:00:00.000Z')
  })

  it('ignores rows of a different event_type even if the query double returns them unfiltered', async () => {
    const supabase = chainableSupabase([
      { event_type: 'pantry_add', ref_key: 'item-1', created_at: '2026-09-23T12:00:00.000Z' },
    ])
    const result = await mostRecentEventCreatedAt(supabase as never, 'user-1', 'daily_visit')
    expect(result).toBeNull()
  })

  it('restricts to ref_keys starting with refKeyPrefix (one recipe\'s cook_confirm awards)', async () => {
    const supabase = chainableSupabase([
      { event_type: 'cook_confirm', ref_key: 'recipe-2:2026-09-23', created_at: '2026-09-23T12:00:00.000Z' },
      { event_type: 'cook_confirm', ref_key: 'recipe-1:2026-09-22', created_at: '2026-09-22T12:00:00.000Z' },
    ])
    const result = await mostRecentEventCreatedAt(
      supabase as never,
      'user-1',
      'cook_confirm',
      'recipe-1:',
    )
    expect(result).toBe('2026-09-22T12:00:00.000Z')
  })

  it('returns null (does not throw) when the query errors', async () => {
    const obj: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'order', 'like']) {
      obj[method] = () => obj
    }
    obj.limit = async () => ({ data: null, error: { message: 'boom' } })
    const supabase = { from: () => obj }
    const result = await mostRecentEventCreatedAt(supabase as never, 'user-1', 'daily_visit')
    expect(result).toBeNull()
  })

  it('returns null (does not throw) when the client throws synchronously', async () => {
    const supabase = {
      from: () => {
        throw new Error('network error')
      },
    }
    const result = await mostRecentEventCreatedAt(supabase as never, 'user-1', 'daily_visit')
    expect(result).toBeNull()
  })
})
