/**
 * @jest-environment node
 *
 * Test for `POST /api/pantry/bulk` (issue #398): this is the route the
 * manual "Type" pantry-add form actually submits to (via
 * `bulkAddPantryItems`). Mirrors the precedence already covered for the
 * single-item `POST /api/pantry` route in
 * `pantry-post-estimated-expiry.test.ts` (#363): an explicit
 * `estimated_expiry` from the client always wins (this is what the
 * catalog-autofill wiring sends); otherwise fall back to flagging a date
 * this route guessed itself via the heuristic. A genuinely user-supplied
 * date with no explicit flag still comes out false.
 */
import { POST } from '@/app/api/pantry/bulk/route'

const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))

jest.mock('@/lib/pantry-helpers', () => ({
  enrichPantryItem: (row: Record<string, unknown>) => row,
}))

jest.mock('@/lib/api/ai-proxy', () => ({
  estimateExpiry: jest.fn(),
  estimateCategory: jest.fn(),
  normalizeBaseUnit: jest.fn(),
}))

import { requireAuth } from '@/lib/response-helpers'
import { estimateExpiry, estimateCategory, normalizeBaseUnit } from '@/lib/api/ai-proxy'

function makeSupabaseMock(storedRows: { current: Record<string, unknown>[] }) {
  return {
    from: () => ({
      insert: (payload: Record<string, unknown>[]) => {
        storedRows.current = payload
        return {
          select: async () => ({ data: payload.map((r, i) => ({ id: `item-${i}`, ...r })), error: null }),
        }
      },
    }),
  }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/pantry/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  ;(estimateCategory as jest.Mock).mockResolvedValue('dairy')
  ;(normalizeBaseUnit as jest.Mock).mockResolvedValue({ quantity_base: null, unit_base: null })
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/pantry/bulk estimated_expiry flagging (#398)', () => {
  it('honours an explicit estimated_expiry: true from the client (catalog autofill)', async () => {
    const storedRows = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedRows), mockUser])

    await POST(
      makeRequest({
        items: [
          {
            name: 'Milk',
            unit: 'gallon',
            category: 'dairy',
            storage_location: 'fridge',
            expiry_date: '2026-10-01',
            estimated_expiry: true,
          },
        ],
      }),
    )

    expect(storedRows.current[0].expiry_date).toBe('2026-10-01')
    expect(storedRows.current[0].estimated_expiry).toBe(true)
    expect(estimateExpiry).not.toHaveBeenCalled()
  })

  it('honours an explicit estimated_expiry: false from the client (user-edited date)', async () => {
    const storedRows = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedRows), mockUser])

    await POST(
      makeRequest({
        items: [
          {
            name: 'Milk',
            expiry_date: '2027-06-15',
            estimated_expiry: false,
          },
        ],
      }),
    )

    expect(storedRows.current[0].expiry_date).toBe('2027-06-15')
    expect(storedRows.current[0].estimated_expiry).toBe(false)
  })

  it('falls back to the heuristic flag when no explicit estimated_expiry is sent', async () => {
    const storedRows = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedRows), mockUser])
    ;(estimateExpiry as jest.Mock).mockResolvedValue('2026-11-01')

    await POST(makeRequest({ items: [{ name: 'Bread' }] }))

    expect(storedRows.current[0].expiry_date).toBe('2026-11-01')
    expect(storedRows.current[0].estimated_expiry).toBe(true)
  })

  it('a plain user-supplied date with no flag is not marked estimated', async () => {
    const storedRows = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedRows), mockUser])

    await POST(makeRequest({ items: [{ name: 'Bread', expiry_date: '2026-12-25' }] }))

    expect(storedRows.current[0].expiry_date).toBe('2026-12-25')
    expect(storedRows.current[0].estimated_expiry).toBe(false)
    expect(estimateExpiry).not.toHaveBeenCalled()
  })

  it('#363/#439: a server-guessed date is still flagged estimated even when the client sends estimated_expiry: false with no date (Type tab blank-date row)', async () => {
    const storedRows = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedRows), mockUser])
    ;(estimateExpiry as jest.Mock).mockResolvedValue('2026-11-01')

    await POST(
      makeRequest({
        items: [{ name: 'Bread', expiry_date: null, estimated_expiry: false }],
      }),
    )

    expect(storedRows.current[0].expiry_date).toBe('2026-11-01')
    expect(storedRows.current[0].estimated_expiry).toBe(true)
  })
})
