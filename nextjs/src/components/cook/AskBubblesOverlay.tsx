'use client'

/**
 * AskBubblesOverlay — the "💬 Ask Bubbles" chat sheet, extracted from
 * `GuidedCookFlow` (issue #654 PR B, §4 of
 * `docs/plans/2026-09-29-issue-654-b-meal-amendments-contract.md`).
 *
 * Two modes:
 *  - **Unpinned** (no `pinned` prop, GuidedCookFlow's single-recipe cook): no
 *    amendment card is ever rendered. Given `cookContext` (the dish) and a
 *    per-cook-session `conversationId`, each turn carries them as
 *    `context.cooking_recipe` + `conversation_id`, so the model sees the
 *    dish's ingredients and remembers the earlier questions (issue #814).
 *    Without them the request is `{ message, conversation_id: null,
 *    follow_up_chips: false }`, as before this extraction.
 *  - **Pinned** (the meal cook page's per-dish Ask Bubbles): every turn
 *    carries a stable `conversation_id` (minted once per mount) and
 *    `context.cooking_recipe`, read from the *current* `pinned` prop at send
 *    time, so a stacked amendment (or a live servings change) is reflected on
 *    the next question. A reply whose proposal is a matching
 *    `RecipeAmendmentProposal` renders an actionable card under the assistant
 *    bubble; only the latest such card stays actionable.
 *
 * The backend reads `ChatRequest.context` (`models/requests.py`) and the
 * streaming route (`workflows/router.py`) passes it through. A meal cook also
 * passes `mealConstraints` (the meal's stored planning constraints), sent as
 * `context.meal_constraints`: read-only background for the cooking prompt, so
 * what the user said while planning (an allergy, "one pan") still applies. The
 * cook Q&A never joins the planning conversation (issue #814).
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useReducedMotion } from 'framer-motion'
import PixelSheet from '@/components/ui/PixelSheet'
import { streamChatMessage } from '@/lib/api/chat'
import { isRecipeAmendmentProposal, type ChatRequest } from '@/types/chat'
import type { MealConstraints, MealCookIngredient } from '@/types/meals'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The dish this overlay instance is pinned to (meal cook only). */
export interface AskBubblesPin {
  recipe_id: string
  title: string
  /** The dish's current list at recipe scale (pinnedIngredientsForDish). Read at send time. */
  ingredients: (string | MealCookIngredient)[]
}

/** The mapped, ready-to-store shape of an applied amendment. */
export interface AskBubblesAmendment {
  recipe_id: string
  ingredients: MealCookIngredient[]
  change_summary: string | null
}

export interface AskBubblesOverlayProps {
  stepN: number
  stepText: string
  recipeTitle: string
  onClose: () => void
  pinned?: AskBubblesPin
  onApplyAmendment?: (a: AskBubblesAmendment) => void
  /**
   * Single-recipe cook (unpinned): the dish being cooked. Sent as
   * `context.cooking_recipe` so the model sees its ingredients. Never renders
   * an amendment card (there is nothing to apply it to). Read at send time.
   */
  cookContext?: AskBubblesPin
  /**
   * One conversation id for the whole cook session, so the overlay keeps its
   * memory when it is closed and reopened. When absent, the overlay mints one
   * per mount (the meal cook's behaviour).
   */
  conversationId?: string
  /** Meal cook: the meal's stored planning constraints, sent as `context.meal_constraints`. */
  mealConstraints?: MealConstraints
}

interface AmendmentState {
  changeSummary: string | null
  recipeId: string | null
  amendedIngredients: MealCookIngredient[]
  resolution: 'pending' | 'applied' | 'kept'
}

interface OverlayMessage {
  role: 'user' | 'assistant'
  text: string
  amendment?: AmendmentState
}

// ---------------------------------------------------------------------------
// Amendment card
// ---------------------------------------------------------------------------

