/**
 * @jest-environment node
 *
 * Issue #784: `POST /api/ai/pantry/match-ingredients`, the thin proxy to the AI
 * service's deterministic ingredient-to-pantry match.
 */

const mockAiProxyFetch = jest.fn()
jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyFetch: (...args: unknown[]) => mockAiProxyFetch(...args),
}))

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/ai/pantry/match-ingredients/route'

const post = (body: unknown) =>
  new Request('http://test/api/ai/pantry/match-ingredients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => mockAiProxyFetch.mockReset())

describe('POST /api/ai/pantry/match-ingredients', () => {
  it('forwards the body to /v1/pantry/match-ingredients and passes the response through', async () => {
    const body = { ingredients: [{ name: 'flour', quantity: 200, unit: 'g' }] }
    mockAiProxyFetch.mockResolvedValue(
      new Response(JSON.stringify({ matches: [{ name: 'flour', status: 'have' }] }), { status: 200 })
    )
    const res = await POST(post(body))
    expect(res.status).toBe(200)
    expect((await res.json()).matches[0].status).toBe('have')
    expect(mockAiProxyFetch).toHaveBeenCalledWith(
      '/v1/pantry/match-ingredients',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) })
    )
  })

  it('passes an AI-service error status straight through', async () => {
    mockAiProxyFetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'x' }), { status: 422 }))
    expect((await POST(post({ ingredients: 'nope' }))).status).toBe(422)
  })

  it('returns the 401 when there is no session', async () => {
    mockAiProxyFetch.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await POST(post({ ingredients: [] }))).status).toBe(401)
  })
})
