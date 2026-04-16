'use client'

import { motion } from 'framer-motion'

export interface Ingredient {
  name: string
  quantity?: string | number | null
  unit?: string | null
}

export interface Recipe {
  id: string
  user_id: string
  title: string
  description?: string | null
  ingredients: (string | Ingredient)[]
  instructions: (string | { text?: string; step?: string })[]
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  servings?: number | null
  source_url?: string | null
  tags?: string[]
  difficulty?: string | null
  source_type?: string
  source_title?: string | null
  thumbnail_url?: string | null
  is_draft?: boolean
  cuisine?: string | null
  meal_type?: string | null
  created_at?: string
}

const DIFFICULTY_ROTATE: Record<string, string> = {
  easy: '-1.5deg',
  medium: '1deg',
  hard: '-0.5deg',
}

function Chip({ label, rotate = '0deg' }: { label: string; rotate?: string }) {
  return (
    <span
      className="inline-block border border-[var(--color-border)] px-2.5 py-0.5 rounded text-xs text-[var(--color-muted)] font-semibold uppercase tracking-wide"
      style={{ transform: `rotate(${rotate})`, display: 'inline-block' }}
    >
      {label}
    </span>
  )
}

interface RecipePageProps {
  recipe: Recipe
}

export default function RecipePage({ recipe }: RecipePageProps) {
  const totalTime = recipe.total_time_minutes
    ? `${recipe.total_time_minutes} min`
    : recipe.prep_time_minutes || recipe.cook_time_minutes
    ? `${(recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0)} min`
    : null

  return (
    <div
      className="flex flex-col h-full overflow-hidden rounded-r-lg"
      style={{ background: 'var(--color-surface)' }}
    >
      {/* Title strip */}
      <div className="chowder-panel px-5 py-4 flex-shrink-0">
        <h2
          className="text-2xl font-extrabold text-white leading-tight"
          style={{ fontFamily: 'Nunito, sans-serif', textShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
        >
          {recipe.title}
        </h2>
        {recipe.description && (
          <p className="text-white/80 text-sm mt-0.5 line-clamp-2">{recipe.description}</p>
        )}
      </div>

      {/* Metadata chips */}
      <div className="flex flex-wrap gap-2 px-5 py-3 flex-shrink-0 border-b border-[var(--color-border)]">
        {recipe.prep_time_minutes && (
          <Chip label={`Prep ${recipe.prep_time_minutes}m`} rotate="-1deg" />
        )}
        {recipe.cook_time_minutes && (
          <Chip label={`Cook ${recipe.cook_time_minutes}m`} rotate="1.5deg" />
        )}
        {totalTime && <Chip label={`Total ${totalTime}`} rotate="-0.5deg" />}
        {recipe.difficulty && (
          <Chip
            label={recipe.difficulty}
            rotate={DIFFICULTY_ROTATE[recipe.difficulty.toLowerCase()] ?? '1deg'}
          />
        )}
        {recipe.cuisine && <Chip label={recipe.cuisine} rotate="1deg" />}
        {recipe.meal_type && <Chip label={recipe.meal_type} rotate="-1deg" />}
        {recipe.servings && <Chip label={`Serves ${recipe.servings}`} rotate="0.5deg" />}
      </div>

      {/* Body — ruled-paper effect */}
      <div
        className="flex-1 overflow-y-auto px-5 py-4 text-sm text-[var(--color-text)]"
        style={{
          fontFamily: 'Nunito, sans-serif',
          backgroundImage:
            'repeating-linear-gradient(transparent, transparent 27px, var(--color-border) 27px, var(--color-border) 28px)',
          backgroundSize: '100% 28px',
          backgroundPositionY: '4px',
        }}
      >
        {/* Ingredients */}
        {recipe.ingredients.length > 0 && (
          <div className="mb-6">
            <h3 className="font-extrabold text-base mb-2" style={{ fontFamily: 'Nunito, sans-serif' }}>
              Ingredients ✏️
            </h3>
            <ul className="space-y-1">
              {recipe.ingredients.map((ing, i) => {
                const label = typeof ing === 'string'
                  ? ing
                  : [ing.quantity, ing.unit, ing.name].filter(Boolean).join(' ')
                return (
                <motion.li
                  key={i}
                  className="flex items-start gap-2"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.25 }}
                >
                  <span
                    className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full"
                    style={{ background: 'var(--color-primary)' }}
                  />
                  <span className="leading-6">{label}</span>
                </motion.li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Instructions */}
        {recipe.instructions.length > 0 && (
          <div>
            <h3 className="font-extrabold text-base mb-2" style={{ fontFamily: 'Nunito, sans-serif' }}>
              Method 📝
            </h3>
            <ol className="space-y-3">
              {recipe.instructions.map((step, i) => {
                const text = typeof step === 'string' ? step : (step.text ?? step.step ?? '')
                return (
                <motion.li
                  key={i}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25 }}
                >
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
                  >
                    {i + 1}
                  </span>
                  <span className="leading-6 pt-0.5">{text}</span>
                </motion.li>
                )
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
