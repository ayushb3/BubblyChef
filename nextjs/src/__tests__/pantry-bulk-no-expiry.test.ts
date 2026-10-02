/**
 * @jest-environment node
 *
 * `POST /api/pantry/bulk` with `no_expiry` (issue #853): the first-run staples
 * add shelf-stable items (salt, rice, olive oil) with no expiry at all, while an
 * item without the flag still gets the usual estimate.
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

jest.mock('@/lib/bubbles', () => ({ awardBubbles: jest.fn() }))

import { requireAuth } from '@/lib/response-helpers'
import { estimateExpiry, estimateCategory, normalizeBaseUnit } from '@/lib/api/ai-proxy'

function makeSupabaseMock(storedRows: { current: Record<string, unknown>[] }) {
  return {
    from: () => ({
      insert: (payload: Record<string, unknown>[]) => {
        storedRows.current = payload
        return {
          select: async () => ({
            data: payload.map((r, i) => ({ id: `item-${i}`, ...r })),
            error: null,
          }),
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
  ;(estimateCategory as jest.Mock).mockResolvedValue('other')
  ;(estimateExpiry as jest.Mock).mockResolvedValue('2026-12-01')
  ;(normalizeBaseUnit as jest.Mock).mockResolvedValue({ quantity_base: null, unit_base: null })
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/pantry/bulk no_expiry (#853)', () => {
  it('saves a no_expiry item with no expiry and never asks for an estimate', async () => {
    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])

    const res = await POST(
      makeRequest({
        items: [
          {
            name: 'Salt',
            unit: 'item',
            category: 'condiments',
            storage_location: 'pantry',
            expiry_date: null,
            no_expiry: true,
          },
        ],
      }),
    )

    expect(res.status).toBe(201)
    expect(stored.current[0].expiry_date).toBeNull()
    expect(stored.current[0].estimated_expiry).toBe(false)
    expect(estimateExpiry).not.toHaveBeenCalled()
  })

  it('still estimates an expiry for an item without the flag', async () => {
    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])

    await POST(
      makeRequest({
        items: [
          { name: 'Milk', unit: 'L', category: 'dairy', storage_location: 'fridge', expiry_date: null },
        ],
      }),
    )

    expect(estimateExpiry).toHaveBeenCalledTimes(1)
    expect(stored.current[0].expiry_date).toBe('2026-12-01')
    expect(stored.current[0].estimated_expiry).toBe(true)
  })

  it('a date the client did send wins over no_expiry', async () => {
    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])

    await POST(
      makeRequest({
        items: [{ name: 'Rice', category: 'dry_goods', expiry_date: '2027-01-01', no_expiry: true }],
      }),
    )

    expect(stored.current[0].expiry_date).toBe('2027-01-01')
  })
})
