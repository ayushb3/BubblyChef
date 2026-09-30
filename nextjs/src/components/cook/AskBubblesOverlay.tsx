'use client'

/**
 * AskBubblesOverlay — the "💬 Ask Bubbles" chat sheet, extracted from
 * `GuidedCookFlow` (issue #654 PR B, §4 of
 * `docs/plans/2026-09-29-issue-654-b-meal-amendments-contract.md`).
 *
 * Two modes:
 *  - **Unpinned** (no `pinned` prop, GuidedCookFlow's single-recipe cook):
 *    behaves exactly as before this extraction. The request is
 *    `{ message, conversation_id: null, follow_up_chips: false }` — no
 *    `context` key — and no amendment card is ever rendered.
 *  - **Pinned** (the meal cook page's per-dish Ask Bubbles): every turn
 *    carries a stable `conversation_id` (minted once per mount) and
 *    `context.cooking_recipe`, read from the *current* `pinned` prop at send
 *    time, so a stacked amendment (or a live servings change) is reflected on
 *    the next question. A reply whose proposal is a matching
 *    `RecipeAmendmentProposal` renders an actionable card under the assistant
 *    bubble; only the latest such card stays actionable.
 *
 * The backend DOES read `ChatRequest.context` (`models/requests.py`) and the
 * streaming route (`workflows/router.py`) passes it through — the unpinned
 * mode simply chooses to send none, so a single-recipe cook's questions never
 * pin a conversation or pay for amendment detection.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { streamChatMessage } from '@/lib/api/chat'
import { isRecipeAmendmentProposal, type ChatRequest } from '@/types/chat'
import type { MealCookIngredient } from '@/types/meals'

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
  onUse,
  onKeep,
}: {
  amendment: AmendmentState
  pinnedTitle: string
  isLatest: boolean
  onUse: () => void
  onKeep: () => void
}) {
  const cardStyle = {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    fontFamily: 'Nunito, sans-serif',
  } as const

  if (amendment.resolution === 'applied') {
    return (
      <div className="flex justify-start">
        <div
          className="rounded-2xl px-3.5 py-2.5 text-xs max-w-[80%] mt-1"
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
          className="rounded-2xl px-3.5 py-2.5 text-xs max-w-[80%] mt-1"
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
        className="rounded-2xl px-3.5 py-3 text-sm max-w-[85%] mt-1"
        style={cardStyle}
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
              className="min-h-[44px] rounded-full px-3.5 font-bold text-xs active:scale-95 transition-transform"
              style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
              data-testid="ask-bubbles-amendment-use"
            >
              Use this change
            </button>
            <button
              type="button"
              onClick={onKeep}
              className="min-h-[44px] rounded-full px-3.5 font-bold text-xs active:scale-95 transition-transform"
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
}: AskBubblesOverlayProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<OverlayMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Minted once per mount (a ref, not state — nothing needs to re-render off
  // it), and reused on every turn while pinned so the backend threads the
  // whole conversation against one session.
  const conversationIdRef = useRef<string | null>(null)
  if (conversationIdRef.current === null) {
    conversationIdRef.current = crypto.randomUUID()
  }

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

    // Fold the step context into the message body — this framing is sent in
    // both modes. Pinned mode additionally attaches `context.cooking_recipe`
    // and a stable `conversation_id` so the backend can pin the turn and
    // detect an amendment against it (issue #654 PR B).
    const framedMessage =
      `While cooking "${recipeTitle}", on step ${stepN} ("${stepBodyText}"), ` +
      `I have a question: ${text}`

    const request: ChatRequest = {
      message: framedMessage,
      conversation_id: pinned ? conversationIdRef.current : null,
      // The cook overlay shows no follow-up chips, so don't pay for them (#498).
      follow_up_chips: false,
    }
    if (pinned) {
      request.context = {
        cooking_recipe: {
          id: pinned.recipe_id,
          title: pinned.title,
          ingredients: pinned.ingredients,
        },
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
          assistantMsg.amendment = {
            changeSummary: response.proposal.change_summary,
            recipeId: response.proposal.recipe_id,
            amendedIngredients: response.proposal.amended_ingredients.map(
              ({ name, quantity, unit, optional, notes }) => ({ name, quantity, unit, optional, notes }),
            ),
            resolution: 'pending',
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
  }, [input, streaming, stepN, stepBodyText, recipeTitle, pinned])

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
  }

  const handleKeepOriginal = (index: number) => {
    resolveAmendment(index, 'kept')
  }

  // Only the latest amendment card is actionable — a newer one supersedes it.
  let latestAmendmentIndex = -1
  messages.forEach((m, i) => {
    if (m.amendment) latestAmendmentIndex = i
  })

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
          {pinned ? `Asking about ${pinned.title}` : `Asking about step ${stepN}`}
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
            <div key={i}>
              <ChatBubble who={m.role}>{m.text}</ChatBubble>
              {m.amendment && (
                <AmendmentCard
                  amendment={m.amendment}
                  pinnedTitle={pinned?.title ?? recipeTitle}
                  isLatest={i === latestAmendmentIndex}
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
