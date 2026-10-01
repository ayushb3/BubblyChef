'use client'

/**
 * Issue #745 — a recipe's method in the timeline's solid / hatched language.
 * Shared by the library's recipe detail (`RecipePage.tsx`) and the full
 * `/recipes/[id]` page so a recipe's steps look the same wherever you open it.
 *
 * A step you do is SOLID (a pastel-tinted card with an ink edge); a hands-off
 * step (already cooking) is HATCHED with a dashed edge. Each structured step
 * also prints its hands-on / hands-off chip and its minutes, so the look is
 * never the only signal. Steps with no structure (`steps` absent, or shorter
 * than `instructions`) are plain solid rows with no chip.
 *
 * Contract: `instructions` is the ordered text; `steps` (issue #648) is the
 * parallel structured array, matched by index. `showTimers` (default true)
 * adds each step's ⏱ quick-set chip (issue #495).
 */

import { motion } from 'framer-motion'
import { useMotionConfig } from '@/lib/motion'
import StepTimerChips from '@/components/timers/StepTimerChip'
import HandsChip from '@/components/meal/HandsChip'
import { HATCHED, SOLID_EDGE } from '@/components/meal/dish-style'
import type { Step } from '@/types/recipes'

export interface RecipeStepsProps {
  instructions: (string | { text?: string; step?: string })[]
  steps?: Step[] | null
  showTimers?: boolean
}

export default function RecipeSteps({ instructions, steps, showTimers = true }: RecipeStepsProps) {
  const { reduced } = useMotionConfig()
  if (instructions.length === 0) return null

  return (
    <ol className="flex flex-col gap-2">
      {instructions.map((step, i) => {
        const text = typeof step === 'string' ? step : (step.text ?? step.step ?? '')
        const structured = steps?.[i]
        const handsOff = structured ? !structured.hands_on : false
        return (
          <motion.li
            key={i}
            data-testid="recipe-step"
            data-look={handsOff ? 'hatched' : 'solid'}
            className={`flex items-start gap-3 rounded-[10px] px-3 py-2.5 text-sm text-[color:var(--color-text)] ${
              handsOff
                ? HATCHED
                : `${SOLID_EDGE} bg-[color-mix(in_srgb,var(--color-primary)_30%,var(--color-surface))]`
            }`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: 0.25 }}
          >
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] text-xs font-extrabold"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 leading-6">
              {text}
              <span className="mt-1 flex flex-wrap items-center gap-2 empty:hidden">
                {structured && (
                  <>
                    <HandsChip handsOn={structured.hands_on} />
                    <span className="text-xs font-bold tabular-nums">{structured.duration_minutes} min</span>
                  </>
                )}
                {showTimers && <StepTimerChips stepText={text} />}
              </span>
            </span>
          </motion.li>
        )
      })}
    </ol>
  )
}
