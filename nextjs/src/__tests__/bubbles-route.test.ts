/**
 * @jest-environment node
 *
 * Tests for `GET /api/bubbles` (issue #520): awards the daily visit, then
 * returns the balance (0 when the user has no row) and recent events.
 *
 * Issue #524 extends this route with a lazy weekly rescue-streak settlement,
 * so the mock Supabase client below needs to answer a few more tables
 * (`bubble_events` queried a second time for the settlement window,
 * `pantry_events` and `pantry_items` for waste) on top of the original
 * `bubble_balances` + `bubble_events` (recent) pair. `chain()` builds a
 * generic chainable/thenable query builder so every test doesn't have to
 * hand-wire each new method call.
 */

const mockUser = { id: 'user-1' }

/** Today's UTC date as YYYY-MM-DD — the route accepts anything within a day of this. */
const today = new Date().toISOString().slice(0, 10)

const upsertMock = jest.fn(() => ({
  select: async () => ({ data: [{ id: 'evt-1' }], error: null }),
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}))

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))

import { requireAuth } from '@/lib/response-helpers'
import { isoWeekKey, weekRange } from '@/lib/streak'
import { addDaysToDateString } from '@/lib/date'

const mockRequireAuth = requireAuth as jest.Mock

/**
 * An ISO timestamp safely inside the most recently COMPLETED Mon-Sun week
 * relative to `today`, regardless of what weekday `today` happens to be —
 * a fixed "N days ago" offset can land in the wrong completed week when
 * `today` is close to a Monday.
 */
function withinLastCompletedWeek(): string {
  const lastCompletedWeekKey = isoWeekKey(addDaysToDateString(today, -7))
  const { start } = weekRange(lastCompletedWeekKey)
  return new Date(`${addDaysToDateString(start, 2)}T12:00:00Z`).toISOString()
}

/** A query-builder stub: every chainable method returns itself, and it resolves `{ data, error: null }` whether awaited directly or after `.limit()`/`.maybeSingle()`. */
function chain(data: unknown) {
  const obj: Record<string, unknown> = {}
  const chainable = ['select', 'eq', 'gte', 'gt', 'lt', 'order', 'in', 'or']
  for (const method of chainable) {
    obj[method] = () => obj
  }
  obj.limit = async () => ({ data, error: null })
  obj.maybeSingle = async () => ({ data, error: null })
  obj.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null })
  return obj
}

/**
 * A Supabase stub covering every table the route (and its settlement/waste
 * helpers) can touch. `tableData` overrides specific tables; anything not
 * listed resolves to an empty array, which the settlement path treats as
 * "no activity, no waste" — a clean baseline for tests that aren't
 * exercising the streak itself.
 */
function makeSupabase(tableData: Record<string, unknown> = {}) {
  return {
    from: (table: string) => chain(tableData[table] ?? []),
  }
}

