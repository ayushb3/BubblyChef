'use client'

import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import RotatingPlaceholder from '@/components/chat/RotatingPlaceholder'
import MessageBubble from '@/components/chat/MessageBubble'
import PostMessageChips from '@/components/chat/PostMessageChips'
import TypingIndicator from '@/components/chat/TypingIndicator'
import ChatRecipeCard from '@/components/chat/ChatRecipeCard'
import PantryProposalCard from '@/components/chat/PantryProposalCard'
import ThemePicker from '@/components/ui/ThemePicker'
import Chip from '@/components/ui/Chip'
import EmptyState from '@/components/ui/EmptyState'
import { useChat } from '@/hooks/useChat'
import { checkAIHealth } from '@/lib/api/chat'
import type { ChatMessage, ChatRecipeData, PantryProposalData } from '@/types/chat'

const SUGGESTIONS = [
  'What can I make tonight? 🌙',
  'Quick weeknight dinner ⚡',
  'Use my expiring items 🍅',
  'Help me meal prep 📦',
]

export default function ChatPage() {
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

  const [input, setInput] = useState('')
  const [aiAvailable, setAiAvailable] = useState(true)
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check AI health on mount
  useEffect(() => {
    checkAIHealth()
      .then((h) => setAiAvailable(h.ai_available))
      .catch(() => setAiAvailable(false))
  }, [])

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
    sendMessage(text)
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInput('')
    sendMessage(suggestion)
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
                onClick={startNewChat}
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
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center pb-8">
            <EmptyState
              mascotState="happy"
              headerLabel="Chef Bubbly"
              headline="Chat with Bubbles"
              subline="What are we cooking today?"
              className="w-full max-w-sm mb-5"
            />
            {/* Chat-specific affordances — kept out of the generic EmptyState */}
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
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
            disabled={isStreaming}
            className="w-full rounded-full px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] text-sm disabled:opacity-50"
          />
          <RotatingPlaceholder visible={!input && !isStreaming && !hasMessages} />
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
