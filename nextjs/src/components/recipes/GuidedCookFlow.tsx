'use client'

/**
 * GuidedCookFlow — production fold of Variant E from the #273 prototype.
 *
 * Variant E won the #273 design decision. See:
 *   nextjs/src/app/cook-prototype/NOTES.md (verdict)
 *   nextjs/src/app/cook-prototype/VariantE.tsx  (prototype source)
 *
 * Key design decisions carried from the prototype:
 *  - One step at a time in a content-sized card (not full-page).
 *  - Optional skippable mise-en-place screen before step 1 (idx = PREP = -1).
 *  - Progress dots fill ✓ as steps complete.
 *  - "You'll need" per-step ingredient list; pantry note only when notable.
 *  - Persistent "💬 Ask Bubbles about this step" → chat overlay returns to same step.
 *  - Dedicated done-state exits the flow cleanly.
 *  - Step ⏱ chips (issue #495 / Spec B.3) — real, functional timers replacing
 *    the old non-functional placeholder.
 *
 * Wiring to Spec 0 session state (issue #410):
 *  The Ask-Bubbles overlay sends a pre-canned context message over the real
 *  chat stream but does NOT pin the recipe to a persisted conversation here —
 *  the backend does read a structured `ChatRequest.context` field
 *  (`models/requests.py`) and the streaming route passes it through; this
 *  single-recipe cook flow just chooses to send none, unlike the meal cook
 *  page's pinned overlay (issue #654 PR B). Full session-pinned wiring for
 *  *this* flow is stubbed with TODO(#410) comments below.
 */

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import BubblesMascot from '@/components/ui/BubblesMascot'
import { ingredientLabel } from '@/lib/recipe-helpers'
import { useMotionConfig } from '@/lib/motion'
import { ensureSteps } from '@/lib/api/recipes'
import { saveCookProgress } from '@/lib/cook-session'
import StepTimerChips, { StructuredStepTimerChip } from '@/components/timers/StepTimerChip'
import { useRaiseTimerDock, useTimerDockRaised } from '@/components/timers/TimerDockLayer'
import { useCookingTimers } from '@/lib/useCookingTimers'
import AskBubblesOverlay from '@/components/cook/AskBubblesOverlay'
import type { Recipe } from './RecipePage'
import type { Step } from '@/types/recipes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single cooking step extracted from the recipe's `instructions` field.
 * Both the plain-string and object shapes from the DB are normalised here.
 */
interface CookStep {
  n: number
  text: string
  /**
   * Ingredient names that this step uses, matched by position to the recipe's
   * ingredient list.  Populated via a simple keyword scan — good enough for
   * the "You'll need" display; does not deduct from pantry.
   *
   * TODO(#410): when Spec 0 session state lands, step_uses could be computed
   * server-side against the real cook proposal's match results.
   */
  uses: string[]
  /**
   * The matching structured step (issue #648), when the recipe has them and
   * the count lines up 1:1 with `instructions` — the shape the validators on
   * the AI service side guarantee. `null` means "use the regex duration
   * parser on `text` instead", either because the recipe has no structured
   * steps yet or because they haven't finished (or failed) ensuring.
   */
  structured: Step | null
}

// The PREP sentinel lives before step 0; -1 keeps arithmetic trivial.
const PREP = -1

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a normalised text string from a recipe instruction element.
 * The DB stores instructions as either plain strings or `{ text?, step? }` objects.
 */
function stepText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if (typeof o.step === 'string') return o.step
  }
  return ''
}

/**
 * Build the step list from the recipe, annotating each step with the
 * ingredient names it likely uses (keyword scan over ingredient labels) and,
 * when available, its matching structured step (issue #648).
 *
 * `structuredSteps` is only trusted when its length matches
 * `recipe.instructions` — the AI service's own validators reject a
 * mismatched set before it's ever persisted, but a defensive length check
 * here means a step list that somehow got out of sync falls back to the
 * regex parser for every step rather than zipping steps to the wrong text.
 */
