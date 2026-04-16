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
  is_favorite?: boolean
  created_at?: string
}

interface RecipeDetailProps {
  recipe: Recipe
}

// Ruled-paper constants — text line-height must match the gradient repeat
const LINE_HEIGHT = 28 // px — matches repeating-linear-gradient step
const FIRST_LINE_OFFSET = 4 // px — pad-top so first text line sits on first rule

export default function RecipeDetail({ recipe }: RecipeDetailProps) {
  return (
    <div
      className="px-5 py-4 text-sm text-[var(--color-text)]"
      style={{
        fontFamily: 'Nunito, sans-serif',
        backgroundImage:
          'repeating-linear-gradient(transparent, transparent 27px, var(--color-border) 27px, var(--color-border) 28px)',
        backgroundSize: `100% ${LINE_HEIGHT}px`,
        backgroundPositionY: `${FIRST_LINE_OFFSET}px`,
        lineHeight: `${LINE_HEIGHT}px`,
        paddingTop: `${FIRST_LINE_OFFSET}px`,
      }}
    >
      {/* Ingredients */}
      {recipe.ingredients.length > 0 && (
        <div className="mb-6">
          <h3
            className="font-extrabold text-base"
            style={{ lineHeight: `${LINE_HEIGHT}px`, fontFamily: 'Nunito, sans-serif' }}
          >
            Ingredients ✏️
          </h3>
          <ul>
            {recipe.ingredients.map((ing, i) => {
              const label =
                typeof ing === 'string'
                  ? ing
                  : [ing.quantity, ing.unit, ing.name].filter(Boolean).join(' ')
              return (
                <motion.li
                  key={i}
                  className="flex items-center gap-2"
                  style={{ lineHeight: `${LINE_HEIGHT}px` }}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.25 }}
                >
                  <span
                    className="flex-shrink-0 w-2 h-2 rounded-full"
                    style={{ background: 'var(--color-primary)' }}
                  />
                  <span>{label}</span>
                </motion.li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Instructions */}
      {recipe.instructions.length > 0 && (
        <div>
          <h3
            className="font-extrabold text-base"
            style={{ lineHeight: `${LINE_HEIGHT}px`, fontFamily: 'Nunito, sans-serif' }}
          >
            Method 📝
          </h3>
          <ol>
            {recipe.instructions.map((step, i) => {
              const text = typeof step === 'string' ? step : (step.text ?? step.step ?? '')
              return (
                <motion.li
                  key={i}
                  className="flex items-start gap-3"
                  style={{ lineHeight: `${LINE_HEIGHT}px` }}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25 }}
                >
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{
                      background: 'var(--color-primary)',
                      fontFamily: 'Nunito, sans-serif',
                      marginTop: `${(LINE_HEIGHT - 24) / 2}px`,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>{text}</span>
                </motion.li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
