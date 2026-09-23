/**
 * @jest-environment node
 *
 * Integration-style tests for the bubbles award call sites added in issue
 * #520: each route must still return a successful response even when the
 * underlying `bubble_events` insert throws — `awardBubbles`'s own try/catch
 * (see `nextjs/src/lib/bubbles.ts`) must absorb the failure so it never
 * blocks the route's real write (pantry add, recipe save, cook confirm,
 * chat pantry apply).
 *
 * Unlike `bubbles-award.test.ts` (which exercises `awardBubbles` directly),
 * these mock only the Supabase service client the award helper builds
 * internally, so the assertion is against the real end-to-end call path
 * each route takes.
 *
 * `upsertMock` throws on every call (to prove the award never blocks the
 * response), but `jest.fn()` still records each call's arguments before it
 * throws — so every test below also asserts on `upsertMock.mock.calls` to
 * pin down which `event_type`/`ref_key` (or none at all) each route awards,
 * not just that *some* insert happened.
 */

const mockUser = { id: 'user-1' }

const upsertMock = jest.fn(() => {
  throw new Error('bubble_events insert boom')
})

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}))

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

jest.mock('@/lib/api/ai-proxy', () => ({
  estimateExpiry: jest.fn(async () => null),
  estimateCategory: jest.fn(async () => null),
  normalizeBaseUnit: jest.fn(async () => ({ quantity_base: null, unit_base: null })),
  aiProxyJson: jest.fn(async () =>
    new Response(JSON.stringify({ request_id: 'req-1', success: true, applied_count: 1 }), {
      status: 200,
    }),
  ),
}))

import { requireAuth } from '@/lib/response-helpers'

const mockRequireAuth = requireAuth as jest.Mock

