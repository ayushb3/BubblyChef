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
 *  The Ask-Bubbles overlay currently sends a pre-canned context message over the
 *  real chat stream but does NOT pin the recipe to a persisted conversation.
 *  Full session-pinned wiring is stubbed with TODO(#410) comments below.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import { ingredientLabel } from '@/lib/recipe-helpers'
import { useMotionConfig } from '@/lib/motion'
import { streamChatMessage } from '@/lib/api/chat'
import { saveCookProgress } from '@/lib/cook-session'
import StepTimerChips from '@/components/timers/StepTimerChip'
import type { Recipe } from './RecipePage'

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
 * ingredient names it likely uses (keyword scan over ingredient labels).
 */
function buildSteps(recipe: Recipe): CookStep[] {
  const ingredientNames = recipe.ingredients.map((ing) => ingredientLabel(ing))

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

    return { n: i + 1, text, uses }
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
// Ask-Bubbles overlay
// ---------------------------------------------------------------------------

interface AskBubblesOverlayProps {
  stepN: number
  stepText: string
  recipeTitle: string
  onClose: () => void
}

interface OverlayMessage {
  role: 'user' | 'assistant'
  text: string
}

function AskBubblesOverlay({ stepN, stepText: stepBodyText, recipeTitle, onClose }: AskBubblesOverlayProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<OverlayMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setStreaming(true)
    setStreamingText('')
    setError(null)

    abortRef.current = new AbortController()

    let accumulated = ''

    // Fold the step context into the message body. The backend ChatRequest
    // only accepts mode ∈ chat|recipe|learn|text|voice and does not read a
    // structured `context` field, so a bespoke `mode`/`context` payload would
    // 422 (or be silently ignored). We default to the "chat" mode and prepend
    // the step framing as plain text so Bubbles answers about this step.
    // TODO(#410): when Spec 0 session state lands, pass the pinned
    // conversation_id here so the step question threads into the cooking session.
    const framedMessage =
      `While cooking "${recipeTitle}", on step ${stepN} ("${stepBodyText}"), ` +
      `I have a question: ${text}`

    await streamChatMessage(
      {
        message: framedMessage,
        conversation_id: null, // TODO(#410): use pinned session conversation_id
        // The cook overlay shows no follow-up chips, so don't pay for them (#498).
        follow_up_chips: false,
      },
      (token) => {
        accumulated += token
        setStreamingText(accumulated)
      },
      (response) => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: response.assistant_message || accumulated },
        ])
        setStreamingText('')
        setStreaming(false)
      },
      (err) => {
        setError(err.message)
        setStreaming(false)
        setStreamingText('')
      },
      abortRef.current.signal,
    )
  }, [input, streaming, stepN, stepBodyText, recipeTitle])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex flex-col justify-end"
      style={{ background: 'var(--color-backdrop)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Ask Bubbles about step ${stepN}`}
        className="w-full max-w-[480px] mx-auto rounded-t-3xl px-5 pt-3 pb-6 flex flex-col"
        style={{ background: 'var(--color-surface)', maxHeight: '75vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex items-center mb-3">
          <span className="w-10 h-1.5 rounded-full mx-auto" style={{ background: 'var(--color-border)' }} />
        </div>

        <p
          className="text-xs font-bold uppercase tracking-wide mb-3"
          style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
        >
          Asking about step {stepN}
        </p>

        {/* Message thread */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-4 min-h-0">
          {messages.length === 0 && !streaming && (
            <p
              className="text-sm text-center py-4"
              style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
            >
              Ask Bubbles anything about this step!
            </p>
          )}
          {messages.map((m, i) => (
            <ChatBubble key={i} who={m.role}>
              {m.text}
            </ChatBubble>
          ))}
          {streaming && streamingText && (
            <ChatBubble who="assistant">{streamingText}</ChatBubble>
          )}
          {streaming && !streamingText && (
            <ChatBubble who="assistant">
              <span className="animate-pulse">…</span>
            </ChatBubble>
          )}
          {error && (
            <p
              className="text-xs text-center py-2"
              style={{ color: '#D9534F', fontFamily: 'Nunito, sans-serif' }}
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        {/* Input row */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this step…"
            disabled={streaming}
            className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none disabled:opacity-60"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
              fontFamily: 'Nunito, sans-serif',
            }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || streaming}
            aria-label="Send question"
            className="rounded-full px-4 font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform"
            style={{
              background: 'var(--color-primary)',
              color: 'var(--color-text)',
              fontFamily: 'Nunito, sans-serif',
            }}
          >
            Send
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-3 w-full text-sm font-bold active:opacity-70 transition-opacity"
          style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
          aria-label={`Back to step ${stepN}`}
        >
          &darr; Back to step {stepN}
        </button>
      </div>
    </div>
  )
}

function ChatBubble({ who, children }: { who: 'user' | 'assistant'; children: React.ReactNode }) {
  const isMe = who === 'user'
  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div
        className="rounded-2xl px-3.5 py-2 text-sm max-w-[80%]"
        style={{
          background: isMe ? 'var(--color-primary)' : 'var(--color-bg)',
          border: isMe ? 'none' : '1px solid var(--color-border)',
          color: 'var(--color-text)',
          fontFamily: 'Nunito, sans-serif',
        }}
      >
        {children}
      </div>
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
}

export default function GuidedCookFlow({ recipe, onExit, onFinish, initialStep }: GuidedCookFlowProps) {
  const { springs } = useMotionConfig()
  const steps = buildSteps(recipe)
  const [idx, setIdx] = useState<number>(initialStep ?? PREP)
  const [chatOpen, setChatOpen] = useState(false)

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
      <div className="flex-1 flex items-center justify-center px-5 py-6 overflow-y-auto">
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
                  {/* Step ⏱ chips — renders only when the step text has a
                      parseable duration (issue #495). */}
                  <span className="ml-auto">
                    <StepTimerChips stepText={step.text} />
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
                  onClick={() => setChatOpen(true)}
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
      <AnimatePresence>
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