function buildSteps(recipe: Recipe, structuredSteps: Step[] | null): CookStep[] {
  const ingredientNames = recipe.ingredients.map((ing) => ingredientLabel(ing))
  const useStructured =
    !!structuredSteps && structuredSteps.length === recipe.instructions.length

  return recipe.instructions.map((raw, i) => {
    const text = stepText(raw)
    const lower = text.toLowerCase()

    // Associate an ingredient with this step if its name appears in the step text.
    const uses = ingredientNames.filter((name) => {
      const nameLower = name.toLowerCase()
      // Match on the bare name portion (strip leading quantity/unit words).
      const words = nameLower.split(/\s+/)
      return words.some((w) => w.length > 2 && lower.includes(w))
    })

    return { n: i + 1, text, uses, structured: useStructured ? structuredSteps![i] : null }
  })
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Ingredients list shown on the mise-en-place prep screen. */
function PrepIngredientList({ recipe }: { recipe: Recipe }) {
  if (recipe.ingredients.length === 0) return null
  return (
    <ul className="space-y-1 mt-3">
      {recipe.ingredients.map((ing, i) => {
        const label = ingredientLabel(ing)
        return (
          <li key={i} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}>
            <span
              className="flex-shrink-0 w-2 h-2 rounded-full"
              style={{ background: 'var(--color-primary)' }}
            />
            {label}
          </li>
        )
      })}
    </ul>
  )
}

