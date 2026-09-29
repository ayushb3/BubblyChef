/**
 * @jest-environment node
 *
 * Route tests for the two meal-screen AI proxies (issue #652 / spec #647):
 * `POST /api/ai/meals/side-alternatives` and `POST /api/ai/meals/
 * expand-dish`. Both are verbatim passthroughs to the AI service, following
 * `app/api/ai/recipes/[id]/steps/ensure` — this pins that they forward the
 * body and return the upstream status/JSON unchanged on both success and
 * failure, same as `dashboard-daily-route.test.ts` does for its proxy.
 */
import { POST as sideAlternativesPOST } from '@/app/api/ai/meals/side-alternatives/route'
import { POST as expandDishPOST } from '@/app/api/ai/meals/expand-dish/route'

const mockAiProxyFetch = jest.fn()
jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyFetch: (...args: unknown[]) => mockAiProxyFetch(...args),
}))

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/ai/meals/side-alternatives proxy', () => {
  it('forwards the body to /v1/meals/side-alternatives and returns the alternatives verbatim', async () => {
    const upstreamBody = {
      alternatives: [
        {
          role: 'side',
          name: 'Charred broccolini',
          blurb: 'Smoky, 10 minutes, uses the lemon.',
          key_ingredients: ['broccolini', 'lemon'],
          est_total_minutes: 12,
          est_hands_on_minutes: 6,
        },
      ],
    }
    mockAiProxyFetch.mockResolvedValue(jsonResponse(upstreamBody))

    const res = await sideAlternativesPOST(
      postRequest('http://localhost/api/ai/meals/side-alternatives', { meal_id: 'm1', position: 1 }),
    )
    const body = await res.json()

    expect(mockAiProxyFetch).toHaveBeenCalledTimes(1)
    const [path, init] = mockAiProxyFetch.mock.calls[0]
    expect(path).toBe('/v1/meals/side-alternatives')
    expect(JSON.parse(init.body)).toEqual({ meal_id: 'm1', position: 1 })
    expect(res.status).toBe(200)
    expect(body).toEqual(upstreamBody)
  })

  it('surfaces a 404 (unknown meal) with the same status and body', async () => {
    mockAiProxyFetch.mockResolvedValue(jsonResponse({ error: 'Meal not found' }, false, 404))

    const res = await sideAlternativesPOST(
      postRequest('http://localhost/api/ai/meals/side-alternatives', { meal_id: 'missing' }),
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Meal not found' })
  })

  it('surfaces a 502 model failure with its detail shape intact', async () => {
    const detail = { detail: { error_kind: 'model_unavailable', message: 'The AI service is unavailable.' } }
    mockAiProxyFetch.mockResolvedValue(jsonResponse(detail, false, 502))

    const res = await sideAlternativesPOST(
      postRequest('http://localhost/api/ai/meals/side-alternatives', { meal_id: 'm1', position: 1 }),
    )

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual(detail)
  })

  it('returns the 401 straight through when there is no session', async () => {
    const { NextResponse } = jest.requireActual('next/server')
    mockAiProxyFetch.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    const res = await sideAlternativesPOST(
      postRequest('http://localhost/api/ai/meals/side-alternatives', { meal_id: 'm1' }),
    )

    expect(res.status).toBe(401)
  })
})

describe('POST /api/ai/meals/expand-dish proxy', () => {
  it('forwards the body to /v1/meals/expand-dish and returns the expanded dish verbatim', async () => {
    const upstreamBody = {
      proposal_type: 'meal_dish',
      role: 'side',
      position: 1,
      recipe: { title: 'Charred broccolini', instructions: ['Char it'], steps: null, servings: 2 },
    }
    mockAiProxyFetch.mockResolvedValue(jsonResponse(upstreamBody))

    const outline = {
      role: 'side',
      name: 'Charred broccolini',
      key_ingredients: ['broccolini'],
      est_total_minutes: 12,
      est_hands_on_minutes: 6,
    }
    const res = await expandDishPOST(
      postRequest('http://localhost/api/ai/meals/expand-dish', { meal_id: 'm1', position: 1, outline }),
    )
    const body = await res.json()

    expect(mockAiProxyFetch).toHaveBeenCalledTimes(1)
    const [path, init] = mockAiProxyFetch.mock.calls[0]
    expect(path).toBe('/v1/meals/expand-dish')
    expect(JSON.parse(init.body)).toEqual({ meal_id: 'm1', position: 1, outline })
    expect(res.status).toBe(200)
    expect(body).toEqual(upstreamBody)
  })

  it('surfaces a 502 model failure with its detail shape intact', async () => {
    const detail = { detail: { error_kind: 'invalid_structured_output', message: 'Could not build that dish.' } }
    mockAiProxyFetch.mockResolvedValue(jsonResponse(detail, false, 502))

    const res = await expandDishPOST(
      postRequest('http://localhost/api/ai/meals/expand-dish', {
        meal_id: 'm1',
        position: 1,
        outline: { role: 'side', name: 'X', key_ingredients: [], est_total_minutes: null, est_hands_on_minutes: null },
      }),
    )

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual(detail)
  })
})
