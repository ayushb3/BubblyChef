'use client'

import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import RotatingPlaceholder from '@/components/chat/RotatingPlaceholder'
import MessageBubble from '@/components/chat/MessageBubble'
import PostMessageChips from '@/components/chat/PostMessageChips'
import CookingContextCard from '@/components/chat/CookingContextCard'
import ChatContextCard from '@/components/chat/ChatContextCard'
import TypingIndicator from '@/components/chat/TypingIndicator'
import ChatRecipeCard from '@/components/chat/ChatRecipeCard'
import PantryProposalCard from '@/components/chat/PantryProposalCard'
import ThemePicker from '@/components/ui/ThemePicker'
import Chip from '@/components/ui/Chip'
import EmptyState from '@/components/ui/EmptyState'
import { useChat } from '@/hooks/useChat'
import { checkAIHealth } from '@/lib/api/chat'
import { fetchRecipe } from '@/lib/api/recipes'
import { cookingContextForId, deriveChatSeed } from '@/lib/chat-seed'
import type { Recipe } from '@/components/recipes/RecipePage'
import type {
  ChatMessage,
  ChatRecipeData,
  PantryProposalData,
} from '@/types/chat'

const SUGGESTIONS = [
  'What can I make tonight? 🌙',
  'Quick weeknight dinner ⚡',
  'Use my expiring items 🍅',
  'Help me meal prep 📦',
]

const COOKING_SUGGESTIONS = [
  'What can I substitute? 🔁',
  'How do I prep this? 🔪',
  'How long does this take? ⏱️',
]

/**
 * `useSearchParams` opts the tree into client-side rendering, so the page shell
 * is a Suspense boundary around the real chat surface (Next.js 16 requirement).
 */
export default function ChatPage() {
  return (
    <Suspense fallback={<div className="h-screen" />}>
      <ChatSurface />
    </Suspense>
  )
}

