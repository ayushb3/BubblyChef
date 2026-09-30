/**
 * Recipe AI client — calls the Next.js proxy routes.
 *
 * Recipe generation/refinement is non-streaming, so it goes through
 * the proxy for auth forwarding.
 */

import type { Recipe } from '@/components/recipes/RecipePage'
import type {
  RecipeConstraints,
  GenerateRecipeResponse,
  RefineRecipeRequest,
  CookProposal,
  CookConfirmResponse,
  DeductionItem,
  EnsureStepsResponse,
} from '@/types/recipes'
import type { MealCookIngredient } from '@/types/meals'
import { clientTimeZone } from '@/lib/date'

/**
 * Fetch a single saved recipe by id (Next.js CRUD route, not the AI service).
 */
export async function fetchRecipe(recipeId: string): Promise<Recipe> {
  const res = await fetch(`/api/recipes/${recipeId}`)

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Recipe fetch failed' }))
    throw new Error(err.error ?? `Recipe fetch failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Generate a pantry-aware recipe from constraints.
 */
export async function generateRecipe(
  constraints: RecipeConstraints,
): Promise<GenerateRecipeResponse> {
  const res = await fetch('/api/ai/recipes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(constraints),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Recipe generation failed' }))
    throw new Error(err.error ?? `Recipe generation failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Refine an existing recipe with a natural language prompt.
 */
export async function refineRecipe(
  request: RefineRecipeRequest,
): Promise<GenerateRecipeResponse> {
  const res = await fetch('/api/ai/recipes/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Recipe refinement failed' }))
    throw new Error(err.error ?? `Recipe refinement failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Fetch a CookProposal for a recipe — matches ingredients against the user's pantry.
 * No writes happen here; call confirmCook() to apply.
 *
 * `ingredients` is the list as cooked (#489): after a confirmed mid-cook
 * amendment the pantry is matched against THAT list instead of the stored
 * recipe's, the same per-dish override the meal cook takes. Empty or omitted
 * means "the stored recipe". The saved recipe is never changed either way.
 */
export async function cookRecipe(
  recipeId: string,
  ingredients?: MealCookIngredient[] | null,
): Promise<CookProposal> {
  const res = await fetch('/api/ai/recipes/cook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipe_id: recipeId,
      ...(ingredients && ingredients.length > 0 ? { ingredients } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Cook proposal failed' }))
    throw new Error(err.error ?? `Cook proposal failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Promote a draft recipe row to a real library entry.
 */
export async function promoteRecipeDraft(recipeId: string): Promise<void> {
  const res = await fetch(`/api/recipes/${recipeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_draft: false }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to add recipe to library' }))
    throw new Error(err.error ?? `Failed to add recipe to library: ${res.status}`)
  }
}

/**
 * Confirm a cook and return the server's response, including
 * `deductions_skipped` (pantry item ids the server refused, #621). A 2xx with
 * an unreadable body never throws: the deduction already landed, and an error
 * state would invite a double-deduct retry.
 */
export async function confirmCook(
  recipeId: string,
  deductions: DeductionItem[],
): Promise<CookConfirmResponse> {
  const res = await fetch('/api/ai/recipes/cook/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The client's IANA zone (#550), not a date: the server keys `rescue` bubbles
    // awards for expiring-soon deducted items on its own clock (#524).
    body: JSON.stringify({ recipe_id: recipeId, deductions, tz: clientTimeZone() }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Cook confirmation failed' }))
    throw new Error(err.error ?? `Cook confirmation failed: ${res.status}`)
  }

  const body = (await res.json().catch(() => ({}))) as Partial<CookConfirmResponse> | null
  const skipped = Array.isArray(body?.deductions_skipped)
    ? body.deductions_skipped.filter((id): id is string => typeof id === 'string')
    : []
  return {
    success: true,
    deductions_applied: Number(body?.deductions_applied) || 0,
    deductions_requested: Number(body?.deductions_requested) || 0,
    deductions_skipped: skipped,
  }
}

/**
 * Ensure structured steps exist for one recipe (issue #648).
 *
 * Proxied through `/api/ai/recipes/[id]/steps/ensure` (auth-forwarding,
 * same pattern as `generateRecipe`/`refineRecipe`/`cookRecipe`) rather than
 * called directly from the browser, since this is a single non-streaming
 * call. If the recipe already has steps, the AI service returns them as-is
 * with no model call — idempotent, safe to call more than once. On a model
 * failure the AI service returns 502 with `{ detail: { error_kind, message } }`;
 * that message (falling back to a generic one) is what this throws, so
 * callers should catch and fall back to the regex timer parser rather than
 * surfacing the raw error.
 */
export async function ensureSteps(recipeId: string): Promise<EnsureStepsResponse> {
  const res = await fetch(`/api/ai/recipes/${recipeId}/steps/ensure`, {
    method: 'POST',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => null) as
      | { detail?: { error_kind?: string; message?: string }; error?: string }
      | null
    const message =
      err?.detail?.message ?? err?.error ?? `Failed to ensure recipe steps: ${res.status}`
    throw new Error(message)
  }

  return res.json()
}

/**
 * `last_cooked_at` for every saved recipe — feeds the notification center's
 * "haven't cooked in a while" nudge (#496). Deliberately the minimal shape,
 * not the full `Recipe`, since that's all the derivation needs.
 *
 * `limit=100`: `GET /api/recipes` orders by `created_at desc`, not
 * `last_cooked_at`, so a user with more than 100 saved recipes could have a
 * more-recent cook outside this window and the nudge could fire a few days
 * early for them. Accepted for this "lite" ticket — see the PR's "Not
 * covered" section.
 *
 * Throws on a non-ok response rather than degrading to `[]` (see
 * `fetchPantryItems`'s docstring in `lib/api/pantry.ts` for why): a broken
 * fetch here must not read as "hasn't cooked", it must surface as an error
 * so the caller can show that instead of a false-confident nudge state.
 */
export async function fetchRecipeCookMeta(): Promise<{ last_cooked_at: string | null }[]> {
  const res = await fetch('/api/recipes?limit=100')
  if (!res.ok) throw new Error(`Failed to fetch recipe cook meta: ${res.status}`)
  const data = await res.json().catch(() => ({ recipes: [] }))
  return data.recipes ?? []
}
