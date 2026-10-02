'use client'

/**
 * Recipe card, `chat` variant: a single recipe Bubbles suggests in chat (issue
 * #744). Same card as every other variant: a pastel header band (tag and
 * minutes), the title, ingredient rows with what you have and what is short,
 * the "N to buy" line, the method, then the actions.
 *
 * Behaviour is the old ChatRecipeCard's, unchanged:
 * - "Cook with me" and "I already made this" go inert once cooking has started
 *   (`cookState === 'started'`, issue #269) so a running cook can't be re-pinned
 *   or deducted twice; both are disabled while a draft POST is in flight.
 * - "Save to Library" hides once a real library entry exists.
 * - "Make it a meal" shows when `onMakeMeal` is set.
 */

import { motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import { useMotionConfig } from '@/lib/motion'
import { titleCase } from '@/lib/format'
import { ingredientParts } from '@/lib/recipe-helpers'
import type { ManualLineInput } from '@/lib/grocery'
import { toBuyEntriesFromRecipe } from '@/lib/meal-to-buy'
import type { ChatRecipeData, IngredientAvailability } from '@/types/chat'
import { CARD_FRAME, MetaPill, Minutes, TITLE_FONT, ToBuyLine } from './parts'

export interface ChatCardProps {
  recipe: ChatRecipeData
  onSave?: () => void
  onTryAnother?: () => void
  saveState?: 'idle' | 'saving' | 'saved' | 'error'
  savedRecipeId?: string | null
  /** True when savedRecipeId is a draft row (not yet a real library entry). */
  isSavedDraft?: boolean
  /** Enters guided cooking mode. Always enabled. */
  onCookWithMe?: () => void
  /** Opens deduction review directly. Always enabled. */
  onAlreadyMade?: () => void
  /**
   * - 'pending': a draft POST is in flight; both cook buttons are disabled.
   * - 'started': the user has entered cooking mode for this recipe. The card is
   *   inert from then on (#269), for the life of the message.
   */
  cookState?: 'idle' | 'pending' | 'started'
  /** Shows the "Make it a meal" button when set. */
  onMakeMeal?: () => void
  /** Disables that button (the page passes `isStreaming`). */
  makeMealDisabled?: boolean
  /** Overrides the default write to the browser grocery list. */
  onAddToGrocery?: (items: Array<string | ManualLineInput>) => void | Promise<void>
}

function totalMinutes(recipe: ChatRecipeData): number | null {
  if (recipe.total_time_minutes) return recipe.total_time_minutes
  const sum = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0)
  return sum > 0 ? sum : null
}

const STATUS_PILL = 'shrink-0 rounded-full border-[1.5px] px-2 py-0.5 text-[11px] leading-4 font-extrabold'

