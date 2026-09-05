'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { streamChatMessage, fetchChatHistory } from '@/lib/api/chat'
import type { ChatMessage, ChatResponse, PantryProposalData } from '@/types/chat'
import { getClarificationSuggestions, mergeTermSuggestions } from '@/types/chat'

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL || 'http://localhost:8888'

/**
 * Chat state machine hook.
 *
 * Manages messages, streaming, conversation identity, and proposal states.
 * Ported from web/src/pages/Chat.tsx state logic.
 */
export function useChat(initialConversationId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  )
  const streamAbortRef = useRef<AbortController | null>(null)
  const [proposalStates, setProposalStates] = useState<
    Record<string, 'pending' | 'approved' | 'rejected'>
  >({})
  const [workflowIds, setWorkflowIds] = useState<Record<string, string>>({})
  const historyLoaded = useRef(false)

  // Mirror messages/proposalStates for synchronous reads in onDone (below) —
  // sendMessage's closure over `messages`/`proposalStates` from render time
  // would otherwise be stale by the time a streamed response completes.
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const proposalStatesRef = useRef(proposalStates)
  useEffect(() => {
    proposalStatesRef.current = proposalStates
  }, [proposalStates])

  // ── History loading ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!initialConversationId || historyLoaded.current) return
    historyLoaded.current = true

    fetchChatHistory(initialConversationId)
      .then((turns) => {
        const restored: ChatMessage[] = turns.map((turn) => ({
          id: crypto.randomUUID(),
          role: turn.role as 'user' | 'assistant',
          content: turn.content,
          intent: (turn.intent as ChatMessage['intent']) ?? undefined,
          timestamp: new Date(turn.created_at),
        }))
        setMessages(restored)
      })
      .catch(() => {
        // History unavailable — start fresh
      })
  }, [initialConversationId])

  // ── Send message ─────────────────────────────────────────────────────────

  /**
   * Send a message. `context` is optional extra payload for the AI workflow
   * (e.g. `{ cooking_recipe: {...} }` after the Cook flow hands off to chat).
   */
  const sendMessage = useCallback(
    (text: string, context?: Record<string, unknown> | null) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return

      // Ensure we have a conversation ID
      let convId = conversationId
      if (!convId) {
        convId = crypto.randomUUID()
        setConversationId(convId)
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      }

      const assistantMsgId = crypto.randomUUID()
      const placeholderMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMsg, placeholderMsg])
      setIsStreaming(true)

      const abortController = new AbortController()
      streamAbortRef.current = abortController

      streamChatMessage(
        {
          message: trimmed,
          conversation_id: convId,
          ...(context ? { context } : {}),
        },

        // onToken — append each token to the placeholder
        (token: string) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + token }
                : msg,
            ),
          )
        },

        // onDone — attach the full response envelope
        (response: ChatResponse) => {
          setIsStreaming(false)
          streamAbortRef.current = null

          const fallbackContent =
            response.assistant_message ||
            "I'm not sure how to help with that. Try asking about recipes or groceries!"

          // A pantry-update turn with zero real items (every item mentioned
          // was too vague — "veggies", "dairy things") but real clarification
          // suggestions. If an earlier turn in this conversation still has an
          // unapproved pantry card, fold these terms into THAT card instead
          // of opening a second one — one pantry update reads as one card,
          // not a growing stack of them each time the user clarifies.
          const proposal = response.proposal as PantryProposalData | null
          const hasActions = !!proposal && proposal.actions.length > 0
          const clarificationTerms = getClarificationSuggestions(response)
          const isVagueOnlyPantryTurn =
            response.intent === 'pantry_update' && !hasActions && clarificationTerms.length > 0

          let mergeTargetId: string | null = null
          if (isVagueOnlyPantryTurn) {
            const priorMessages = messagesRef.current
            for (let i = priorMessages.length - 1; i >= 0; i--) {
              const candidate = priorMessages[i]
              if (candidate.id === assistantMsgId) continue
              const candidateProposal = candidate.response?.proposal as
                | PantryProposalData
                | undefined
              if (
                candidate.intent === 'pantry_update' &&
                (candidateProposal?.actions.length ?? 0) > 0 &&
                proposalStatesRef.current[candidate.id] === 'pending'
              ) {
                mergeTargetId = candidate.id
                break
              }
            }
          }

          setMessages((prev) => {
            if (mergeTargetId) {
              // Drop this turn's own placeholder — its card would be empty
              // (0 actions) and its clarifying text is now redundant with
              // the pills appended to the target card below.
              const targetId = mergeTargetId
              return prev
                .filter((msg) => msg.id !== assistantMsgId)
                .map((msg) =>
                  msg.id === targetId && msg.response
                    ? {
                        ...msg,
                        response: {
                          ...msg.response,
                          metadata: {
                            ...msg.response.metadata,
                            clarification_suggestions: mergeTermSuggestions(
                              getClarificationSuggestions(msg.response),
                              clarificationTerms,
                            ),
                          },
                        },
                      }
                    : msg,
                )
            }

            return prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    // Keep streamed content if tokens arrived, otherwise use envelope
                    content: msg.content || fallbackContent,
                    intent: response.intent,
                    response,
                  }
                : msg,
            )
          })

          // Track workflow for proposal approval — skip for a turn that got
          // merged into an earlier card; it has no actions of its own to approve.
          if (response.workflow_id && response.requires_review && !mergeTargetId) {
            setWorkflowIds((prev) => ({
              ...prev,
              [assistantMsgId]: response.workflow_id,
            }))
            setProposalStates((prev) => ({
              ...prev,
              [assistantMsgId]: 'pending',
            }))
          }
        },

        // onError
        (err: Error) => {
          setIsStreaming(false)
          streamAbortRef.current = null
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content: `Oops! Something went wrong (${err.message}). Please try again!`,
                  }
                : msg,
            ),
          )
        },

        abortController.signal,
      )
    },
    [isStreaming, conversationId],
  )

  // ── Cancel stream ────────────────────────────────────────────────────────

  const cancelStream = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort()
      streamAbortRef.current = null
    }
    setIsStreaming(false)
  }, [])

  // ── New chat ─────────────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    cancelStream()
    setMessages([])
    setConversationId(null)
    setProposalStates({})
    setWorkflowIds({})
    historyLoaded.current = false
  }, [cancelStream])

  // ── Proposal approval/rejection ──────────────────────────────────────────

  const approveProposal = useCallback(
    async (msgId: string) => {
      const wfId = workflowIds[msgId]
      if (!wfId) return

      try {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()

        await fetch(`${AI_SERVICE_URL}/v1/workflows/${wfId}/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({
            event_type: 'submit_review',
            decision: 'approve',
          }),
        })
        setProposalStates((prev) => ({ ...prev, [msgId]: 'approved' }))
      } catch {
        // Approval failed — keep as pending
      }
    },
    [workflowIds],
  )

  const rejectProposal = useCallback(
    async (msgId: string) => {
      const wfId = workflowIds[msgId]
      if (!wfId) return

      try {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()

        await fetch(`${AI_SERVICE_URL}/v1/workflows/${wfId}/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({
            event_type: 'submit_review',
            decision: 'skip',
          }),
        })
        setProposalStates((prev) => ({ ...prev, [msgId]: 'rejected' }))
      } catch {
        // Rejection failed — keep as pending
      }
    },
    [workflowIds],
  )

  return {
    messages,
    isStreaming,
    conversationId,
    proposalStates,
    sendMessage,
    cancelStream,
    startNewChat,
    approveProposal,
    rejectProposal,
  }
}
