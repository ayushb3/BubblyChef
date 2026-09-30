/**
 * @jest-environment node
 *
 * Issue #497 (Spec B.5): `POST /api/ai/grocery/meal-to-buy`, the thin proxy to
 * the AI service's read-only meal to-buy computation.
 */

const mockAiProxyFetch = jest.fn()
jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyFetch: (...args: unknown[]) => mockAiProxyFetch(...args),
}))

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/ai/grocery/meal-to-buy/route'

const post = (body: unknown) =>
  new Request('http://test/api/ai/grocery/meal-to-buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => mockAiProxyFetch.mockReset())

describe('POST /api/ai/grocery/meal-to-buy', () => {
  it('forwards the body to /v1/grocery/meal-to-buy and passes the response through', async () => {
    mockAiProxyFetch.mockResolvedValue(
      new Response(JSON.stringify({ to_buy: ['basil'] }), { status: 200 })
    )
    const res = await POST(post({ meal_id: 'm1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ to_buy: ['basil'] })
    expect(mockAiProxyFetch).toHaveBeenCalledWith(
      '/v1/grocery/meal-to-buy',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ meal_id: 'm1' }) })
    )
  })

  it('passes a 404 (a meal that is not the caller\'s) straight through', async () => {
    mockAiProxyFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Meal not found' }), { status: 404 })
    )
    const res = await POST(post({ meal_id: 'nope' }))
    expect(res.status).toBe(404)
    expect((await res.json()).detail).toBe('Meal not found')
  })

  it('returns the 401 when there is no session', async () => {
    mockAiProxyFetch.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await POST(post({ meal_id: 'm1' }))).status).toBe(401)
  })
})
