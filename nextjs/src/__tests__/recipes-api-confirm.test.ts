/**
 * Issue #621 — `confirmCook` returns the server's response (including
 * `deductions_skipped`) instead of discarding it, and never throws on a 2xx
 * with an unreadable body.
 */

import { confirmCook } from '@/lib/api/recipes'

const fetchMock = jest.fn()

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.clearAllMocks()
})

const deductions = [{ pantry_item_id: 'p-butter', deduct_qty: 1, base_unit: 'count' }]

describe('confirmCook', () => {
  it('resolves to the body, including deductions_skipped', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        deductions_applied: 1,
        deductions_requested: 2,
        deductions_skipped: ['p-butter'],
      }),
    })
    await expect(confirmCook('r1', deductions)).resolves.toEqual({
      success: true,
      deductions_applied: 1,
      deductions_requested: 2,
      deductions_skipped: ['p-butter'],
    })
  })

  it('a 200 with a non-JSON body resolves deductions_skipped: [] and does not throw', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    const res = await confirmCook('r1', deductions)
    expect(res.deductions_skipped).toEqual([])
  })

  it('coerces a malformed deductions_skipped to a string array', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deductions_skipped: 'nope' }),
    })
    expect((await confirmCook('r1', deductions)).deductions_skipped).toEqual([])

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deductions_skipped: ['a', 3, null, 'b'] }),
    })
    expect((await confirmCook('r1', deductions)).deductions_skipped).toEqual(['a', 'b'])
  })

  it('a 500 still throws', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    })
    await expect(confirmCook('r1', deductions)).rejects.toThrow('boom')
  })
})