describe('GET /api/bubbles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsertMock.mockImplementation(() => ({
      select: async () => ({ data: [{ id: 'evt-1' }], error: null }),
    }))
  })

  it('requires a date query param', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request('http://localhost/api/bubbles'))

    expect(res.status).toBe(400)
  })

  it('returns balance 0 when the user has no bubble_balances row', async () => {
    const supabase = makeSupabase()
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ balance: 0, recent: [], streak_weeks: 0, wasted_this_week: false })
    expect(upsertMock).toHaveBeenCalled()
  })

  it('returns the balance and recent events when present', async () => {
    const recentEvents = [{ id: 'evt-1', event_type: 'pantry_add', amount: 2 }]
    const supabase = {
      from: (table: string) => {
        if (table === 'bubble_balances') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance: 42 } }) }) }) }
        }
        if (table === 'bubble_events') {
          // Serves both the "recent" query (order().limit()) and the
          // settlement window query (gte(), awaited directly).
          const obj: Record<string, unknown> = {}
          obj.select = () => obj
          obj.eq = () => obj
          obj.gte = () => obj
          obj.order = () => obj
          obj.limit = async () => ({ data: recentEvents })
          obj.then = (resolve: (v: { data: unknown; error: null }) => void) =>
            resolve({ data: [], error: null })
          return obj
        }
        return chain([])
      },
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.balance).toBe(42)
    expect(data.recent).toEqual(recentEvents)
  })

  it('rejects a date far outside the server clock skew window and does not award', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request('http://localhost/api/bubbles?date=2020-01-01'))

    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('awards the daily_visit event keyed on the date for a valid date', async () => {
    const supabase = makeSupabase()
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'daily_visit',
        ref_key: today,
      }),
      expect.objectContaining({ onConflict: 'user_id,event_type,ref_key', ignoreDuplicates: true }),
    )
  })

  describe('weekly streak settlement (#524)', () => {
    it('reports a 0 streak and no waste for a brand new, idle account', async () => {
      const supabase = makeSupabase()
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data = await res.json()

      expect(data.streak_weeks).toBe(0)
      expect(data.wasted_this_week).toBe(false)
    })

    it('awards weekly_streak for a completed clean week and reports the streak', async () => {
      // A single bubble_event inside last week makes it both active and
      // unsettled — the route should award it and report streak 1.
      const lastWeekTimestamp = withinLastCompletedWeek()
      const supabase = makeSupabase({
        bubble_events: [{ event_type: 'pantry_add', ref_key: 'item-1', created_at: lastWeekTimestamp }],
      })
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data = await res.json()

      expect(data.streak_weeks).toBe(1)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: mockUser.id, event_type: 'weekly_streak' }),
        expect.anything(),
      )
    })

    it('does not award or count a week with a tossed pantry_event as clean', async () => {
      const lastWeekTimestamp = withinLastCompletedWeek()
      const supabase = makeSupabase({
        bubble_events: [{ event_type: 'pantry_add', ref_key: 'item-1', created_at: lastWeekTimestamp }],
        pantry_events: [{ item_name: 'Milk', created_at: lastWeekTimestamp }],
      })
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data = await res.json()

      expect(data.streak_weeks).toBe(0)
      expect(upsertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'weekly_streak' }),
        expect.anything(),
      )
    })

    it('buckets a tossed item by the CLIENT local date, not the raw UTC date, so a Sunday-evening-local toss still zeroes last week\'s streak (issue #524 review)', async () => {
      // A timestamp just after midnight UTC on the first day of the CURRENT
      // week — under naive UTC bucketing this lands in the new
      // (in-progress) week and the just-ended week reads clean. At
      // UTC-7 it's still Sunday evening local, i.e. inside the week that
      // just completed.
      const currentWeekKey = isoWeekKey(today)
      const { start: currentWeekStart } = weekRange(currentWeekKey)
      const boundaryTimestamp = `${currentWeekStart}T02:00:00Z`

      const lastWeekTimestamp = withinLastCompletedWeek()
      const supabase = makeSupabase({
        bubble_events: [{ event_type: 'pantry_add', ref_key: 'item-1', created_at: lastWeekTimestamp }],
        pantry_events: [{ item_name: 'Milk', created_at: boundaryTimestamp }],
      })
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(
        new Request(`http://localhost/api/bubbles?date=${today}&tz_offset_minutes=-420`),
      )
      const data = await res.json()

      expect(data.streak_weeks).toBe(0)
      expect(upsertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'weekly_streak' }),
        expect.anything(),
      )
    })

    it('reports wasted_this_week from an expired, still-in-pantry item', async () => {
      const supabase = makeSupabase({
        pantry_items: [{ name: 'Yogurt', expiry_date: today, quantity: 1 }],
      })
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data = await res.json()

      expect(data.wasted_this_week).toBe(true)
    })

    it('a week settled as wasted stays unpaid on a later visit after the expired item is deleted (regression, issue #524/#570)', async () => {
      // A `daily_visit` from yesterday stands in for "settlement already ran
      // once" — the last completed week had already ended by then, so it
      // was already judged (and, per this scenario, judged wasted: no
      // `weekly_streak` row exists for it). Today there's no waste at all
      // (`pantry_items`/`pantry_events` are both empty, as if the expired
      // item had since been deleted) — without the judge-once fix this
      // would now read clean and pay retroactively.
      const lastWeekTimestamp = withinLastCompletedWeek()
      const previousVisitDate = addDaysToDateString(today, -1)
      const supabase = makeSupabase({
        bubble_events: [
          { event_type: 'pantry_add', ref_key: 'item-1', created_at: lastWeekTimestamp },
          {
            event_type: 'daily_visit',
            ref_key: previousVisitDate,
            created_at: `${previousVisitDate}T12:00:00Z`,
          },
        ],
      })
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data = await res.json()

      expect(data.streak_weeks).toBe(0)
      expect(upsertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'weekly_streak' }),
        expect.anything(),
      )
    })
  })
})