function AvailabilityPill({ status }: { status: IngredientAvailability['status'] }) {
  if (status === 'have') {
    return (
      <span className={`${STATUS_PILL} border-[var(--color-text)] bg-[var(--color-accent)] text-[var(--color-text)]`}>
        In kitchen
      </span>
    )
  }
  return (
    <span
      className={`${STATUS_PILL} border-[var(--color-expiring-text)] bg-[var(--color-expiring)] text-[var(--color-expiring-text)]`}
    >
      {status === 'missing' ? 'To buy' : 'Substitute'}
    </span>
  )
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function SaveButtonContent({ saveState }: { saveState: ChatCardProps['saveState'] }) {
  if (saveState === 'saving') {
    return (
      <span className="flex items-center gap-1.5">
        <Spinner />
        Saving…
      </span>
    )
  }
  if (saveState === 'saved') return <>✓ Saved!</>
  if (saveState === 'error') return <>Try again</>
  return <>Save to Library</>
}

export default function ChatVariant({
  recipe,
  onSave,
  onTryAnother,
  saveState = 'idle',
  savedRecipeId,
  isSavedDraft = false,
  onCookWithMe,
  onAlreadyMade,
  cookState = 'idle',
  onMakeMeal,
  makeMealDisabled = false,
  onAddToGrocery,
}: ChatCardProps) {
  const { reduced } = useMotionConfig()
  const minutes = totalMinutes(recipe)

  const availabilityMap = new Map<string, IngredientAvailability>(
    (recipe.ingredient_availability ?? []).map((a) => [a.name.toLowerCase(), a]),
  )
  // Only known when the server graded the ingredients against the pantry.
  const toBuy = recipe.ingredient_availability
    ? recipe.ingredient_availability.filter((a) => a.status === 'missing').map((a) => titleCase(a.name))
    : undefined

  const pills: string[] = []
  if (recipe.difficulty) pills.push(recipe.difficulty)
  if (recipe.servings) pills.push(`${recipe.servings} servings`)
  if (recipe.cuisine) pills.push(recipe.cuisine)

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.3, ease: 'easeOut' }}
      className={`${CARD_FRAME} w-full overflow-hidden`}
    >
      <div className="flex items-center justify-between border-b-2 border-[var(--color-text)] bg-[var(--color-primary)] px-3 py-2">
        <span className="rounded-full border-[1.5px] border-[var(--color-text)] bg-[var(--color-surface)] px-2 py-px text-[11px] leading-4 font-extrabold tracking-[0.06em] uppercase">
          Recipe
        </span>
        {minutes != null && <Minutes minutes={minutes} />}
      </div>

      <div className="flex flex-col gap-3 px-3 pt-2.5 pb-3">
        <div className="flex flex-col gap-1">
          <h3 className={`${TITLE_FONT} text-[17px] leading-[22px] font-bold`}>{recipe.title ?? 'Recipe'}</h3>
          {recipe.description && (
            <p className="line-clamp-2 text-[13px] leading-[18px] text-[var(--color-muted)]">{recipe.description}</p>
          )}
        </div>

        {(pills.length > 0 || (recipe.dietary_tags?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {pills.map((label) => (
              <MetaPill key={label}>{label}</MetaPill>
            ))}
            {recipe.dietary_tags?.map((tag) => (
              <span
                key={tag}
                className="inline-block rounded-full border-[1.5px] border-[var(--color-text)] bg-[var(--color-accent)] px-2 py-px text-[11px] leading-4 font-extrabold"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {recipe.ingredients && recipe.ingredients.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-extrabold tracking-wide text-[var(--color-muted)] uppercase">
              Ingredients
            </h4>
            <ul>
              {recipe.ingredients.map((ing, i) => {
                // `ingredientParts` keeps the dual-shape rule in one module (#315).
                const { name, displayName, quantityText } = ingredientParts(ing)
                // Availability keys on the bare name, as `ingredient_availability` is built server-side.
                const avail = availabilityMap.get(name.toLowerCase())
                return (
                  <li key={i} className="border-b border-[var(--color-border)] py-[7px] last:border-b-0">
                    <div className="flex items-center gap-2.5">
                      <span className="min-w-[60px] shrink-0 text-[13px] font-extrabold tabular-nums">
                        {quantityText}
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-[19px] font-bold">{titleCase(displayName)}</span>
                      {avail && <AvailabilityPill status={avail.status} />}
                    </div>
                    {avail?.status === 'substitute' && avail.substitute_note && (
                      <p className="mt-0.5 text-xs text-[var(--color-expiring-text)]">{avail.substitute_note}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {toBuy !== undefined && (
          <ToBuyLine
            key={toBuy.join('|')}
            items={toBuy}
            entries={toBuyEntriesFromRecipe(recipe)}
            onAdd={onAddToGrocery}
          />
        )}

        {recipe.instructions && recipe.instructions.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-xs font-extrabold tracking-wide text-[var(--color-muted)] uppercase">
              Instructions
            </h4>
            <ol className="flex flex-col gap-2">
              {recipe.instructions.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[var(--color-text)] bg-[var(--color-primary)] text-xs font-extrabold"
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* mx-0.5 leaves room for the keycap's press and shadow against the card edge. */}
        <div className="mx-0.5 flex flex-col gap-2 pt-1">
          {/* Disabled while a draft POST is in flight, and permanently once cooking has started (#269). */}
          {onCookWithMe && (
            <SpringButton
              variant="primary"
              fullWidth
              onClick={onCookWithMe}
              disabled={cookState !== 'idle'}
              loading={cookState === 'pending'}
            >
              {cookState === 'pending' ? 'Starting…' : cookState === 'started' ? <>✓ Cooking started</> : <>👩‍🍳 Cook with me</>}
            </SpringButton>
          )}
          <div className="flex flex-wrap gap-2">
            {/* Hidden once a real library entry exists. */}
            {saveState !== 'saved' && !(savedRecipeId && !isSavedDraft) && (
              <div className="min-w-[160px] flex-1">
                <SpringButton
                  variant={saveState === 'error' ? 'danger' : 'secondary'}
                  fullWidth
                  onClick={onSave}
                  disabled={saveState === 'saving' || cookState === 'started'}
                >
                  <SaveButtonContent saveState={saveState} />
                </SpringButton>
              </div>
            )}
            <div className="min-w-[160px] flex-1">
              <SpringButton
                variant="secondary"
                fullWidth
                onClick={onTryAnother}
                disabled={cookState === 'started'}
              >
                Try Another
              </SpringButton>
            </div>
          </div>
          {/* Starts the meal flow with this dish as the fixed main (issue #651 PR B). The accessible
              name keeps the visible words first and adds the dish, so several cards in one thread
              are told apart. */}
          {onMakeMeal && (
            <SpringButton
              variant="secondary"
              fullWidth
              onClick={onMakeMeal}
              disabled={makeMealDisabled || cookState !== 'idle'}
              aria-label={recipe.title?.trim() ? `Make it a meal: ${recipe.title.trim()}` : undefined}
            >
              <span aria-hidden="true">🍽️</span> Make it a meal
            </SpringButton>
          )}
          {/* Tertiary: already cooked. Disabled once cooking has started, or tapping it would
              deduct the same ingredients a second time (#269). */}
          {onAlreadyMade && (
            <button
              type="button"
              onClick={onAlreadyMade}
              disabled={cookState !== 'idle'}
              className="min-h-[44px] text-center text-xs font-bold text-[var(--color-text)] underline underline-offset-2 transition-colors disabled:cursor-not-allowed disabled:text-[var(--color-muted)] disabled:no-underline"
            >
              {cookState === 'started' ? 'Cooking in progress' : 'I already made this'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
