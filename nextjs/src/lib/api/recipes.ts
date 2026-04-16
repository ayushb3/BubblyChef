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
