/**
 * @jest-environment node
 *
 * Issue #642 — the `/api/ai/scan` proxy must hand the client a known code
 * however the AI service misbehaves: a non-JSON body (an HTML 502 from the
 * platform), a 5xx, a 429, or the upstream fetch throwing outright (service
 * down). Before this, `await res.json()` / the bare `fetch` threw, Next
 * answered with its own HTML 500, and the client had nothing to map.
 */
import { POST } from '@/app/api/ai/scan/route'

const mockAiProxyFetch = jest.fn()
jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyFetch: (...args: unknown[]) => mockAiProxyFetch(...args),
}))

function scanRequest(): Request {
  const form = new FormData()
  form.append('file', new File(['x'], 'receipt.png', { type: 'image/png' }))
  return new Request('http://localhost/api/ai/scan', { method: 'POST', body: form })
}

afterEach(() => jest.clearAllMocks())

it('an upstream non-JSON 502 body becomes a JSON error with a known code', async () => {
  mockAiProxyFetch.mockResolvedValue(
    new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
  )
  const res = await POST(scanRequest())
  expect(res.status).toBe(502)
  const body = await res.json()
  expect(body.code).toBe('vision_provider_unavailable')
  expect(JSON.stringify(body)).not.toContain('<html>')
})

it('an upstream 200 with a non-JSON body is a 502 with a generic code, not a throw', async () => {
  mockAiProxyFetch.mockResolvedValue(new Response('not json', { status: 200 }))
  const res = await POST(scanRequest())
  expect(res.status).toBe(502)
  expect((await res.json()).code).toBe('scan_failed')
})

it('the upstream fetch throwing (service down) is a 503 with the provider-unavailable code', async () => {
  mockAiProxyFetch.mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:8888'))
  const res = await POST(scanRequest())
  expect(res.status).toBe(503)
  const body = await res.json()
  expect(body.code).toBe('vision_provider_unavailable')
  expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
})

it('a 429 from the AI service passes through as a 429', async () => {
  mockAiProxyFetch.mockResolvedValue(
    new Response(JSON.stringify({ detail: 'quota exceeded for gemini-3.1' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const res = await POST(scanRequest())
  expect(res.status).toBe(429)
})

it('keeps the sanitized { message, code } detail the AI service sends', async () => {
  mockAiProxyFetch.mockResolvedValue(
    new Response(JSON.stringify({ detail: { message: 'nope', code: 'unreadable_image' } }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const res = await POST(scanRequest())
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'nope', code: 'unreadable_image' })
})
