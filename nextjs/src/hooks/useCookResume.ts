'use client'

/**
 * A cook left mid-recipe, for the Bubbles card (issue #755).
 *
 * Reads the two cook sessions kept in local storage (a guided recipe cook,
 * `lib/cook-session.ts`, and a meal cook-along, `lib/meal-cook-session.ts`; both
 * readers already refuse an ended session and swallow corrupt storage), fetches
 * the recipe or meal it belongs to through the same queries the recipe and meal
 * screens use, and puts them in the card's words (`lib/kitchen/cook-resume.ts`).
 *
 * The storage is read in an effect, not during render, so the server render and
 * the first client render agree (no session) and the card simply is not ready yet.
 * It follows other tabs (`storage`) and a tab brought back to the front, like
 * `useBubblesSpot`.
 *
 * `ready` is false until the sessions are read and, when there is one, the recipe
 * or meal has loaded or failed to: the card must not flash a quieter case and
 * then swap it for "Back to the lemon pasta?". A recipe or meal that cannot be
 * fetched (deleted, offline) simply gives no cook card.
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clearActiveCookSession, getActiveCookSession, type ActiveCookSession } from '@/lib/cook-session'
import {
  endMealCookSession,
  getActiveMealCookSession,
  type MealCookSession,
} from '@/lib/meal-cook-session'
import { timerIdsToDismiss } from '@/lib/meal-cook-stream'
import { useCookingTimers } from '@/lib/useCookingTimers'
import { fetchRecipe } from '@/lib/api/recipes'
import { fetchMeal } from '@/lib/api/meals'
import { mealCookResume, recipeCookResume } from '@/lib/kitchen/cook-resume'
import type { CookResume } from '@/lib/kitchen/home-card'

interface Sessions {
  recipe: ActiveCookSession | null
  meal: MealCookSession | null
}

function readSessions(): Sessions {
  return { recipe: getActiveCookSession(), meal: getActiveMealCookSession() }
}

export function useCookResume(): { cook: CookResume | null; ready: boolean; finish: () => void } {
  const { dismiss: dismissTimer } = useCookingTimers()
  const [sessions, setSessions] = useState<Sessions | null>(null)

  useEffect(() => {
    const read = () => setSessions(readSessions())
    read()
    window.addEventListener('storage', read)
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      window.removeEventListener('storage', read)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [])

  const mealId = sessions?.meal?.meal_id ?? null
  const recipeId = sessions?.recipe?.recipeId ?? null

  const mealQuery = useQuery({
    queryKey: ['meal', mealId],
    queryFn: () => fetchMeal(mealId as string),
    enabled: mealId !== null,
    retry: false,
    staleTime: 60_000,
  })
  const recipeQuery = useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: () => fetchRecipe(recipeId as string),
    enabled: recipeId !== null,
    retry: false,
    staleTime: 60_000,
  })

  const mealCook =
    sessions?.meal && mealQuery.data ? mealCookResume(sessions.meal, mealQuery.data) : null
  const recipeCook =
    sessions?.recipe && recipeQuery.data ? recipeCookResume(sessions.recipe, recipeQuery.data) : null
  const cook = mealCook ?? recipeCook

  const ready =
    sessions !== null &&
    (mealId === null || !mealQuery.isLoading) &&
    (recipeId === null || !recipeQuery.isLoading)

  /** "I finished it": the session is over, no pantry write (the same as the Skip / Dismiss it mirrors). */
  const finish = useCallback(() => {
    if (!cook || !sessions) return
    if (cook.kind === 'meal' && sessions.meal) {
      for (const id of timerIdsToDismiss(sessions.meal)) dismissTimer(id)
      endMealCookSession(cook.id)
    } else {
      clearActiveCookSession(cook.id)
    }
    setSessions(readSessions())
  }, [cook, sessions, dismissTimer])

  return { cook, ready, finish }
}
