/**
 * Issue #155 — the cook→chat handoff must pin the session on the first message
 * regardless of whether the client has finished fetching the recipe.
 *
 * `takeCookingContext` in `chat/page.tsx` builds its payload from
 * `cookingContextForId(cookingRecipeId)`, where `cookingRecipeId` is the
 * `?cooking=<id>` param — known synchronously on mount. These assertions lock
 * in that the payload is available immediately (no `loadedRecipe` dependency),
 * which is what closes the fetch/send race. The AI service resolves the full
 * recipe from this id server-side.
 */
import { cookingContextForId } from '@/lib/chat-seed'

describe('cookingContextForId (#155)', () => {
  it('returns the id-only context payload synchronously from the URL param', () => {
    expect(cookingContextForId('recipe-42')).toEqual({ cooking_recipe_id: 'recipe-42' })
  })

  it('does not include title/ingredients — the backend resolves those', () => {
    const context = cookingContextForId('recipe-42')
    expect(Object.keys(context ?? {})).toEqual(['cooking_recipe_id'])
  })

  it('returns undefined for a bare /chat (no ?cooking= param)', () => {
    expect(cookingContextForId(null)).toBeUndefined()
    expect(cookingContextForId(undefined)).toBeUndefined()
  })

  it('ignores a blank or whitespace-only id so no empty pin is sent', () => {
    expect(cookingContextForId('')).toBeUndefined()
    expect(cookingContextForId('   ')).toBeUndefined()
  })

  it('trims surrounding whitespace off the id', () => {
    expect(cookingContextForId('  recipe-42  ')).toEqual({ cooking_recipe_id: 'recipe-42' })
  })
})
