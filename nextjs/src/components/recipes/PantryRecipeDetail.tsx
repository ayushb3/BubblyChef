'use client'

/**
 * The recipe page with its ingredient food tags wired to the pantry (issue
 * #784). `RecipeDetail` stays presentational (it takes `ingredientMatches`);
 * this asks the AI service's deterministic match and hands the answer over. When
 * the call is loading or fails there are no matches, so no tags show.
 */

import RecipeDetail, { type Recipe } from './RecipePage'
import { useIngredientMatches } from '@/hooks/useIngredientMatches'

export default function PantryRecipeDetail({ recipe }: { recipe: Recipe }) {
  const ingredientMatches = useIngredientMatches(recipe.ingredients)
  return <RecipeDetail recipe={recipe} ingredientMatches={ingredientMatches} />
}
