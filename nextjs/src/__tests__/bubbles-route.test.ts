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

  it('rejects a malformed date (not a date at all) and does not award', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request('http://localhost/api/bubbles?date=not-a-date'))

    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  describe('date validation (issue #550/#595 review: date/offset are unverified client input, not a security boundary — see "rate limiting" below for the actual anti-abuse mechanism)', () => {
    // #595 review finding 1: an earlier revision required `date` to exactly
    // match `tz_offset_minutes`-shifted server time and 400'd otherwise —
    // but `tz_offset_minutes` is client-supplied, so that "exact match" was
    // exact only relative to a number the caller chose (a fabricated offset
    // makes ANY date "the" accepted one). This is also a READ endpoint (the
    // award is a side effect of fetching the balance), so per the #595
    // review it must degrade, not 400, when the client's date doesn't match
    // the server's own idea of "today". A well-formed date is now accepted
    // regardless of whether it matches; the 20h cooldown below is what
    // actually bounds how often `daily_visit` can be awarded.

    it('accepts a well-formed date a day ahead of the server date and returns 200 (no longer 400s)', async () => {
      const tomorrow = addDaysToDateString(today, 1)
      const supabase = makeSupabase()
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${tomorrow}`))

      expect(res.status).toBe(200)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'daily_visit', ref_key: tomorrow }),
        expect.anything(),
      )
    })

    it("accepts a well-formed date far in the past and returns 200 (no longer 400s) — the client's date is not a security boundary", async () => {
      const supabase = makeSupabase()
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request('http://localhost/api/bubbles?date=2020-01-01'))

      expect(res.status).toBe(200)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'daily_visit', ref_key: '2020-01-01' }),
        expect.anything(),
      )
    })

    it('accepts the offset-derived local date for a UTC-7 client crossing UTC midnight (still works as a sensible ref_key even though it is not enforced)', async () => {
      jest.useFakeTimers().setSystemTime(new Date(`${today}T00:30:00.000Z`))
      const localDate = addDaysToDateString(today, -1)
      const supabase = makeSupabase()
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(
        new Request(`http://localhost/api/bubbles?date=${localDate}&tz_offset_minutes=-420`),
      )

      expect(res.status).toBe(200)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'daily_visit', ref_key: localDate }),
        expect.anything(),
      )
      jest.useRealTimers()
    })
  })

  describe('daily_visit rate limiting (issue #550/#595 review: a 20h cooldown on created_at, not the date, is the actual anti-abuse boundary)', () => {
    it('skips the daily_visit award when the most recent one was created less than 20h ago, even though the requested date is a NEW ref_key', async () => {
      // A shifted offset makes tomorrow "the" local date, but the cooldown
      // blocks the award regardless of what ref_key that date would use.
      const tomorrow = addDaysToDateString(today, 1)
      const recentlyCreated = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago
      const supabase = makeSupabase({
        bubble_events: [{ event_type: 'daily_visit', ref_key: today, created_at: recentlyCreated }],
      })
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${tomorrow}`))

      expect(res.status).toBe(200)
      expect(upsertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'daily_visit' }),
        expect.anything(),
      )
    })

    it('awards daily_visit again once the most recent one is more than 20h old', async () => {
      const staleCreated = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString() // 21h ago
      const supabase = makeSupabase({
        bubble_events: [
          { event_type: 'daily_visit', ref_key: addDaysToDateString(today, -1), created_at: staleCreated },
        ],
      })
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))

      expect(res.status).toBe(200)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'daily_visit', ref_key: today }),
        expect.anything(),
      )
    })
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

    it('a failed settlement does not write daily_visit, and the response still succeeds (re-review #4, issue #524/#570)', async () => {
      // The settlement's own Promise.all array is built synchronously, so
      // the very first `.from('bubble_events')` call throwing aborts that
      // whole array (the second settlement query is never even reached) and
      // lands in settlement's try/catch. The route's LATER "recent" read is
      // a separate `.from('bubble_events')` call, made only after
      // settlement has already returned — it must succeed.
      let failedOnce = false
      const supabase = {
        from: (table: string) => {
          if (table === 'bubble_events' && !failedOnce) {
            failedOnce = true
            throw new Error('db exploded')
          }
          return chain([])
        },
      }
      mockRequireAuth.mockResolvedValue([supabase, mockUser])

      const { GET } = await import('@/app/api/bubbles/route')
      const res = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.streak_weeks).toBe(0)
      expect(upsertMock).not.toHaveBeenCalled()
      expect(upsertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'daily_visit' }),
        expect.anything(),
      )
    })

    it('after a failed settlement, the next visit the same day still judges the week the failure never reached (re-review #4, issue #524/#570)', async () => {
      const lastWeekTimestamp = withinLastCompletedWeek()
      const bubbleEventsRows: Array<Record<string, unknown>> = [
        { event_type: 'pantry_add', ref_key: 'item-1', created_at: lastWeekTimestamp },
      ]
      let failNextBubbleEventsReads = true

      function makeFlakySupabase() {
        return {
          from: (table: string) => {
            if (table === 'bubble_events') {
              if (failNextBubbleEventsReads) {
                failNextBubbleEventsReads = false
                throw new Error('db exploded')
              }
              return chain(bubbleEventsRows)
            }
            return chain([])
          },
        }
      }

      // Simulate writes actually landing back in the table the next read sees.
      ;(upsertMock as unknown as jest.Mock).mockImplementation((row: Record<string, unknown>) => ({
        select: async () => {
          bubbleEventsRows.push(row)
          return { data: [{ id: 'evt-x' }], error: null }
        },
      }))

      const { GET } = await import('@/app/api/bubbles/route')

      // First visit: the settlement read throws, so nothing is written —
      // no daily_visit, no weekly_streak.
      mockRequireAuth.mockResolvedValue([makeFlakySupabase(), mockUser])
      const res1 = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      expect(res1.status).toBe(200)
      expect(upsertMock).not.toHaveBeenCalled()

      // Second visit, same day: settlement succeeds this time. Because no
      // daily_visit was recorded by the failed first visit, the completed
      // week it would have judged is still a first judgment, not locked out.
      mockRequireAuth.mockResolvedValue([makeFlakySupabase(), mockUser])
      const res2 = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data2 = await res2.json()

      expect(data2.streak_weeks).toBe(1)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: mockUser.id, event_type: 'weekly_streak' }),
        expect.anything(),
      )
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: mockUser.id, event_type: 'daily_visit' }),
        expect.anything(),
      )
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

    it('a week judged wasted on an earlier visit stays unpaid on a second visit the SAME day after the expired item is deleted (regression, re-review #6, issue #524/#570)', async () => {
      // `previousVisitDate` now includes TODAY's own `daily_visit` (a6d4b14,
      // re-review #6) — so this exercises the same-day case the earlier
      // "later visit" regression above doesn't: settle once today (wasted,
      // no award), write today's `daily_visit`, delete the expired item,
      // then settle again today. The week must still not be paid.
      const lastWeekTimestamp = withinLastCompletedWeek()
      const lastCompletedWeekKey = isoWeekKey(addDaysToDateString(today, -7))
      const { start: lastWeekStart } = weekRange(lastCompletedWeekKey)
      const expiredDate = addDaysToDateString(lastWeekStart, 2) // inside last completed week

      const bubbleEventsRows: Array<Record<string, unknown>> = [
        { event_type: 'pantry_add', ref_key: 'item-1', created_at: lastWeekTimestamp },
      ]
      const pantryItems: Array<Record<string, unknown>> = [
        { name: 'Yogurt', expiry_date: expiredDate, quantity: 1 },
      ]

      function makeSupabaseWithState() {
        return {
          from: (table: string) => {
            if (table === 'bubble_events') return chain(bubbleEventsRows)
            if (table === 'pantry_items') return chain(pantryItems)
            return chain([])
          },
        }
      }

      // Simulate writes actually landing back in the table the next read
      // sees. `awardBubbles` doesn't set `created_at` itself (the DB
      // default does) — synthesize one so a re-read of this row can be
      // bucketed back into a local date.
      ;(upsertMock as unknown as jest.Mock).mockImplementation((row: Record<string, unknown>) => ({
        select: async () => {
          bubbleEventsRows.push({ ...row, created_at: new Date().toISOString() })
          return { data: [{ id: 'evt-x' }], error: null }
        },
      }))

      const { GET } = await import('@/app/api/bubbles/route')

      // First visit today: the week is active but wasted — judged, not paid.
      mockRequireAuth.mockResolvedValue([makeSupabaseWithState(), mockUser])
      const res1 = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data1 = await res1.json()
      expect(data1.streak_weeks).toBe(0)
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'daily_visit' }),
        expect.anything(),
      )
      expect(upsertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'weekly_streak' }),
        expect.anything(),
      )

      // The user deletes the expired item — the pantry now reads clean.
      pantryItems.length = 0

      // Second visit, same day: today's own `daily_visit` (written above) is
      // now `previousVisitDate`, so the already-judged week must not be
      // re-judged, even though it reads clean now.
      mockRequireAuth.mockResolvedValue([makeSupabaseWithState(), mockUser])
      const res2 = await GET(new Request(`http://localhost/api/bubbles?date=${today}`))
      const data2 = await res2.json()

      expect(data2.streak_weeks).toBe(0)
      expect(upsertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'weekly_streak' }),
        expect.anything(),
      )
    })
  })
})
