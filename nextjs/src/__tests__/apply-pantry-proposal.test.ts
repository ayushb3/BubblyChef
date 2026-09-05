/**
 * Unit tests for the REAL `applyPantryProposal` from `@/lib/api/chat`.
 *
 * The existing `chat-proposal-apply.test.tsx` mocks the entire `@/lib/api/chat`
 * module (including `applyPantryProposal` itself), so it cannot catch regressions
 * in the function's own implementation — wrong URL, missing `.ok` check, bad
 * payload shape, etc.
 *
 * These tests exercise the real function with a mocked global `fetch`, so every
 * assertion is against the real call path.
 *
 * Shape reference: `ai-service/bubbly_chef/repository/supabase_repo.py:173-283`
 * The repository reads flat action objects with keys `action`, `name`, `quantity`,
 * `unit`, `category`, `location` — NOT the nested `{ action_type, item }` shape
 * that `PantryProposalAction` uses internally. `applyPantryProposal` is responsible
 * for the mapping.
 */

// Supabase client is used only for auth token retrieval inside `aiFetch`, but
// `applyPantryProposal` goes through the Next.js proxy (plain `fetch`, no auth
// header), so we only need to silence the import-time module resolution.
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: jest.fn(async () => ({ data: { session: null } })) },
  }),
}))

import { applyPantryProposal } from '@/lib/api/chat'
import type { PantryProposalAction } from '@/types/chat'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeActions(overrides: Partial<PantryProposalAction> = {}): PantryProposalAction[] {
  return [
    {
      action_type: 'add',
      item: {
        name: 'Milk',
        quantity: 1,
        unit: 'gallon',
        category: 'dairy',
        storage_location: 'fridge',
      },
      confidence: 0.95,
      ...overrides,
    },
  ]
}

function mockFetch(ok: boolean, body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: jest.fn().mockResolvedValue(body),
  })
  global.fetch = mock
  return mock
}

afterEach(() => {
  jest.restoreAllMocks()
})

// ─── 1. Correct URL ───────────────────────────────────────────────────────────

it('POSTs to /api/ai/workflows/apply', async () => {
  const mock = mockFetch(true, { success: true, applied_count: 1, failed_count: 0, errors: [] })
  await applyPantryProposal('req-1', makeActions())
  expect(mock).toHaveBeenCalledTimes(1)
  const [url] = mock.mock.calls[0]
  expect(url).toBe('/api/ai/workflows/apply')
})

// ─── 2. 404 response must throw (the original bug) ───────────────────────────
//
// `fetch` itself does NOT throw on a 4xx response — it resolves with
// `{ ok: false }`. The original bug was the dead-route call ignored this, so
// every approval silently succeeded. The `.ok` check must turn a 404 into a
// thrown error so the caller can surface it.

it('{ok: false, status: 404} throws rather than returning a success result', async () => {
  mockFetch(false, { error: 'Not found' })
  await expect(applyPantryProposal('req-1', makeActions())).rejects.toThrow()
})

// ─── 3. ok:true + success:false returns a non-success result without throwing ─

it('{ok: true, body: {success: false, errors: [...]}} returns non-success without throwing', async () => {
  mockFetch(true, {
    success: false,
    applied_count: 0,
    failed_count: 1,
    errors: ['Item not found: Milk'],
  })
  const result = await applyPantryProposal('req-1', makeActions())
  expect(result.success).toBe(false)
  expect(result.errors).toContain('Item not found: Milk')
})

// ─── 4. ok:true + success:true returns success ───────────────────────────────

it('{ok: true, body: {success: true}} returns a success result', async () => {
  mockFetch(true, { success: true, applied_count: 1, failed_count: 0, errors: [] })
  const result = await applyPantryProposal('req-1', makeActions())
  expect(result.success).toBe(true)
  expect(result.appliedCount).toBe(1)
  expect(result.failedCount).toBe(0)
  expect(result.errors).toHaveLength(0)
})

// ─── 5. Payload shape matches what the repository reads ──────────────────────
//
// The repository (`supabase_repo.py:173-283`) reads flat action objects with
// these keys: `action`, `name`, `quantity`, `unit`, `category`, `location`.
// `applyPantryProposal` receives the nested `PantryProposalAction` shape and
// must flatten it. Crucially, the action key MUST be `action`, not `action_type`.
// A `remove` or `use` action sent as `action_type` silently defaults to `add`
// (`action.get("action", "add")`), corrupting the pantry silently.

it('maps PantryProposalAction to the flat shape the repository reads', async () => {
  const mock = mockFetch(true, { success: true, applied_count: 1, failed_count: 0, errors: [] })

  const actions: PantryProposalAction[] = [
    {
      action_type: 'remove',
      item: {
        name: 'Expired Yogurt',
        quantity: 2,
        unit: 'cup',
        category: 'dairy',
        storage_location: 'fridge',
      },
      confidence: 0.9,
    },
  ]

  await applyPantryProposal('req-2', actions)

  const body = JSON.parse(mock.mock.calls[0][1].body as string)
  const sentAction = body.proposal.actions[0]

  // The repository reads `action`, not `action_type`
  expect(sentAction).toHaveProperty('action', 'remove')
  expect(sentAction).not.toHaveProperty('action_type')

  // All other flat fields the repository reads must be present
  expect(sentAction).toHaveProperty('name', 'Expired Yogurt')
  expect(sentAction).toHaveProperty('quantity', 2)
  expect(sentAction).toHaveProperty('unit', 'cup')
  expect(sentAction).toHaveProperty('category', 'dairy')
  expect(sentAction).toHaveProperty('location', 'fridge')

  // The nested `item` object must not appear — the repo reads flat, not nested
  expect(sentAction).not.toHaveProperty('item')
})

// ─── 6. `use` action survives round-trip as `use`, not silently as `add` ─────

it('a `use` action arrives at the repository as `use`, not `add`', async () => {
  const mock = mockFetch(true, { success: true, applied_count: 1, failed_count: 0, errors: [] })

  const actions: PantryProposalAction[] = [
    {
      action_type: 'use',
      item: {
        name: 'Butter',
        quantity: 1,
        unit: 'tbsp',
        category: 'dairy',
        storage_location: 'fridge',
      },
      confidence: 0.88,
    },
  ]

  await applyPantryProposal('req-3', actions)

  const body = JSON.parse(mock.mock.calls[0][1].body as string)
  expect(body.proposal.actions[0].action).toBe('use')
})
