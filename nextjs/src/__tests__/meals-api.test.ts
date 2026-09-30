/**
 * Issue #654 §4 (S1, Nit 4) — `lib/api/meals.ts`'s error-detail plumbing:
 * `aiErrorDetail`, the two meal cook clients throwing `MealCookError`, and
 * `aiErrorMessage`'s pre-#654 callers staying unchanged now that they
 * delegate to it.
 */

import {
  fetchSideAlternatives,
  requestMealCookProposal,
  confirmMealCook,
  deleteMeal,
  MealCookError,
} from '@/lib/api/meals'
import type { MealCookRequest, MealCookConfirmRequest } from '@/types/meals'
import { clientTimeZone } from '@/lib/date'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

const fetchMock = jest.fn()

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('aiErrorDetail (via the meal cook clients)', () => {
  const req: MealCookRequest = { meal_id: 'meal-1', servings: 4, dishes: [] }

  it('reads a structured detail.message and detail.error_kind', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: { error_kind: 'dish_mismatch', message: 'This meal changed.' } }, false, 409),
    )
    await expect(requestMealCookProposal(req)).rejects.toMatchObject({
      message: 'This meal changed.',
      kind: 'dish_mismatch',
    })
  })

  it.each(['dish_mismatch', 'confirm_in_progress', 'confirm_incomplete'] as const)(
    'passes through error_kind %s',
    async (kind) => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: { error_kind: kind, message: 'x' } }, false, 409))
      try {
        await requestMealCookProposal(req)
        throw new Error('expected requestMealCookProposal to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(MealCookError)
        expect((err as MealCookError).kind).toBe(kind)
      }
    },
  )

  it('gives no kind for an unrecognized error_kind', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: { error_kind: 'something_else', message: 'x' } }, false, 500),
    )
    try {
      await requestMealCookProposal(req)
      throw new Error('expected throw')
    } catch (err) {
      expect((err as MealCookError).kind).toBeUndefined()
    }
  })

  it('a plain string detail (FastAPI 404) is the message, with no kind', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Meal not found' }, false, 404))
    try {
      await requestMealCookProposal(req)
      throw new Error('expected throw')
    } catch (err) {
      expect((err as MealCookError).message).toBe('Meal not found')
      expect((err as MealCookError).kind).toBeUndefined()
    }
  })

  it('a 500 with no JSON body gives the fallback message and no kind', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)
    try {
      await requestMealCookProposal(req)
      throw new Error('expected throw')
    } catch (err) {
      expect((err as MealCookError).message).toContain('500')
      expect((err as MealCookError).kind).toBeUndefined()
    }
  })

  it('a network rejection surfaces with no kind (not a MealCookError)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(requestMealCookProposal(req)).rejects.toThrow('network down')
  })

  it('the body is read exactly once even though json() is only callable once on a real Response', async () => {
    let calls = 0
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => {
        calls += 1
        if (calls > 1) throw new Error('body already consumed')
        return { detail: { error_kind: 'confirm_incomplete', message: 'Check your pantry.' } }
      },
    } as Response)

    await expect(requestMealCookProposal(req)).rejects.toMatchObject({
      message: 'Check your pantry.',
      kind: 'confirm_incomplete',
    })
    expect(calls).toBe(1)
  })
})

describe('confirmMealCook', () => {
  const req: MealCookConfirmRequest = {
    meal_id: 'meal-1',
    cook_ref: 'abc123',
    recipe_ids: ['r1'],
    deductions: [],
  }

  it('resolves with the parsed response on success', async () => {
    const body = {
      success: true,
      already_confirmed: false,
      deductions_applied: 1,
      deductions_requested: 1,
      deductions_skipped: [],
      recipes_marked_cooked: ['r1'],
      meal_times_cooked: 1,
      cooked_on: '2026-09-29',
    }
    fetchMock.mockResolvedValue(jsonResponse(body))
    await expect(confirmMealCook(req)).resolves.toEqual(body)
  })

  it('sends the IANA zone, not a date, for the proxy to key awards on (#550)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, cooked_on: '2026-09-29' }))

    await confirmMealCook(req)

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent).toEqual({ ...req, tz: clientTimeZone() })
    expect(sent).not.toHaveProperty('date')
  })

  it('throws MealCookError with the confirm_in_progress kind on a 409', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { detail: { error_kind: 'confirm_in_progress', message: 'This cook is still being saved.' } },
        false,
        409,
      ),
    )
    await expect(confirmMealCook(req)).rejects.toMatchObject({ kind: 'confirm_in_progress' })
  })
})

describe("aiErrorMessage's pre-#654 callers stay unchanged (S1)", () => {
  it("fetchSideAlternatives' error message is unchanged now that aiErrorMessage delegates to aiErrorDetail", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: { error_kind: 'model_unavailable', message: 'The AI service is unavailable.' } }, false, 502),
    )
    await expect(fetchSideAlternatives({ meal_id: 'meal-1' })).rejects.toThrow(
      'The AI service is unavailable.',
    )
  })

  it("fetchSideAlternatives' error is a plain Error, not a MealCookError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 500))
    try {
      await fetchSideAlternatives({ meal_id: 'meal-1' })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).not.toBeInstanceOf(MealCookError)
    }
  })
})

describe('deleteMeal (issue #675)', () => {
  it('sends DELETE to the meal route and resolves on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }))

    await expect(deleteMeal('meal 1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith('/api/meals/meal%201', { method: 'DELETE' })
  })

  it('throws the server message on a non-OK response (a missing meal is a 404)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Meal not found' }, false, 404))

    await expect(deleteMeal('gone')).rejects.toThrow('Meal not found')
  })
})
