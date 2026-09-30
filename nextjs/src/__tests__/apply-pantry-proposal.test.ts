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
    auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'test-token' } } })) },
  }),
}))

import { applyPantryProposal, rejectPantryProposal } from '@/lib/api/chat'
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

// ─── 7. A unit-mismatch refusal narrows failedActions to that one action ──────
//
// Issue #677: the AI service refuses a `use` whose unit can't be converted to
// the row's ("Units don't match (handful vs g), edit the unit for: spinach").
// The retry parser takes the name after the first ": ", so failedActions must
// be exactly the spinach action, and the eggs that applied must not be resent.

it('a unit-mismatch error narrows failedActions to exactly that action', async () => {
  mockFetch(true, {
    success: false,
    applied_count: 1,
    failed_count: 1,
    errors: ["Units don't match (handful vs g), edit the unit for: spinach"],
  })

  const eggs: PantryProposalAction = {
    action_type: 'use',
    item: { name: 'eggs', quantity: 2, unit: 'item' },
    confidence: 0.9,
  }
  const spinach: PantryProposalAction = {
    action_type: 'use',
    item: { name: 'Spinach', quantity: 1, unit: 'handful' },
    confidence: 0.9,
  }

  const result = await applyPantryProposal('req-4', [eggs, spinach])

  expect(result.success).toBe(false)
  expect(result.failedActions).toEqual([spinach])
})

// ─── 8. Name matching uses the same trimmed key on both sides ─────────────────

it('an action name with surrounding whitespace is still narrowed to the failed action', async () => {
  mockFetch(true, {
    success: false,
    applied_count: 1,
    failed_count: 1,
    errors: ["Units don't match (handful vs g), edit the unit for: Spinach"],
  })

  const eggs: PantryProposalAction = {
    action_type: 'use',
    item: { name: 'eggs', quantity: 2, unit: 'item' },
    confidence: 0.9,
  }
  const spinach: PantryProposalAction = {
    action_type: 'use',
    item: { name: '  Spinach ', quantity: 1, unit: 'handful' },
    confidence: 0.9,
  }

  const result = await applyPantryProposal('req-5', [eggs, spinach])
  expect(result.failedActions).toEqual([spinach])
})

// ─── 9. A non-string error body never renders as "[object Object]" ────────────

describe('non-2xx error bodies become readable messages', () => {
  const cases: Array<[string, unknown, string]> = [
    ['a string error as-is', { error: 'Session expired' }, 'Session expired'],
    [
      'top-level FastAPI detail[0].msg',
      { detail: [{ msg: 'field required', loc: ['body', 'proposal'] }] },
      'field required',
    ],
    [
      'detail[0].msg nested under error',
      { error: { detail: [{ msg: 'value is not a valid list' }] } },
      'value is not a valid list',
    ],
    ['a string detail', { detail: 'Not authenticated' }, 'Not authenticated'],
    ['an object error with nothing readable', { error: { code: 42 } }, "Couldn't update your pantry"],
    ['an empty body', {}, "Couldn't update your pantry"],
  ]

  it.each(cases)('%s', async (_label, body, expected) => {
    mockFetch(false, body)
    await expect(applyPantryProposal('req-6', makeActions())).rejects.toThrow(
      new Error(expected),
    )
  })
})

// ─── 10. Issue #444: the review fields ride along only when given (F15) ───────

describe('server-side proposal review fields (#444)', () => {
  const OK_BODY = { success: true, applied_count: 1, failed_count: 0, errors: [] }
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'

  it('F15: the body carries conversation_id and turn_request_ids when a review is given', async () => {
    const mock = mockFetch(true, OK_BODY)
    await applyPantryProposal('req-7', makeActions(), { conversationId: 'conv-1', turnRequestIds: [A, B] })
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.request_id).toBe('req-7')
    expect(body.conversation_id).toBe('conv-1')
    expect(body.turn_request_ids).toEqual([A, B])
  })

  it('F15: the body omits both fields when no review is given (scan-style and old callers)', async () => {
    const mock = mockFetch(true, OK_BODY)
    await applyPantryProposal('req-8', makeActions())
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('conversation_id')
    expect(body).not.toHaveProperty('turn_request_ids')
  })

  it('F16: failed_names takes precedence over the error-string regex', async () => {
    // "Error processing {…}" carries no parseable ": name" tail that matches a
    // row, so the regex path would leave failedActions undefined.
    mockFetch(true, {
      success: false,
      applied_count: 1,
      failed_count: 1,
      errors: ["Error processing {'action': 'use'}: boom"],
      failed_names: ['spinach'],
    })
    const eggs: PantryProposalAction = {
      action_type: 'use',
      item: { name: 'eggs', quantity: 2, unit: 'item' },
      confidence: 0.9,
    }
    const spinach: PantryProposalAction = {
      action_type: 'use',
      item: { name: ' Spinach ', quantity: 1, unit: 'handful' },
      confidence: 0.9,
    }
    const result = await applyPantryProposal('req-9', [eggs, spinach])
    expect(result.failedActions).toEqual([spinach])
  })

  it('F16: with an older backend (no failed_names) the regex path still narrows', async () => {
    mockFetch(true, {
      success: false,
      applied_count: 1,
      failed_count: 1,
      errors: ['Item not found: spinach'],
    })
    const eggs = makeActions()[0]
    const spinach: PantryProposalAction = { ...eggs, item: { name: 'spinach', quantity: 1 } }
    const result = await applyPantryProposal('req-10', [eggs, spinach])
    expect(result.failedActions).toEqual([spinach])
  })
})

// ─── 11. Issue #444: the reject route ────────────────────────────────────────

describe('rejectPantryProposal (#444)', () => {
  const A = '11111111-1111-4111-8111-111111111111'

  it('POSTs {conversation_id, turn_request_ids} to the AI service reject route with a Bearer token', async () => {
    const mock = mockFetch(true, { recorded_turn_request_ids: [A] })
    await rejectPantryProposal('conv-1', [A])
    const [url, init] = mock.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/workflows\/reject$/)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body as string)).toEqual({
      conversation_id: 'conv-1',
      turn_request_ids: [A],
    })
  })

  it('throws on a non-2xx response', async () => {
    mockFetch(false, { detail: 'nope' })
    await expect(rejectPantryProposal('conv-1', [A])).rejects.toThrow()
  })
})
