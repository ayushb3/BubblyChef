'use client'

import { motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import type { ChatRecipeData, IngredientAvailability } from '@/types/chat'

interface ChatRecipeCardProps {
  recipe: ChatRecipeData
  onSave?: () => void
  onTryAnother?: () => void
  saveState?: 'idle' | 'saving' | 'saved' | 'error'
}

const CHIP_COLORS: string[] = [
  'bg-[#FFE4EC] text-[#D4607A]',
  'bg-[#E4F0FF] text-[#4A7FC4]',
  'bg-[#E4F7EE] text-[#3A8C5C]',
  'bg-[#FFF3E4] text-[#C47A3A]',
  'bg-[#F0E4FF] text-[#7A4AC4]',
]

function MetaChip({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorClass}`}>
      {label}
    </span>
  )
}

function AvailabilityIcon({ status }: { status: IngredientAvailability['status'] }) {
  if (status === 'have') return <span className="text-green-500 font-bold">✓</span>
  if (status === 'missing') return <span className="text-red-500 font-bold">✗</span>
  return <span className="text-orange-400 font-bold">~</span>
}

function SaveButtonContent({ saveState }: { saveState: ChatRecipeCardProps['saveState'] }) {
  if (saveState === 'saving') {
    return (
      <span className="flex items-center gap-1.5">
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Saving…
      </span>
    )
  }
  if (saveState === 'saved') return <>✓ Saved!</>
  if (saveState === 'error') return <>Try again</>
  return <>Save to Library</>
}

export default function ChatRecipeCard({
  recipe,
  onSave,
  onTryAnother,
  saveState = 'idle',
}: ChatRecipeCardProps) {
  const totalTime =
    recipe.total_time_minutes
      ? `${recipe.total_time_minutes} min`
      : (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0) > 0
      ? `${(recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0)} min`
      : null

  const metaChips: Array<{ label: string; index: number }> = []
  if (totalTime) metaChips.push({ label: `⏱ ${totalTime}`, index: 0 })
  if (recipe.difficulty) metaChips.push({ label: recipe.difficulty, index: 1 })
  if (recipe.servings) metaChips.push({ label: `${recipe.servings} servings`, index: 2 })
  if (recipe.cuisine) metaChips.push({ label: recipe.cuisine, index: 3 })

  const availabilityMap = new Map<string, IngredientAvailability>(
    (recipe.ingredient_availability ?? []).map((a) => [a.name.toLowerCase(), a])
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl bg-white border border-[var(--color-border)] shadow-sm overflow-hidden max-w-[85%]"
    >
      {/* Title strip */}
      <div className="bg-[var(--color-primary)] px-4 py-2">
        <h3 className="text-white font-bold text-base leading-snug">
          {recipe.title ?? 'Recipe'}
        </h3>
        {recipe.description && (
          <p className="text-white/80 text-xs mt-0.5 line-clamp-2">{recipe.description}</p>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Meta chips */}
        {metaChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {metaChips.map(({ label, index }) => (
              <MetaChip key={label} label={label} colorClass={CHIP_COLORS[index % CHIP_COLORS.length]} />
            ))}
          </div>
        )}

        {/* Dietary tags */}
        {recipe.dietary_tags && recipe.dietary_tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.dietary_tags.map((tag) => (
              <span
                key={tag}
                className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--color-accent)] text-[var(--color-text)] font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Ingredients */}
        {recipe.ingredients && recipe.ingredients.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
              Ingredients
            </p>
            <ul className="flex flex-col gap-1">
              {recipe.ingredients.map((ing, i) => {
                const key = ing.name.toLowerCase()
                const avail = availabilityMap.get(key)
                const qtyStr = [ing.quantity, ing.unit].filter(Boolean).join(' ')
                return (
                  <li key={i} className="flex flex-col">
                    <div className="flex items-start gap-1.5 text-sm text-[var(--color-text)]">
                      {avail ? (
                        <span className="mt-0.5 shrink-0">
                          <AvailabilityIcon status={avail.status} />
                        </span>
                      ) : (
                        <span className="mt-0.5 shrink-0 text-[var(--color-muted)]">•</span>
                      )}
                      <span>
                        {qtyStr && <span className="font-semibold">{qtyStr} </span>}
                        {ing.name}
                      </span>
                    </div>
                    {avail?.status === 'substitute' && avail.substitute_note && (
                      <p className="ml-5 text-xs text-orange-500 mt-0.5">{avail.substitute_note}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Instructions */}
        {recipe.instructions && recipe.instructions.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
              Instructions
            </p>
            <ol className="flex flex-col gap-2">
              {recipe.instructions.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-[var(--color-text)]">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--color-primary)] text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="flex-1">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <SpringButton
            onClick={onSave}
            disabled={saveState === 'saving' || saveState === 'saved'}
            className={[
              'flex-1 py-2 px-3 rounded-full text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
              saveState === 'saved'
                ? 'bg-green-100 text-green-700'
                : saveState === 'error'
                ? 'bg-red-100 text-red-700'
                : 'bg-[var(--color-primary)] text-white',
            ].join(' ')}
          >
            <SaveButtonContent saveState={saveState} />
          </SpringButton>
          <SpringButton
            onClick={onTryAnother}
            className="flex-1 py-2 px-3 rounded-full text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-muted)] hover:bg-[var(--color-bg)]"
          >
            Try Another
          </SpringButton>
        </div>
      </div>
    </motion.div>
  )
}
