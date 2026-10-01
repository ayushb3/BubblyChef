/**
 * Issues #489 + #490 — the two API-client seams:
 *
 * - `cookRecipe(recipeId, ingredients?)` sends the amended list as the
 *   `ingredients` override `POST /v1/recipes/cook` now takes, so the deduction
 *   is matched against what was cooked, not the stored row;
 * - `applyCookAmendment(...)` confirms a chat amendment card through the same
 *   `POST /api/ai/workflows/apply` proxy pantry proposals use, with the new
 *   `recipe_amendment` intent, and records the dismissal on the turn through
 *   the existing `rejectPantryProposal`.
 */
import { cookRecipe } from '@/lib/api/recipes'
import { applyCookAmendment } from '@/lib/api/chat'
import type { RecipeAmendmentProposal } from '@/types/chat'

const fetchMock = jest.fn()

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  jest.clearAllMocks()
})

const ROUX = [
  { name: 'butter', quantity: 30, unit: 'g' },
  { name: 'flour', quantity: 30, unit: 'g' },
]

describe('cookRecipe', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ matches: [] }) })
  })

  it('sends only the recipe id when nothing was amended (unchanged wire shape)', async () => {
    await cookRecipe('r1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ recipe_id: 'r1' })
  })

  it('sends the amended list as `ingredients` when one is passed', async () => {
    await cookRecipe('r1', ROUX)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ai/recipes/cook')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      recipe_id: 'r1',
      ingredients: ROUX,
    })
  })

  it('treats an empty or null override as no override', async () => {
    await cookRecipe('r1', [])
    await cookRecipe('r1', null)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ recipe_id: 'r1' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ recipe_id: 'r1' })
  })
})

const PROPOSAL: RecipeAmendmentProposal = {
  proposal_type: 'recipe_amendment',
  is_amendment: true,
  amended_ingredients: [
    { name: 'butter', quantity: 30, unit: 'g', optional: false, notes: null },
  ],
  change_summary: 'Roux.',
  recipe_id: 'r1',
  recipe_title: 'Creamy pasta',
}

describe('applyCookAmendment', () => {
  it('posts the typed proposal with the conversation and its own turn id', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    await applyCookAmendment({ conversationId: 'conv-1', requestId: 'req-1', proposal: PROPOSAL })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/ai/workflows/apply')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      request_id: 'req-1',
      intent: 'recipe_amendment',
      conversation_id: 'conv-1',
      turn_request_ids: ['req-1'],
      proposal: PROPOSAL,
    })
  })

  it('throws the server message on a 409 (not cooking that recipe) so the card can fail closed', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Conversation is not cooking recipe r1' }),
    })
    await expect(
      applyCookAmendment({ conversationId: 'conv-1', requestId: 'req-1', proposal: PROPOSAL }),
    ).rejects.toThrow('Conversation is not cooking recipe r1')
  })

  it('throws when the service answers success: false', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: false }) })
    await expect(
      applyCookAmendment({ conversationId: 'conv-1', requestId: 'req-1', proposal: PROPOSAL }),
    ).rejects.toThrow()
  })
})