describe('bubbles award never blocks the underlying write', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsertMock.mockImplementation(() => {
      throw new Error('bubble_events insert boom')
    })
  })

  it('POST /api/pantry still succeeds when the award insert throws', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'item-1', name: 'Milk', category: 'dairy', location: 'fridge' },
              error: null,
            }),
          }),
        }),
      }),
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { POST } = await import('@/app/api/pantry/route')
    const res = await POST(
      new Request('http://localhost/api/pantry', {
        method: 'POST',
        body: JSON.stringify({ name: 'Milk' }),
      }),
    )

    expect(res.status).toBe(201)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'pantry_add',
        ref_key: 'item-1',
      }),
      expect.anything(),
    )
  })

  it('POST /api/pantry/bulk still succeeds when the award insert throws', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: async () => ({
            data: [{ id: 'item-1', name: 'Eggs', category: 'dairy', location: 'fridge' }],
            error: null,
          }),
        }),
      }),
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { POST } = await import('@/app/api/pantry/bulk/route')
    const res = await POST(
      new Request('http://localhost/api/pantry/bulk', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ name: 'Eggs', source: 'scan' }],
        }),
      }),
    )

    expect(res.status).toBe(201)
    // One pantry_add per inserted row, keyed on the row id, plus one
    // scan_confirm keyed on a server-derived date+item-names digest — not on
    // anything the client sent.
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'pantry_add',
        ref_key: 'item-1',
      }),
      expect.anything(),
    )
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'scan_confirm',
        ref_key: expect.stringMatching(
          new RegExp(`^${new Date().toISOString().slice(0, 10)}:[0-9a-f]{64}$`),
        ),
      }),
      expect.anything(),
    )
    expect(upsertMock).toHaveBeenCalledTimes(2)
  })

  it('POST /api/pantry/bulk derives the same scan_confirm ref_key for the same items regardless of request body id', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: async () => ({
            data: [{ id: 'item-1', name: 'Eggs', category: 'dairy', location: 'fridge' }],
            error: null,
          }),
        }),
      }),
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { POST } = await import('@/app/api/pantry/bulk/route')

    const makeRequest = (extra: Record<string, unknown>) =>
      new Request('http://localhost/api/pantry/bulk', {
        method: 'POST',
        body: JSON.stringify({ items: [{ name: 'Eggs', source: 'scan' }], ...extra }),
      })

    type UpsertRow = { event_type: string; ref_key: string }

    await POST(makeRequest({ request_id: 'req-a' }))
    const firstRefKey = (upsertMock.mock.calls as unknown as [UpsertRow][]).find(
      (call) => call[0].event_type === 'scan_confirm',
    )?.[0].ref_key

    upsertMock.mockClear()
    await POST(makeRequest({ request_id: 'req-b' }))
    const secondRefKey = (upsertMock.mock.calls as unknown as [UpsertRow][]).find(
      (call) => call[0].event_type === 'scan_confirm',
    )?.[0].ref_key

    expect(firstRefKey).toBeDefined()
    expect(firstRefKey).toBe(secondRefKey)
  })

  it('POST /api/recipes still succeeds when the award insert throws', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'recipe-1', title: 'Soup', is_draft: false },
              error: null,
            }),
          }),
        }),
      }),
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { POST } = await import('@/app/api/recipes/route')
    const res = await POST(
      new Request('http://localhost/api/recipes', {
        method: 'POST',
        body: JSON.stringify({ title: 'Soup' }),
      }),
    )

    expect(res.status).toBe(201)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'recipe_save',
        ref_key: 'recipe-1',
      }),
      expect.anything(),
    )
  })

  it('does not award recipe_save for a draft', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'recipe-2', title: 'Draft', is_draft: true },
              error: null,
            }),
          }),
        }),
      }),
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { POST } = await import('@/app/api/recipes/route')
    const res = await POST(
      new Request('http://localhost/api/recipes', {
        method: 'POST',
        body: JSON.stringify({ title: 'Draft', is_draft: true }),
      }),
    )

    expect(res.status).toBe(201)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('POST /api/ai/recipes/cook/confirm still succeeds when the award insert throws', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { POST } = await import('@/app/api/ai/recipes/cook/confirm/route')
    const res = await POST(
      new Request('http://localhost/api/ai/recipes/cook/confirm', {
        method: 'POST',
        body: JSON.stringify({ recipe_id: 'recipe-1', deductions: [] }),
      }),
    )

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'cook_confirm',
        ref_key: `recipe-1:${new Date().toISOString().slice(0, 10)}`,
      }),
      expect.anything(),
    )
  })

  it('POST /api/ai/workflows/apply still succeeds when the award insert throws', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { POST } = await import('@/app/api/ai/workflows/apply/route')
    const res = await POST(
      new Request('http://localhost/api/ai/workflows/apply', {
        method: 'POST',
        body: JSON.stringify({
          request_id: 'req-1',
          intent: 'pantry_update',
          proposal: { actions: [{ action: 'add', name: 'Milk' }] },
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'pantry_add',
        ref_key: 'req-1:milk',
      }),
      expect.anything(),
    )
  })

  it('POST /api/ai/workflows/apply only awards "add" actions, not update/remove/use', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { POST } = await import('@/app/api/ai/workflows/apply/route')
    const res = await POST(
      new Request('http://localhost/api/ai/workflows/apply', {
        method: 'POST',
        body: JSON.stringify({
          request_id: 'req-2',
          intent: 'pantry_update',
          proposal: {
            actions: [
              { action: 'add', name: 'Milk' },
              { action: 'update', name: 'Cheese' },
              { action: 'remove', name: 'Eggs' },
              { action: 'use', name: 'Butter' },
            ],
          },
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'pantry_add',
        ref_key: 'req-2:milk',
      }),
      expect.anything(),
    )
  })

  it('PUT /api/recipes/[id] still succeeds when the award insert throws, on draft promotion', async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'recipe-3', title: 'Soup', is_draft: false },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { PUT } = await import('@/app/api/recipes/[id]/route')
    const res = await PUT(
      new Request('http://localhost/api/recipes/recipe-3', {
        method: 'PUT',
        body: JSON.stringify({ is_draft: false }),
      }),
      { params: Promise.resolve({ id: 'recipe-3' }) },
    )

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        event_type: 'recipe_save',
        ref_key: 'recipe-3',
      }),
      expect.anything(),
    )
  })

  it('POST /api/ai/workflows/apply does not award for a recipe_card intent', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { POST } = await import('@/app/api/ai/workflows/apply/route')
    const res = await POST(
      new Request('http://localhost/api/ai/workflows/apply', {
        method: 'POST',
        body: JSON.stringify({
          request_id: 'req-1',
          intent: 'recipe_card',
          proposal: { title: 'Soup' },
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
