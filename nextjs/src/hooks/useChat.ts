'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { streamChatMessage, fetchChatHistory } from '@/lib/api/chat'
import type { ChatMessage, ChatResponse, PantryProposalData } from '@/types/chat'
import { getClarificationSuggestions, mergeTermSuggestions, mergeActions } from '@/types/chat'

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

          const proposal = response.proposal as PantryProposalData | null
          const hasActions = !!proposal && proposal.actions.length > 0
          const clarificationTerms = getClarificationSuggestions(response)
          const isPantryTurn = response.intent === 'pantry_update'

          // Find the nearest earlier pantry card that's still open (pending).
          // Both vague-only turns (0 actions, new clarification pills) AND
          // pill-tap turns (real actions from a resolved term) merge here —
          // the goal is one card per "add session", not one card per turn.
          //
          // Absent from proposalStatesRef means setProposalStates hasn't
          // flushed yet (useEffect re-sync lags one render behind the setter).
          // Absent = never approved/rejected = still pending.
          let mergeTargetId: string | null = null
          if (isPantryTurn) {
            const priorMessages = messagesRef.current
            for (let i = priorMessages.length - 1; i >= 0; i--) {
              const candidate = priorMessages[i]
              if (candidate.id === assistantMsgId) continue
              const candidateProposal = candidate.response?.proposal as
                | PantryProposalData
                | undefined
              const candidateState = proposalStatesRef.current[candidate.id]
              if (
                candidate.intent === 'pantry_update' &&
                (candidateProposal?.actions.length ?? 0) > 0 &&
                (candidateState === 'pending' || candidateState === undefined)
              ) {
                mergeTargetId = candidate.id
                break
              }
            }
          }

          setMessages((prev) => {
            if (mergeTargetId) {
              // Move the card to this turn (the latest message) rather than
              // leaving it anchored at the earlier turn. The user just said
              // something new — the card should follow the conversation forward.
              // Strip it from the old turn (null out proposal + clarifications)
              // and attach the merged state here.
              const targetId = mergeTargetId
              const targetMsg = prev.find((m) => m.id === targetId)
              const targetProposal = targetMsg?.response?.proposal as PantryProposalData | undefined

              const mergedProposal: PantryProposalData | null = targetProposal
                ? {
                    ...targetProposal,
                    actions: hasActions
                      ? mergeActions(targetProposal.actions, proposal!.actions)
                      : targetProposal.actions,
                  }
                : null

              const mergedClarifications = mergeTermSuggestions(
                getClarificationSuggestions(targetMsg?.response),
                clarificationTerms,
              )

              return prev.map((msg) => {
                // Old card owner: strip its proposal and clarifications so no
                // card renders there anymore. Keep the reply bubble text.
                if (msg.id === targetId && msg.response) {
                  return {
                    ...msg,
                    response: {
                      ...msg.response,
                      proposal: null,
                      metadata: { ...msg.response.metadata, clarification_suggestions: [] },
                    },
                  }
                }
                // This turn: attach the merged card. Strip the verbose
                // "(still with X from earlier...)" prefix the backend prepends —
                // the card itself makes the context clear; the note is noise.
                if (msg.id === assistantMsgId) {
                  const cleanContent = (msg.content || fallbackContent)
                    .replace(/^\(still (with|don't know)[^)]*\)\s*/i, '')
                    .trim()
                  return {
                    ...msg,
                    content: cleanContent,
                    intent: response.intent,
                    response: {
                      ...response,
                      proposal: mergedProposal,
                      metadata: {
                        ...response.metadata,
                        clarification_suggestions: mergedClarifications,
                      },
                    },
                  }
                }
                return msg
              })
            }

            return prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content: msg.content || fallbackContent,
                    intent: response.intent,
                    response,
                  }
                : msg,
            )
          })

          // The card is now owned by this turn (assistantMsgId), whether it
          // started fresh or was merged from an earlier one. Register the
          // workflow ID here so approve/reject callbacks resolve correctly.
          // When merging: transfer the original card's workflow ID (mergeTargetId)
          // to the new owner and clear the old one — the original workflow handles
          // the DB write regardless of which message the card visually sits under.
          if (mergeTargetId) {
            setWorkflowIds((prev) => {
              const originalWfId = prev[mergeTargetId]
              const next = { ...prev }
              delete next[mergeTargetId]
              if (originalWfId) next[assistantMsgId] = originalWfId
              return next
            })
            setProposalStates((prev) => {
              const next = { ...prev }
              delete next[mergeTargetId]
              next[assistantMsgId] = 'pending'
              return next
            })
          } else if (response.workflow_id && response.requires_review) {
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

  // ── Chip tap send (interrupts streaming) ────────────────────────────────
  // Clarification pill taps need to send even while a prior response is
  // streaming — the user has already seen enough to respond. Abort the
  // current stream first so sendMessage's isStreaming guard doesn't block it.
  const sendChipMessage = useCallback(
    (text: string) => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort()
        streamAbortRef.current = null
        setIsStreaming(false)
      }
      sendMessage(text)
    },
    [sendMessage],
  )

  return {
    messages,
    isStreaming,
    conversationId,
    proposalStates,
    sendMessage,
    sendChipMessage,
    cancelStream,
    startNewChat,
    approveProposal,
    rejectProposal,
  }
}