/** "You'll need" block — shows per-step ingredients; pantry context only when notable. */
function YoullNeedBlock({ uses }: { uses: string[] }) {
  if (uses.length === 0) return null
  return (
    <div
      className="rounded-2xl px-4 py-3 mt-4"
      style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-wide mb-2"
        style={{ color: 'var(--color-muted)' }}
      >
        You&rsquo;ll need
      </p>
      {uses.map((name) => (
        <div key={name} className="py-0.5">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {name}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Progress dot bar — dots fill ✓ as steps complete. */
function ProgressDots({ steps, idx }: { steps: CookStep[]; idx: number }) {
  const isPrep = idx === PREP
  return (
    <div className="flex items-center gap-1.5" role="progressbar" aria-label={`Step ${idx + 1} of ${steps.length}`}>
      {steps.map((s, i) => {
        const complete = !isPrep && i < idx
        const current = !isPrep && i === idx
        return (
          <span
            key={s.n}
            className="rounded-full flex items-center justify-center transition-all"
            aria-label={complete ? `Step ${i + 1} complete` : current ? `Step ${i + 1} current` : `Step ${i + 1}`}
            style={{
              width: current ? 24 : 16,
              height: 16,
              fontSize: 10,
              fontWeight: 800,
              color: '#fff',
              background: complete
                ? 'var(--color-accent-dark)'
                : current
                ? 'var(--color-primary-dark)'
                : 'var(--color-border)',
            }}
          >
            {complete ? '✓' : ''}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Done state
// ---------------------------------------------------------------------------

function DoneState({ recipe, onExit, onFinish }: { recipe: Recipe; onExit: () => void; onFinish?: () => void }) {
  return (
    <div
      className="rounded-3xl text-center py-8 px-6"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-soft)',
        fontFamily: 'Nunito, sans-serif',
      }}
      data-testid="guided-cook-done"
    >
      <div className="flex justify-center mb-3">
        <BubblesMascot state="celebrate" size={90} />
      </div>
      <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--color-text)' }}>
        Nicely done!
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
        You cooked {recipe.title}.
        {onFinish
          ? ' Update your pantry to reflect what you used.'
          : ''}
      </p>
      {/* Primary action: hand off to the CookModal deduction flow so the
          guided path ends where the pantry gets updated (issue #263). Falls
          back to a plain exit when no deduction handoff is wired. */}
      {onFinish && (
        <button
          onClick={onFinish}
          className="rounded-full px-6 py-2.5 font-bold text-sm active:scale-95 transition-transform mb-3 w-full"
          style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
          data-testid="guided-cook-deduct"
        >
          Update my pantry 🧺
        </button>
      )}
      <button
        onClick={onExit}
        className="rounded-full px-6 py-2.5 font-bold text-sm active:scale-95 transition-transform"
        style={
          onFinish
            ? { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }
            : { background: 'var(--color-primary)', color: 'var(--color-text)' }
        }
        data-testid="guided-cook-exit"
      >
        {onFinish ? 'Skip for now' : 'Back to recipe'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GuidedCookFlow — main component
// ---------------------------------------------------------------------------

export interface GuidedCookFlowProps {
  recipe: Recipe
  /** Called when the user exits the done-state — returns them to the recipe view. */
  onExit: () => void
  /**
   * Called when the user finishes cooking and chooses to update their pantry.
   * Wires the guided flow's done-state into the CookModal deduction flow so the
   * cook story ends where stock is adjusted (issue #263). When omitted, the
   * done-state shows only a plain exit.
   */
  onFinish?: () => void
  /**
   * Step index to resume at on mount (issue #441) — the caller looks this up
   * from `getActiveCookSession(recipe.id)` before rendering. Defaults to the
   * prep screen for a fresh session. Only consulted on first mount.
   */
  initialStep?: number
  /**
   * Called once, the first time this open's `ensureSteps` call resolves
   * structured steps for a recipe that had none (issue #648). Lets the
   * caller persist the result onto its own copy of the recipe — e.g. a
   * local-override map keyed by recipe id, the same pattern `RecipeBook`
   * already uses for optimistic favourite toggles — so re-opening guided
   * cook mode again in the same session doesn't repeat the ensure call.
   * The steps are already durably saved server-side by this point; this is
   * purely a same-session cache, not a write.
   */
  onStepsResolved?: (steps: Step[]) => void
}

export default function GuidedCookFlow({
  recipe,
  onExit,
  onFinish,
  initialStep,
  onStepsResolved,
}: GuidedCookFlowProps) {
  const { springs } = useMotionConfig()
  const [idx, setIdx] = useState<number>(initialStep ?? PREP)
  const [chatOpen, setChatOpen] = useState(false)
  // True from the moment Ask Bubbles opens until its exit animation finishes
  // (AnimatePresence `onExitComplete`), so the dock stays under the fading
  // overlay instead of flashing over it.
  const [chatPresent, setChatPresent] = useState(false)

  // Issue #657: hold the global timer dock above this full-screen flow so a
  // timer started here is visible. Dropped while Ask Bubbles is open: that
  // overlay lives inside this root's stacking context, so the only way to
  // keep it above the dock is to stop raising the dock. All three hooks sit
  // above the empty-steps early return so both returns raise it and the hook
  // order is stable.
  useRaiseTimerDock(!chatOpen && !chatPresent)
  const dockRaised = useTimerDockRaised()
  const { timers } = useCookingTimers()
  const dockClearance = dockRaised && timers.length > 0

  // Structured steps (issue #648). `recipe.steps` is the source of truth
  // when present — `null`/absent means "not yet structured", which is
  // exactly when the ensure call below fires. `enabled` plus react-query's
  // own per-queryKey caching is what makes this "call once per recipe per
  // session": a re-render (e.g. from `idx` changing on every step) does not
  // re-fire it, and neither does remounting this component for the same
  // recipe id within the query's cache lifetime.
  const hasOwnSteps = Array.isArray(recipe.steps) && recipe.steps.length > 0
  const ensureQuery = useQuery({
    queryKey: ['ensure-recipe-steps', recipe.id],
    queryFn: () => ensureSteps(recipe.id),
    enabled: !hasOwnSteps,
    staleTime: Infinity,
    retry: false,
  })

  // Bubble a freshly-ensured result up to the caller exactly once. Guarded
  // by a ref (not just `onStepsResolved` being defined) so a parent that
  // re-renders for an unrelated reason — or a `useQuery` cache hit replaying
  // the same `data` — never fires the callback twice for one resolution.
  const reportedRef = useRef(false)
  useEffect(() => {
    if (ensureQuery.data && !reportedRef.current) {
      reportedRef.current = true
      onStepsResolved?.(ensureQuery.data.steps)
    }
  }, [ensureQuery.data, onStepsResolved])

  const structuredSteps: Step[] | null = recipe.steps ?? ensureQuery.data?.steps ?? null
  const steps = buildSteps(recipe, structuredSteps)

  // #441 — persist the step position on every change so a full page reload
  // (refresh, restored tab, a backgrounded mobile tab getting reclaimed) can
  // rehydrate at the same step instead of silently discarding progress.
  // `saveCookProgress` itself no-ops once the session is recorded as ended,
  // so this can't resurrect a confirmed cook (#440).
  useEffect(() => {
    saveCookProgress(recipe.id, idx)
  }, [recipe.id, idx])

  const isPrep = idx === PREP
  const isDone = steps.length > 0 && idx >= steps.length
  const step = !isPrep && !isDone ? steps[idx] : null

  // Prevent body scroll while the flow is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const goNext = () => setIdx((i) => i + 1)
  const goBack = () => setIdx((i) => Math.max(PREP, i - 1))

  // Empty recipe guard — if the recipe has no instructions, skip to done.
  if (steps.length === 0) {
    return (
      <div
        className="fixed inset-0 z-[9990] flex flex-col"
        style={{ background: 'var(--color-bg)' }}
        data-testid="guided-cook-flow"
      >
        <div className="flex-1 flex items-center justify-center px-5">
          <DoneState recipe={recipe} onExit={onExit} onFinish={onFinish} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[9990] flex flex-col"
      style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}
      data-testid="guided-cook-flow"
    >
      {/* ─── Header: recipe title + progress dots ─── */}
      {!isDone && (
        <motion.div
          className="max-w-[480px] w-full mx-auto px-5 pt-5"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.snappy}
        >
          {/* Locked recipe card header (#269 — flow replaces card as strongest lock) */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={onExit}
              className="flex items-center gap-1 text-xs font-semibold active:opacity-70 transition-opacity"
              style={{ color: 'var(--color-muted)' }}
              aria-label="Exit guided cooking"
              data-testid="guided-cook-exit-header"
            >
              ✕
            </button>
            <p
              className="text-sm font-extrabold truncate flex-1"
              style={{ color: 'var(--color-text)' }}
            >
              {recipe.title}
            </p>
            <span
              className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5 shrink-0"
              style={{ background: 'var(--color-surface)', color: 'var(--color-primary-dark)', border: '1px solid var(--color-border)' }}
            >
              🍳 cooking
            </span>
          </div>
          <ProgressDots steps={steps} idx={idx} />
        </motion.div>
      )}

      {/* ─── Body: content-sized card ─── */}
      {/* While the timer dock floats over this flow, pad the bottom so the
          last line, the timer chips and Ask Bubbles can scroll clear of the
          collapsed dock. */}
      <div
        className={`flex-1 flex items-center justify-center px-5 overflow-y-auto ${
          dockClearance ? 'pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))]' : 'py-6'
        }`}
      >
        <div className="w-full max-w-[440px]">
          <AnimatePresence mode="wait">
            {isPrep && (
              <motion.div
                key="prep"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={springs.snappy}
                className="rounded-3xl px-5 py-5"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  boxShadow: 'var(--shadow-soft)',
                }}
                data-testid="guided-cook-prep"
              >
                <p
                  className="text-xs font-bold uppercase tracking-wide mb-1"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Before you start &middot; optional
                </p>
                <h2
                  className="text-xl font-extrabold mb-3"
                  style={{ color: 'var(--color-text)' }}
                >
                  Get your ingredients ready 🧺
                </h2>
                {recipe.servings && (
                  <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                    Serves {recipe.servings}
                  </p>
                )}
                <PrepIngredientList recipe={recipe} />
              </motion.div>
            )}

            {step && (
              <motion.div
                key={`step-${step.n}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={springs.snappy}
                className="rounded-3xl px-5 py-5"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  boxShadow: 'var(--shadow-soft)',
                }}
                data-testid={`guided-cook-step-${step.n}`}
              >
                {/* Step header */}
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                    style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
                    aria-hidden="true"
                  >
                    {step.n}
                  </span>
                  <span
                    className="text-xs font-bold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Step {step.n} of {steps.length}
                  </span>
                  {/* Step timing (issue #648): a structured hands-off step gets a
                      real timer chip named with its own label; a structured
                      hands-on step shows its duration as plain text, no chip
                      (starting a timer would just distract from a step that
                      needs active attention). A step with no structured data
                      yet — steps still `null`, or the ensure call is pending
                      or failed — falls back to the regex chip (issue #495),
                      which renders nothing when the text has no parseable
                      duration. */}
                  <span className="ml-auto">
                    {step.structured ? (
                      step.structured.hands_on ? (
                        <span
                          className="text-xs font-bold"
                          style={{ color: 'var(--color-muted)' }}
                          data-testid="step-duration-text"
                        >
                          {step.structured.duration_minutes} min
                        </span>
                      ) : (
                        <StructuredStepTimerChip
                          label={step.structured.label}
                          durationMinutes={step.structured.duration_minutes}
                        />
                      )
                    ) : (
                      <StepTimerChips stepText={step.text} />
                    )}
                  </span>
                </div>

                {/* Step body */}
                <p
                  className="text-lg font-semibold leading-relaxed mb-4"
                  style={{ color: 'var(--color-text)' }}
                  data-testid="guided-cook-step-text"
                >
                  {step.text}
                </p>

                {/* "You'll need" block — recipe framing, not inventory diff */}
                <YoullNeedBlock uses={step.uses} />

                {/* Ask Bubbles — chat always one tap away */}
                <button
                  onClick={() => {
                    setChatOpen(true)
                    setChatPresent(true)
                  }}
                  className="mt-4 w-full rounded-full py-2.5 text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  style={{ background: 'var(--color-accent)', color: 'var(--color-text)' }}
                  data-testid="guided-cook-ask-bubbles"
                  aria-label="Ask Bubbles about this step"
                >
                  💬 Ask Bubbles about this step
                </button>
              </motion.div>
            )}

            {isDone && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={springs.snappy}
              >
                <DoneState recipe={recipe} onExit={onExit} onFinish={onFinish} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ─── Footer nav ─── */}
      {!isDone && (
        <div className="sticky bottom-0 w-full">
          <div
            className="max-w-[480px] mx-auto px-5 py-4 flex gap-3"
            style={{ background: 'linear-gradient(to top, var(--color-bg) 70%, transparent)' }}
          >
            <button
              onClick={goBack}
              disabled={isPrep}
              className="flex-1 rounded-full py-3 font-bold text-sm disabled:opacity-30 active:scale-95 transition-transform"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontFamily: 'Nunito, sans-serif',
              }}
              data-testid="guided-cook-back"
              aria-label="Previous step"
            >
              Back
            </button>
            <button
              onClick={goNext}
              className="flex-[2] rounded-full py-3 font-bold text-sm active:scale-95 transition-transform"
              style={{ background: 'var(--color-primary)', color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
              data-testid="guided-cook-next"
              aria-label={isPrep ? 'Skip prep and start cooking' : idx === steps.length - 1 ? 'Finish cooking' : 'Next step'}
            >
              {isPrep
                ? 'Skip prep — start cooking'
                : idx === steps.length - 1
                ? 'Finish cooking 🎉'
                : 'Next step →'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Ask-Bubbles overlay ─── */}
      <AnimatePresence onExitComplete={() => setChatPresent(false)}>
        {chatOpen && step && (
          <motion.div
            key="ask-bubbles"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <AskBubblesOverlay
              stepN={step.n}
              stepText={step.text}
              recipeTitle={recipe.title}
              onClose={() => setChatOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
