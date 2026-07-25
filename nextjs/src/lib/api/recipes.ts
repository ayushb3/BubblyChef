/**
 * Recipe AI client — calls the Next.js proxy routes.
 *
 * Recipe generation/refinement is non-streaming, so it goes through
 * the proxy for auth forwarding.
 */

import type {
  RecipeConstraints,
  GenerateRecipeResponse,
  RefineRecipeRequest,
  CookProposal,
  DeductionItem,
} from '@/types/recipes'

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
 */
export async function cookRecipe(recipeId: string): Promise<CookProposal> {
  const res = await fetch('/api/ai/recipes/cook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_id: recipeId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Cook proposal failed' }))
    throw new Error(err.error ?? `Cook proposal failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Confirm cooking a recipe: apply pantry deductions and mark recipe as cooked.
 */
export async function confirmCook(
  recipeId: string,
  deductions: DeductionItem[],
): Promise<void> {
  const res = await fetch('/api/ai/recipes/cook/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_id: recipeId, deductions }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Cook confirmation failed' }))
    throw new Error(err.error ?? `Cook confirmation failed: ${res.status}`)
  }
}
