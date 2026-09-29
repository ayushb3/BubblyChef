import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { mergeTags, sanitizeSteps } from '@/lib/recipe-helpers'
import { fetchFullMeal, fetchMealSummaries, normalizeConstraints, validateMealDishRoles } from '@/lib/meal-helpers'
import type { CreateMealRequest } from '@/types/meals'

/**
 * `GET /api/meals` — saved meals by default, or drafts with `?drafts=1`
 * (issue #650 / spec #647 "API contracts"). Each item is the summary shape:
 * `{ id, title, servings, is_draft, dishes: [{ role, position, recipe_id,
 * title, total_time_minutes }] }` — no full recipe rows.
 */
export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)
  const drafts = searchParams.get('drafts') === '1'

  try {
    const meals = await fetchMealSummaries(supabase, user.id, drafts)
    return NextResponse.json({ meals })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to load meals')
  }
}

/**
 * `POST /api/meals` — creates a meal with its dishes. Each dish is either a
 * new recipe payload (saved with `is_draft` equal to the meal's, structured
 * steps sanitized through `sanitizeSteps` same as `POST /api/recipes`) or a
 * reference to an existing recipe id owned by this user. Returns the meal as
 * `GET /api/meals/[id]` would.
 */
export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const body = (await request.json()) as CreateMealRequest

  if (!body.title || typeof body.title !== 'string') {
    return errorResponse('title is required', 400)
  }
  if (!Array.isArray(body.dishes) || body.dishes.length === 0) {
    return errorResponse('dishes is required', 400)
  }

  const roleError = validateMealDishRoles(body.dishes)
  if (roleError) return errorResponse(roleError, 400)

  const servings =
    typeof body.servings === 'number' && body.servings > 0 ? body.servings : 2
  const isDraft = body.is_draft ?? false

  const { data: meal, error: mealError } = await supabase
    .from('meals')
    .insert({
      user_id: user.id,
      title: body.title,
      description: body.description ?? null,
      servings,
      constraints: normalizeConstraints(body.constraints),
      is_draft: isDraft,
      source_type: body.source_type || 'chat',
    })
    .select()
    .single()

  if (mealError || !meal) {
    return errorResponse(mealError?.message ?? 'Failed to create meal')
  }

  try {
    for (const dish of body.dishes) {
      let recipeId: string

      if (dish.recipe_id) {
        // Referenced, not copied (spec #647 "Dish identity is by recipe id
        // only") — but only when it's actually this user's recipe. The
        // route runs on the user-scoped client, so recipes RLS already
        // limits this select to their own rows; a foreign id simply
        // resolves to nothing rather than leaking another user's recipe.
        const { data: existing, error: existingErr } = await supabase
          .from('recipes')
          .select('id')
          .eq('id', dish.recipe_id)
          .eq('user_id', user.id)
          .maybeSingle()
        if (existingErr || !existing) {
          throw new Error(`Recipe ${dish.recipe_id} not found`)
        }
        recipeId = existing.id
      } else if (dish.recipe) {
        const { data: newRecipe, error: newRecipeErr } = await supabase
          .from('recipes')
          .insert({
            user_id: user.id,
            title: dish.recipe.title,
            description: dish.recipe.description ?? null,
            ingredients: dish.recipe.ingredients ?? [],
            instructions: dish.recipe.instructions ?? [],
            steps: sanitizeSteps(dish.recipe.steps, dish.recipe.instructions),
            cuisine: dish.recipe.cuisine ?? null,
            meal_type: dish.recipe.meal_type ?? null,
            tags: mergeTags(undefined, dish.recipe.dietary_tags),
            difficulty: dish.recipe.difficulty ?? null,
            prep_time_minutes: dish.recipe.prep_time_minutes ?? null,
            cook_time_minutes: dish.recipe.cook_time_minutes ?? null,
            total_time_minutes: dish.recipe.total_time_minutes ?? null,
            servings: dish.recipe.servings ?? servings,
            source_type: body.source_type || 'chat',
            // Every new dish recipe is a draft exactly when the meal is
            // (contract: "saved with is_draft = the meal's").
            is_draft: isDraft,
          })
          .select('id')
          .single()
        if (newRecipeErr || !newRecipe) {
          throw new Error(newRecipeErr?.message ?? 'Failed to create dish recipe')
        }
        recipeId = newRecipe.id
      } else {
        throw new Error('Each dish needs a "recipe" payload or a "recipe_id".')
      }

      const { error: dishError } = await supabase.from('meal_dishes').insert({
        meal_id: meal.id,
        recipe_id: recipeId,
        user_id: user.id,
        role: dish.role,
        position: dish.position,
      })
      if (dishError) throw new Error(dishError.message)
    }
  } catch (err) {
    // Best-effort cleanup: remove the meal row (cascades to any meal_dishes
    // already inserted) so a partial failure doesn't leave a broken meal
    // behind. A dish recipe already created before the failure is NOT
    // retroactively deleted — it's a harmless orphaned draft/recipe, and
    // that's an acceptable trade for not needing a real transaction here
    // (Supabase's JS client has none across separate inserts).
    await supabase.from('meals').delete().eq('id', meal.id).eq('user_id', user.id)
    return errorResponse(err instanceof Error ? err.message : 'Failed to create meal', 400)
  }

  const full = await fetchFullMeal(supabase, user.id, meal.id)
  if (!full) return errorResponse('Failed to load created meal')

  return NextResponse.json(full, { status: 201 })
}
