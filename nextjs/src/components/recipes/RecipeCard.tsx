'use client'

/**
 * RecipeCard: the one recipe card (signature component #3, issue #744). It
 * replaces ChatRecipeCard, MealOptionCards, CompactMealCard and MealDishCard, so
 * a dish looks the same wherever it appears. Drawn to the Signature "Recipe card"
 * board: a 2 px ink frame, 16 px radius, a pastel header band in a meal, ink text
 * on every fill, Quicksand titles, 44 px touch targets.
 *
 * One component, five variants, chosen by `variant`. Each variant's props are
 * the old card's props, so the call sites change by one word:
 *
 * - `option`  (chat: three dinners) `option`, `onSelect`, `disabled`, `index`.
 *   One card per meal option; the caller wraps the stack in `role="list"`.
 * - `dish`    (a meal's dishes) `role`, `position`, `title`, `minutes`,
 *   `ingredients`, `instructions`, `steps`, `href`, `actions`, `toBuy`,
 *   `expiring`. The role tag wears the dish pastel (main pink, side 1 mint,
 *   side 2 peach, the `--color-dish-*` tokens). A main starts expanded, a side
 *   collapsed to its key ingredients.
 * - `chat`    (one recipe in chat) `recipe`, `onSave`, `onTryAnother`,
 *   `onCookWithMe`, `onAlreadyMade`, `onMakeMeal`, `saveState`, `cookState`.
 * - `compact` (the saved-meal row, and the meal card in chat) `title`,
 *   `dishes`, `servings`, `toBuy`, `href` or `onOpen`, optionally `onSave`.
 *
 * - `saved`   (the library's recipe row, issue #801) `title`, `thumbnailUrl`,
 *   `minutes`, `servings`, `cuisine`, `difficulty`, `tags`, `favorite`,
 *   `onOpen`, `onToggleFavorite`, `onEdit`, `onDelete`, `busy`.
 *
 * Zero sides is a first-class state: an option with only a main reads "no side",
 * and a dish card never assumes a side exists.
 */

import type { MealProposal, SavedMealMatch } from '@/types/chat'
import ChatVariant, { type ChatCardProps } from './recipe-card/ChatVariant'
import CompactVariant, { type CompactCardProps } from './recipe-card/CompactVariant'
import DishVariant, { type DishCardProps } from './recipe-card/DishVariant'
import OptionVariant, { type OptionCardProps } from './recipe-card/OptionVariant'
import SavedVariant, { type SavedCardProps } from './recipe-card/SavedVariant'

export type RecipeCardProps =
  | ({ variant: 'option' } & OptionCardProps)
  | ({ variant: 'dish' } & DishCardProps)
  | ({ variant: 'chat' } & ChatCardProps)
  | ({ variant: 'compact' } & CompactCardProps)
  | ({ variant: 'saved' } & SavedCardProps)

export type { ChatCardProps, CompactCardProps, DishCardProps, OptionCardProps, SavedCardProps }

export default function RecipeCard(props: RecipeCardProps) {
  // `variant` rides along in the spread; the variants ignore it.
  switch (props.variant) {
    case 'option':
      return <OptionVariant {...props} />
    case 'dish':
      return <DishVariant {...props} />
    case 'chat':
      return <ChatVariant {...props} />
    case 'compact':
      return <CompactVariant {...props} />
    case 'saved':
      return <SavedVariant {...props} />
  }
}

/** The compact card's props for a meal Bubbles just proposed in chat. */
export function compactPropsFromProposal(proposal: MealProposal): CompactCardProps {
  return {
    title: proposal.title,
    dishes: proposal.dishes.map((dish) => dish.recipe.title ?? 'Untitled dish'),
    servings: proposal.servings,
    toBuy: proposal.missing_ingredients,
  }
}

/**
 * The compact card's props for a meal that already exists (a saved-meal lookup
 * match). It stores no missing ingredients, so `toBuy` is left unknown.
 */
export function compactPropsFromSavedMeal(meal: SavedMealMatch): CompactCardProps {
  return {
    title: meal.title,
    dishes: meal.dishes.map((dish) => dish.title ?? 'Untitled dish'),
    servings: meal.servings,
  }
}
