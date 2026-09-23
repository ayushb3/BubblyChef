/**
 * @jest-environment node
 *
 * Test for `POST /api/pantry` (issue #363: the manual "type it in" pantry-add
 * path guesses an expiry via the heuristic but never flags it as estimated).
 *
 * Precedence mirrors `apply_pantry_proposal` in
 * `ai-service/bubbly_chef/repository/supabase_repo.py`: a caller-supplied date
 * is authoritative and is never flagged; a date we guessed is. No date at all
 * is not an estimate, so the flag stays false rather than marking an empty
 * column as a guess.
 */
import { POST } from '@/app/api/pantry/route'

const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))

jest.mock('@/lib/pantry-helpers', () => ({
  enrichPantryItem: (row: Record<string, unknown>) => row,
  buildPantryListResponse: (items: unknown) => ({ items }),
}))

jest.mock('@/lib/api/ai-proxy', () => ({
  estimateExpiry: jest.fn(),
  estimateCategory: jest.fn(),
  normalizeBaseUnit: jest.fn(),
}))

import { requireAuth } from '@/lib/response-helpers'
import { estimateExpiry, estimateCategory, normalizeBaseUnit } from '@/lib/api/ai-proxy'

function makeSupabaseMock(storedInsert: { current: Record<string, unknown> }) {
  return {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        storedInsert.current = payload
        return {
          select: () => ({
            single: async () => ({ data: { id: 'item-1', ...payload }, error: null }),
          }),
        }
      },
    }),
  }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/pantry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  ;(estimateCategory as jest.Mock).mockResolvedValue('dairy')
  ;(normalizeBaseUnit as jest.Mock).mockResolvedValue({
    quantity_base: null,
    unit_base: null,
  })
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/pantry estimated_expiry flagging (#363)', () => {
  it('flags estimated_expiry when the date came from the heuristic, not the user', async () => {
    const storedInsert = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedInsert), mockUser])
    ;(estimateExpiry as jest.Mock).mockResolvedValue('2026-10-01')

    const res = await POST(makeRequest({ name: 'Milk' }))
    const body = await res.json()

    expect(storedInsert.current.expiry_date).toBe('2026-10-01')
    expect(storedInsert.current.estimated_expiry).toBe(true)
    expect(body.estimated_expiry).toBe(true)
  })

  it('does not flag a date the caller supplied, and does not consult the heuristic', async () => {
    const storedInsert = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedInsert), mockUser])

    const res = await POST(makeRequest({ name: 'Milk', expiry_date: '2026-12-25' }))
    const body = await res.json()

    expect(storedInsert.current.expiry_date).toBe('2026-12-25')
    expect(storedInsert.current.estimated_expiry).toBe(false)
    expect(body.estimated_expiry).toBe(false)
    expect(estimateExpiry).not.toHaveBeenCalled()
  })

  it('does not flag an absent date when the heuristic yields nothing', async () => {
    const storedInsert = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedInsert), mockUser])
    ;(estimateExpiry as jest.Mock).mockResolvedValue(null)

    await POST(makeRequest({ name: 'Salt' }))

    expect(storedInsert.current.expiry_date).toBeNull()
    expect(storedInsert.current.estimated_expiry).toBe(false)
  })

  it('#363/#439: a server-guessed date is still flagged estimated even when the client sends estimated_expiry: false with no date (Type tab blank-date row)', async () => {
    const storedInsert = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedInsert), mockUser])
    ;(estimateExpiry as jest.Mock).mockResolvedValue('2026-10-01')

    const res = await POST(makeRequest({ name: 'Milk', estimated_expiry: false }))
    const body = await res.json()

    expect(storedInsert.current.expiry_date).toBe('2026-10-01')
    expect(storedInsert.current.estimated_expiry).toBe(true)
    expect(body.estimated_expiry).toBe(true)
  })
})