function AmendmentCard({
  amendment,
  pinnedTitle,
  isLatest,
  streaming,
  autoFocusResolved,
  onUse,
  onKeep,
}: {
  amendment: AmendmentState
  pinnedTitle: string
  isLatest: boolean
  /** While a later question is streaming, a still-pending card's buttons must not fire (S2). */
  streaming: boolean
  /** True for the turn just resolved by the user — moves focus onto the resolved text (N4), never to `body`. */
  autoFocusResolved: boolean
  onUse: () => void
  onKeep: () => void
}) {
  const cardStyle = {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
  } as const

  const resolvedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocusResolved) resolvedRef.current?.focus()
  }, [autoFocusResolved])

  if (amendment.resolution === 'applied') {
    return (
      <div className="flex justify-start">
        <div
          ref={resolvedRef}
          tabIndex={-1}
          role="status"
          className="font-sans rounded-2xl px-3.5 py-2.5 text-xs max-w-[80%] mt-1 outline-none"
          style={{ ...cardStyle, color: 'var(--color-text)' }}
          data-testid="ask-bubbles-amendment-resolved"
        >
          Updated {pinnedTitle}. Your pantry update will use this.
        </div>
      </div>
    )
  }

  if (amendment.resolution === 'kept') {
    return (
      <div className="flex justify-start">
        <div
          ref={resolvedRef}
          tabIndex={-1}
          role="status"
          className="font-sans rounded-2xl px-3.5 py-2.5 text-xs max-w-[80%] mt-1 outline-none"
          style={{ ...cardStyle, color: 'var(--color-muted)' }}
          data-testid="ask-bubbles-amendment-resolved"
        >
          Kept the original ingredients.
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div
        className="font-sans rounded-2xl px-3.5 py-3 text-sm max-w-[85%] mt-1"
        style={cardStyle}
        role="status"
        data-testid="ask-bubbles-amendment-card"
      >
        <p className="font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
          {amendment.changeSummary || 'Bubbles suggests changing the ingredients'}
        </p>
        {isLatest && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onUse}
              disabled={streaming}
              className="min-h-[44px] rounded-full px-3.5 font-bold text-xs active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
              data-testid="ask-bubbles-amendment-use"
            >
              Use this change
            </button>
            <button
              type="button"
              onClick={onKeep}
              disabled={streaming}
              className="min-h-[44px] rounded-full px-3.5 font-bold text-xs active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              data-testid="ask-bubbles-amendment-keep"
            >
              Keep original
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export default function AskBubblesOverlay({
  stepN,
  stepText: stepBodyText,
  recipeTitle,
  onClose,
  pinned,
  onApplyAmendment,
  cookContext,
  conversationId: sessionConversationId,
  mealConstraints,
}: AskBubblesOverlayProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<OverlayMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The turn most recently resolved (Use this change / Keep original), so its
  // card can claim focus once — never left to drop back to `body` (N4).
  const [justResolvedIndex, setJustResolvedIndex] = useState<number | null>(null)

  // The dish whose ingredients ride along: the meal cook's pin, or a single
  // recipe cook's `cookContext`. Neither → the request stays context-free.
  const dish = pinned ?? cookContext

  // Minted once per mount, only when a dish is in play (otherwise nothing ever
  // sends it) — a lazy `useState` initializer, not a ref read during render
  // (which `react-hooks/refs` disallows even for a guarded once-only
  // assignment). A caller-owned per-cook-session id wins over the minted one.
  const [mintedConversationId] = useState<string | null>(() => (dish ? crypto.randomUUID() : null))
  const conversationId = dish ? (sessionConversationId ?? mintedConversationId) : null

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Issue #672: keep the newest turn (and a fresh amendment card's buttons) in
  // view. Scrolls the thread only, never the page behind the fixed overlay.
  // Deliberately not keyed on `streamingText`: token growth must not yank a
  // user who is reading back. It fires when a message is sent, when the typing
  // bubble appears, and when the assistant turn settles.
  const threadRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = threadRef.current
    el?.scrollTo?.({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [messages.length, streaming, reduced])

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

    // Fold the step context into the message body — this framing is sent in
    // both modes. Pinned mode additionally attaches `context.cooking_recipe`
    // and a stable `conversation_id` so the backend can pin the turn and
    // detect an amendment against it (issue #654 PR B).
    const framedMessage =
      `While cooking "${recipeTitle}", on step ${stepN} ("${stepBodyText}"), ` +
      `I have a question: ${text}`

    const request: ChatRequest = {
      message: framedMessage,
      conversation_id: conversationId,
      // The cook overlay shows no follow-up chips, so don't pay for them (#498).
      follow_up_chips: false,
    }
    if (dish) {
      request.context = {
        cooking_recipe: {
          id: dish.recipe_id,
          title: dish.title,
          ingredients: dish.ingredients,
        },
        ...(mealConstraints ? { meal_constraints: mealConstraints } : {}),
      }
    }

    await streamChatMessage(
      request,
      (token) => {
        accumulated += token
        setStreamingText(accumulated)
      },
      (response) => {
        const assistantMsg: OverlayMessage = {
          role: 'assistant',
          text: response.assistant_message || accumulated,
        }
        if (
          pinned &&
          isRecipeAmendmentProposal(response.proposal) &&
          response.proposal.recipe_id === pinned.recipe_id
        ) {
          // S1: the backend allows a blank `name` on an amended line (it's
          // `readDishAmendment` that rejects the whole amendment for one).
          // Drop those lines here instead, and skip the card entirely if
          // nothing usable survives — never claim "Updated…" over a change
          // that couldn't actually be applied.
          const amendedIngredients = response.proposal.amended_ingredients
            .map(({ name, quantity, unit, optional, notes }) => ({ name, quantity, unit, optional, notes }))
            .filter((ing) => ing.name.trim() !== '')
          if (amendedIngredients.length > 0) {
            assistantMsg.amendment = {
              changeSummary: response.proposal.change_summary,
              recipeId: response.proposal.recipe_id,
              amendedIngredients,
              resolution: 'pending',
            }
          }
        }
        setMessages((prev) => [...prev, assistantMsg])
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
  }, [input, streaming, stepN, stepBodyText, recipeTitle, pinned, dish, conversationId, mealConstraints])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const resolveAmendment = (index: number, resolution: 'applied' | 'kept') => {
    setMessages((prev) =>
      prev.map((m, i) => (i === index && m.amendment ? { ...m, amendment: { ...m.amendment, resolution } } : m)),
    )
  }

  const handleUseChange = (index: number, amendment: AmendmentState) => {
    if (amendment.recipeId) {
      onApplyAmendment?.({
        recipe_id: amendment.recipeId,
        ingredients: amendment.amendedIngredients,
        change_summary: amendment.changeSummary,
      })
    }
    resolveAmendment(index, 'applied')
    setJustResolvedIndex(index)
  }

  const handleKeepOriginal = (index: number) => {
    resolveAmendment(index, 'kept')
    setJustResolvedIndex(index)
  }

  // Only the latest amendment card is actionable — a newer one supersedes it.
  let latestAmendmentIndex = -1
  messages.forEach((m, i) => {
    if (m.amendment) latestAmendmentIndex = i
  })

  return (
    <PixelSheet
      open
      onClose={onClose}
      layer="cook"
      title="Ask Bubbles"
      ariaLabel={`Ask Bubbles about step ${stepN}`}
      subtitle={pinned ? `Asking about ${pinned.title}` : `Asking about step ${stepN}`}
      footer={
        <>
          {/* Input row */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this step…"
              disabled={streaming}
              className="font-sans flex-1 rounded-full px-4 py-2.5 text-sm outline-none disabled:opacity-60"
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || streaming}
              aria-label="Send question"
              className="font-sans rounded-full px-4 font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform"
              style={{
                background: 'var(--color-primary)',
                color: 'var(--color-text)',
              }}
            >
              Send
            </button>
          </div>

          <button
            onClick={onClose}
            className="font-sans mt-3 w-full text-sm font-bold active:opacity-70 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            aria-label={`Back to step ${stepN}`}
          >
            &darr; Back to step {stepN}
          </button>
        </>
      }
    >
      {/* Message thread */}
      <div
        ref={threadRef}
        data-testid="ask-bubbles-thread"
        className="max-h-[40dvh] min-h-0 overflow-y-auto space-y-2"
      >
        {messages.length === 0 && !streaming && (
          <p
            className="font-sans text-sm text-center py-4"
            style={{ color: 'var(--color-muted)' }}
          >
            Ask Bubbles anything about this step!
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <ChatBubble who={m.role}>{m.text}</ChatBubble>
            {m.amendment && (
              <AmendmentCard
                amendment={m.amendment}
                pinnedTitle={pinned?.title ?? recipeTitle}
                isLatest={i === latestAmendmentIndex}
                streaming={streaming}
                autoFocusResolved={i === justResolvedIndex}
                onUse={() => handleUseChange(i, m.amendment!)}
                onKeep={() => handleKeepOriginal(i)}
              />
            )}
          </div>
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
            className="font-sans text-xs text-center py-2"
            style={{ color: 'var(--color-danger)' }}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </PixelSheet>
  )
}

function ChatBubble({ who, children }: { who: 'user' | 'assistant'; children: React.ReactNode }) {
  const isMe = who === 'user'
  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div
        className="font-sans rounded-2xl px-3.5 py-2 text-sm max-w-[80%]"
        style={{
          background: isMe ? 'var(--color-primary)' : 'var(--color-bg)',
          border: isMe ? 'none' : '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
