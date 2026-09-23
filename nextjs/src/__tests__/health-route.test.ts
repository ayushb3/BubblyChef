/**
 * @jest-environment node
 *
 * Tests for `app/api/health/route.ts` — unauthenticated smoke-test endpoint
 * that reports the deployed git commit SHA (step 3(e) of
 * docs/plans/2026-09-17-autonomous-agent-loop.md).
 */
import { GET } from '@/app/api/health/route'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.VERCEL_GIT_COMMIT_SHA
  delete process.env.NEXT_PUBLIC_GIT_SHA
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('GET /api/health', () => {
  it('returns 200 with the Vercel-injected commit SHA when present', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234'

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.sha).toBe('abc1234')
    expect(typeof body.env).toBe('string')
    expect(typeof body.deployedAt).toBe('string')
  })

  it('falls back to NEXT_PUBLIC_GIT_SHA when VERCEL_GIT_COMMIT_SHA is absent', async () => {
    process.env.NEXT_PUBLIC_GIT_SHA = 'def5678'

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sha).toBe('def5678')
  })

  it('returns "unknown" (still 200) when no SHA env var is set', async () => {
    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.sha).toBe('unknown')
    expect(body.deployedAt).toBeUndefined()
  })
})