function ChatSurface() {
  const {
    messages,
    isStreaming,
    proposalStates,
    sendMessage,
    cancelStream,
    startNewChat,
    approveProposal,
    rejectProposal,
  } = useChat()

  const router = useRouter()
  const searchParams = useSearchParams()
  // Set by the Cook flow: /chat?cooking=<recipeId>. Changing recipes changes
  // the param, so the context resets for free when the user cooks again.
  const cookingRecipeId = searchParams.get('cooking')

  // Deep-link seeds: /chat?tip=… (#143) and /chat?use=…&expires=… (#138).
  // Null for a bare /chat, which is what keeps the bottom-nav entry a clean,
  // empty conversation. The cook handoff wins if both are somehow present.
  const seed = useMemo(
    () => (cookingRecipeId ? null : deriveChatSeed(searchParams)),
    [cookingRecipeId, searchParams],
  )

  const [input, setInput] = useState('')
  const [aiAvailable, setAiAvailable] = useState(true)
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const [loadedRecipe, setLoadedRecipe] = useState<Recipe | null>(null)
  const [dismissedRecipeId, setDismissedRecipeId] = useState<string | null>(null)
  const [dismissedSeedKey, setDismissedSeedKey] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The recipe only needs to ride along on the first message — the backend
  // pins it to the conversation session for subsequent turns.
  const contextSentRef = useRef(false)
  // Same one-shot idiom for the seeded auto-send: fires once per mount, never
  // again on re-render, and never after the user has taken over the thread.
  const seedSentRef = useRef(false)

  // Check AI health on mount
  useEffect(() => {
    checkAIHealth()
      .then((h) => setAiAvailable(h.ai_available))
      .catch(() => setAiAvailable(false))
  }, [])

  // Load the recipe named by ?cooking=
  useEffect(() => {
    if (!cookingRecipeId) return
    let cancelled = false
    contextSentRef.current = false
    fetchRecipe(cookingRecipeId)
      .then((recipe) => {
        if (!cancelled) setLoadedRecipe(recipe)
      })
      .catch(() => {
        // Recipe unavailable — chat still works, just without the context card
        if (!cancelled) setLoadedRecipe(null)
      })
    return () => {
      cancelled = true
    }
  }, [cookingRecipeId])

  // Derived, not stored: the card shows only while the loaded recipe still
  // matches the URL param and hasn't been dismissed. Keeps a stale recipe from
  // flashing between navigations without clearing state inside an effect.
  const cookingRecipe =
    cookingRecipeId &&
    cookingRecipeId !== dismissedRecipeId &&
    loadedRecipe?.id === cookingRecipeId
      ? loadedRecipe
      : null

  /**
   * Attach the cook context to the first message of the conversation only.
   *
   * The payload is derived from `cookingRecipeId` — the `?cooking=<id>` param,
   * known synchronously on mount — NOT from `loadedRecipe`. The AI service
   * resolves the full recipe from this id server-side, so the pin no longer
   * races the client's `fetchRecipe` (#155): a message sent before the card
   * fills in still pins the session. `loadedRecipe` drives only the cosmetic
   * card below.
   */
  const takeCookingContext = (): Record<string, unknown> | undefined => {
    if (contextSentRef.current || isStreaming) return undefined
    const context = cookingContextForId(cookingRecipeId)
    if (!context) return undefined
    contextSentRef.current = true
    return { ...context }
  }

  // Auto-send the seeded question so a tap on the dashboard tip / an expiring
  // item lands straight on Bubbles' answer — the tap on the card is the "1 tap"
  // both #138 acceptance criteria budget for. The seed rides in the message
  // *text*, not a context payload: the AI service only honours `cooking_recipe`
  // as client context, and the must-use ingredient is recovered by an LLM pass
  // over the message itself.
  useEffect(() => {
    if (!seed || seedSentRef.current) return
    seedSentRef.current = true
    // The seed *is* the first message, so the cook-context slot is spent.
    contextSentRef.current = true
    sendMessage(seed.message)
  }, [seed, sendMessage])

  const dismissSeedCard = () => {
    // Hide immediately, then drop the params so a refresh doesn't resurrect the
    // card (or re-fire the auto-send on a fresh mount).
    setDismissedSeedKey(seed?.key ?? null)
    router.replace('/chat', { scroll: false })
  }

  const dismissCookingCard = () => {
    // Hide immediately, then drop the param so a refresh doesn't resurrect it.
    setDismissedRecipeId(cookingRecipeId)
    router.replace('/chat', { scroll: false })
  }

  const handleNewChat = () => {
    // New conversation — the backend session is gone, so resend the context.
    contextSentRef.current = false
    // A seeded banner over an empty thread would be a lie; drop it (and its
    // params) rather than leave it hanging. `seedSentRef` stays set so the
    // fresh thread doesn't surprise the user with another auto-sent question.
    if (seed) {
      setDismissedSeedKey(seed.key)
      router.replace('/chat', { scroll: false })
    }
    startNewChat()
  }

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Mascot state
  const mascotState = isStreaming ? 'thinking' : 'happy'

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendMessage(text, takeCookingContext())
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInput('')
    sendMessage(suggestion, takeCookingContext())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSaveRecipe = async (msgId: string, recipe: ChatRecipeData) => {
    setSaveStates((prev) => ({ ...prev, [msgId]: 'saving' }))
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          cuisine: recipe.cuisine,
          meal_type: recipe.meal_type,
          tags: [...new Set([...(recipe.dietary_tags ?? []), ...(recipe as { tags?: string[] }).tags ?? []])],
          difficulty: recipe.difficulty,
          prep_time_minutes: recipe.prep_time_minutes,
          cook_time_minutes: recipe.cook_time_minutes,
          total_time_minutes: recipe.total_time_minutes,
          servings: recipe.servings,
        }),
      })
      setSaveStates((prev) => ({ ...prev, [msgId]: res.ok ? 'saved' : 'error' }))
    } catch {
      setSaveStates((prev) => ({ ...prev, [msgId]: 'error' }))
    }
  }

  const handleTryAnother = () => {
    sendMessage('Give me a different recipe')
  }

  const handleTellMore = () => {
    sendMessage('Tell me more about that')
  }

  // Determine if the typing indicator should show
  // (streaming has started but no content yet on the last assistant message)
  const lastMsg = messages[messages.length - 1]
  const showTypingIndicator =
    isStreaming && lastMsg?.role === 'assistant' && !lastMsg.content

  const hasMessages = messages.length > 0

  // Derived like the cook card: shown until the user dismisses this exact seed.
  const activeSeed = seed && seed.key !== dismissedSeedKey ? seed : null

  return (
    <div className="flex flex-col h-screen pb-20">
      {/* Header */}
      <BubblesHeader
        mascotState={mascotState}
        mascotAnimate={isStreaming}
        rightSlot={
          <div className="flex items-center gap-2">
            {hasMessages && (
              <button
                type="button"
                onClick={handleNewChat}
                className="text-xs font-semibold text-[var(--color-primary-dark)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full hover:bg-[var(--color-border)] transition-colors"
              >
                New Chat
              </button>
            )}
            <ThemePicker />
          </div>
        }
      />

      {/* AI unavailable warning */}
      {!aiAvailable && (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl flex items-center gap-2 text-sm">
          <span>⚠️</span>
          <span className="text-[var(--color-text)]">
            AI is unavailable. Check your Gemini API key or start Ollama.
          </span>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Cook handoff context — dismissible, sits above the thread */}
        <AnimatePresence>
          {cookingRecipe && (
            <CookingContextCard
              title={cookingRecipe.title}
              ingredientCount={cookingRecipe.ingredients.length}
              onDismiss={dismissCookingCard}
            />
          )}
        </AnimatePresence>

        {/* Deep-link seed context (?tip= / ?use=) — same slot, same idiom */}
        <AnimatePresence>
          {activeSeed && (
            <ChatContextCard
              key={activeSeed.key}
              emoji={activeSeed.card.emoji}
              label={activeSeed.card.label}
              title={activeSeed.card.title}
              subtitle={activeSeed.card.subtitle}
              dismissLabel={activeSeed.card.dismissLabel}
              onDismiss={dismissSeedCard}
            />
          )}
        </AnimatePresence>

        {hasMessages ? (
          <div className="flex flex-col gap-3">
            {messages.map((msg, index) => (
              <MessageRenderer
                key={msg.id}
                message={msg}
                isLastAssistant={
                  isStreaming &&
                  msg.role === 'assistant' &&
                  index === messages.length - 1
                }
                isStreaming={isStreaming}
                isLastSettledAssistant={
                  !isStreaming &&
                  msg.role === 'assistant' &&
                  index === messages.length - 1
                }
                proposalState={proposalStates[msg.id]}
                saveState={saveStates[msg.id] ?? 'idle'}
                onApprove={() => approveProposal(msg.id)}
                onReject={() => rejectProposal(msg.id)}
                onSave={(recipe) => handleSaveRecipe(msg.id, recipe)}
                onTryAnother={handleTryAnother}
                onTellMore={handleTellMore}
              />
            ))}

            <AnimatePresence>
              {showTypingIndicator && <TypingIndicator />}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        ) : (
          /* Empty state — drops the full-height centering when the cook card
             is above it, so the two don't fight for the same space. */
          <div
            className={`flex flex-col items-center justify-center text-center pb-8 ${
              cookingRecipe || activeSeed ? 'pt-4' : 'h-full'
            }`}
          >
            <EmptyState
              mascotState="happy"
              headerLabel="Chef Bubbly"
              headline={cookingRecipe ? 'Cooking with Bubbles' : 'Chat with Bubbles'}
              subline={
                cookingRecipe
                  ? 'Ask me anything about this recipe!'
                  : 'What are we cooking today?'
              }
              className="w-full max-w-sm mb-5"
            />
            {/* Chat-specific affordances — kept out of the generic EmptyState */}
            <div className="flex flex-wrap gap-2 justify-center">
              {(cookingRecipe ? COOKING_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <Chip
                  key={s}
                  tone="accent"
                  onClick={() => handleSuggestionClick(s)}
                >
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input bar — fixed above BottomNav */}
      <div className="fixed bottom-20 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] p-3 flex gap-2">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            // Stays enabled while a reply streams so the next question can be
            // composed as the answer arrives. Submitting is still blocked —
            // sendMessage returns early when isStreaming (useChat), and the Send
            // button is replaced by Stop below — so typing cannot interleave two
            // requests.
            aria-label="Message Bubbles"
            className="w-full rounded-full px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] text-sm"
          />
          {/* Placeholder hides once anything is typed; no longer tied to streaming,
              since the field is now usable mid-stream. */}
          <RotatingPlaceholder visible={!input && !hasMessages} />
        </div>
        {isStreaming ? (
          <SpringButton
            onClick={cancelStream}
            className="bg-[var(--color-muted)] text-white font-semibold px-4 py-2.5 rounded-full"
          >
            Stop
          </SpringButton>
        ) : (
          <SpringButton
            onClick={handleSend}
            className="bg-[var(--color-primary)] text-white font-semibold px-4 py-2.5 rounded-full disabled:opacity-50"
            disabled={!input.trim()}
          >
            Send
          </SpringButton>
        )}
      </div>
    </div>
  )
}

// ─── Cooking Context Card ─────────────────────────────────────────────────────

// ─── Message Renderer ─────────────────────────────────────────────────────────

interface MessageRendererProps {
  message: ChatMessage
  isLastAssistant: boolean
  isStreaming: boolean
  /** Last assistant message once streaming has finished — gates follow-up chips. */
  isLastSettledAssistant: boolean
  proposalState?: 'pending' | 'approved' | 'rejected'
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  onApprove: () => void
  onReject: () => void
  onSave: (recipe: ChatRecipeData) => void
  onTryAnother: () => void
  onTellMore: () => void
}

function MessageRenderer({
  message,
  isLastAssistant,
  isStreaming,
  isLastSettledAssistant,
  proposalState,
  saveState,
  onApprove,
  onReject,
  onSave,
  onTryAnother,
  onTellMore,
}: MessageRendererProps) {
  // User messages — simple bubble
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <MessageBubble message={message} />
      </motion.div>
    )
  }

  const mascotState = isLastAssistant && isStreaming ? 'thinking' : 'happy'
  const intent = message.intent ?? message.response?.intent

  // Recipe card intent
  if (
    (intent === 'recipe_card' || intent === 'recipe_generation') &&
    message.response?.proposal
  ) {
    const rawProposal = message.response.proposal as { recipe?: ChatRecipeData } | ChatRecipeData
    const recipe = (rawProposal && 'recipe' in rawProposal && rawProposal.recipe)
      ? rawProposal.recipe
      : rawProposal as ChatRecipeData
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-end gap-2">
          <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
          <div className="flex flex-col gap-2 items-start">
            {message.content && (
              <MessageBubble message={message} />
            )}
            <ChatRecipeCard
              recipe={recipe}
              onSave={() => onSave(recipe)}
              onTryAnother={onTryAnother}
              saveState={saveState}
            />
          </div>
        </div>
      </motion.div>
    )
  }

  // Pantry proposal intent
  if (intent === 'pantry_update' && message.response?.proposal) {
    const proposal = message.response.proposal as PantryProposalData
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-end gap-2">
          <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
          <div className="flex flex-col gap-2 items-start">
            {message.content && (
              <MessageBubble message={message} />
            )}
            <PantryProposalCard
              proposal={proposal}
              onApprove={onApprove}
              onReject={onReject}
              state={proposalState ?? 'pending'}
            />
          </div>
        </div>
      </motion.div>
    )
  }

  // Default: text message with markdown (skip empty streaming messages — typing indicator handles those)
  if (!message.content && isLastAssistant) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <div className="flex items-end gap-2">
        <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
        <MessageBubble message={message} />
      </div>
      {/* Follow-up affordances — only under the last settled assistant reply.
          Recipe-card and pantry-proposal messages carry their own actions. */}
      {isLastSettledAssistant && (
        <PostMessageChips onTryAnother={onTryAnother} onTellMore={onTellMore} />
      )}
    </motion.div>
  )
}
