'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { streamChatMessage, fetchChatHistory, applyPantryProposal } from '@/lib/api/chat'
import type { ChatMessage, ChatResponse, PantryProposalData, PantryProposalAction } from '@/types/chat'
import { getClarificationSuggestions, mergeTermSuggestions, mergeActions } from '@/types/chat'

/** Everything needed to apply a pantry proposal once the user approves it. */
interface PendingProposal {
  requestId: string
  actions: PantryProposalAction[]
}

/**
 * Issue #265 — the active conversation survives navigation.
 *
 * The id lives in `localStorage`, not the URL: the chat URL is reserved for
 * one-shot deep-link seeds (`?tip=`, `?use=`) that get consumed and stripped
 * after use (see `chat-seed.ts`), and mixing continuous session identity into
 * it would conflate two concerns and needlessly expose an internal id in
 * links and history.
 */
const STORAGE_KEY = 'bubblychef:chat:conversationId'

function readStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, disabled, etc.) — behave as if empty.
    return null
  }
}

function writeStoredConversationId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Best effort — persistence just won't survive this session.
  }
}

function clearStoredConversationId(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do — if it couldn't be read, it wasn't going to resume anyway.
  }
}

export interface UseChatOptions {
  /**
   * Skip auto-resuming a persisted conversation on mount. Used when the page
   * has its own seed (e.g. `?tip=`, `?use=`, `?cooking=`) that should start a
   * fresh, purpose-built conversation rather than silently resuming whatever
   * was last open.
   */
  skipResume?: boolean
}

/**
 * Chat state machine hook.
 *
 * Manages messages, streaming, conversation identity, and proposal states.
 * Ported from web/src/pages/Chat.tsx state logic.
 */
export function useChat(options?: UseChatOptions) {
  const skipResume = options?.skipResume ?? false

  // Both server and first client render start empty/null — reading
  // localStorage happens only inside an effect below, so there is no
  // server/client markup mismatch on hydration.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const [proposalStates, setProposalStates] = useState<
    Record<string, 'pending' | 'approving' | 'approved' | 'rejected' | 'failed'>
  >({})
  const [proposalErrors, setProposalErrors] = useState<Record<string, string>>({})
  /**
   * Stores the requestId + actions needed to call applyPantryProposal when the
   * user clicks "Add to Pantry". Keyed by the message ID that owns the card.
   *
   * Replaces the old `workflowIds` map — there is no `/v1/workflows/{id}/events`
   * route; approval goes through `POST /v1/workflows/apply` instead.
   */
  const [pendingProposals, setPendingProposals] = useState<
    Record<string, PendingProposal>
  >({})
  const historyLoaded = useRef(false)
  // Guards against `sendMessage` racing the in-flight history fetch below: if
  // the user sends before the fetch resolves, the resolution must not clobber
  // the message(s) that arrived in the meantime.
  const hasSentRef = useRef(false)

  // ── History loading / resume ─────────────────────────────────────────────
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
    // `skipResume` is derived from URL params the page deliberately strips
    // after use (dismissing a seed card, ending a cook session, "New Chat"
    // all `router.replace('/chat')`). That flips `skipResume` true → false
    // on an already-mounted, already-live conversation, which re-runs this
    // effect (it's a dependency). The guard must be set on *every* path
    // through this effect on its FIRST run — including the skipped one — or
    // that later false re-run reads storage and overwrites the live thread
    // with whatever the server has persisted so far (#265 follow-up).
    if (historyLoaded.current) return
    historyLoaded.current = true
    if (skipResume) return

    const storedId = readStoredConversationId()
    if (!storedId) return

    // Set synchronously, not after the fetch resolves: if `sendMessage` fires
    // while the fetch is in flight, it must see this id already in place and
    // reuse it, rather than mint a second id that a slower-resolving fetch
    // would later stomp back over (the id) while also discarding the
    // just-sent message (the content).
    setConversationId(storedId)

    fetchChatHistory(storedId)
      .then((turns) => {
        // A send that happened while this fetch was in flight already owns
        // the thread — restoring history now would discard it.
        if (hasSentRef.current) return

        // Stale id handling: a persisted id that no longer resolves to any
        // history must not silently attach new messages to invisible prior
        // context — clear it and fall back to a fresh conversation.
        if (!turns || turns.length === 0) {
          clearStoredConversationId()
          setConversationId(null)
          return
        }

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
        // A send that happened while this fetch was in flight already owns
        // the thread — the fetch failing now doesn't make that id invalid.
        if (hasSentRef.current) return

        // History fetch failed — the id is unusable. Clear it rather than
        // starting fresh with a dangling id still in storage.
        clearStoredConversationId()
        setConversationId(null)
      })
  }, [skipResume])

  // ── Send message ─────────────────────────────────────────────────────────

  /**
   * Send a message. `context` is optional extra payload for the AI workflow
   * (e.g. `{ cooking_recipe: {...} }` after the Cook flow hands off to chat).
   */
  const sendMessage = useCallback(
    (text: string, context?: Record<string, unknown> | null) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return

      // Marks the thread as owned by this send, so a still-in-flight resume
      // fetch (above) knows not to overwrite it when it resolves.
      hasSentRef.current = true

      // Ensure we have a conversation ID
      let convId = conversationId
      if (!convId) {
        convId = crypto.randomUUID()
        setConversationId(convId)
        // Persist as soon as the conversation actually exists, so it becomes
        // resumable after navigation even if the user never returns before
        // sending another message.
        writeStoredConversationId(convId)
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
          // pending proposal here so approve/reject callbacks resolve correctly.
          //
          // When merging: migrate the original card's pending proposal
          // (mergeTargetId → assistantMsgId) so clicking "Add to Pantry" on
          // the merged-forward card finds the accumulated actions. Without this,
          // `pending === undefined` on the new owner and the button silently
          // no-ops. Also layer in any new actions from this turn on top.
          if (mergeTargetId) {
            const targetId = mergeTargetId
            setPendingProposals((prev) => {
              const originalPending = prev[targetId]
              const next = { ...prev }
              delete next[targetId]
              // Build the merged action list: start from the original pending
              // actions and layer in any new actions from this turn.
              if (originalPending) {
                const mergedActions = hasActions
                  ? mergeActions(originalPending.actions, proposal!.actions)
                  : originalPending.actions
                next[assistantMsgId] = {
                  requestId: response.request_id ?? originalPending.requestId,
                  actions: mergedActions,
                }
              } else if (
                response.requires_review &&
                response.intent === 'pantry_update' &&
                proposal &&
                'actions' in proposal
              ) {
                next[assistantMsgId] = {
                  requestId: response.request_id,
                  actions: proposal.actions,
                }
              }
              return next
            })
            setProposalStates((prev) => {
              const next = { ...prev }
              delete next[targetId]
              next[assistantMsgId] = 'pending'
              return next
            })
          } else if (
            response.requires_review &&
            response.intent === 'pantry_update' &&
            proposal &&
            'actions' in proposal
          ) {
            setPendingProposals((prev) => ({
              ...prev,
              [assistantMsgId]: {
                requestId: response.request_id,
                actions: proposal.actions,
              },
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
    clearStoredConversationId()
    setProposalErrors({})
    setPendingProposals({})
    historyLoaded.current = false
  }, [cancelStream])

  // ── Proposal approval/rejection ──────────────────────────────────────────

  /**
   * Approve a chat-proposed pantry update.
   *
   * Goes through the same `/api/ai/workflows/apply` proxy the receipt-scan
   * confirmation flow uses (see `lib/api/scan.ts#confirmScanItems`), so chat
   * and scan persist items via the same mechanism. The AI service registers
   * only `POST /v1/workflows/apply` — there is no `/v1/workflows/{id}/events`
   * route, so this must never target one.
   *
   * A non-success response (network error, non-2xx, or `success: false` in
   * the envelope) must not render as approved — it flips to 'failed' with an
   * error message and stays retryable via the same button.
   *
   * Retry safety: on partial failure (some actions succeeded, some failed) the
   * response includes a `failedActions` list derived from error messages. On
   * retry, only those failed actions are resent — the ones that already
   * succeeded are not replayed (the backend `add` path does
   * `new_qty = existing + qty`, so replaying would double-count).
   */
  const approveProposal = useCallback(async (msgId: string) => {
    const pending = pendingProposals[msgId]
    if (!pending) return

    setProposalStates((prev) => ({ ...prev, [msgId]: 'approving' }))
    setProposalErrors((prev) => {
      const next = { ...prev }
      delete next[msgId]
      return next
    })

    try {
      const result = await applyPantryProposal(pending.requestId, pending.actions)

      if (!result.success) {
        // If only some actions failed, update pendingProposals to hold only
        // the failed actions so a retry doesn't double-count the ones that
        // already succeeded.
        if (result.failedActions && result.failedActions.length > 0) {
          setPendingProposals((prev) => ({
            ...prev,
            [msgId]: { ...pending, actions: result.failedActions! },
          }))
        }
        setProposalErrors((prev) => ({
          ...prev,
          [msgId]: result.errors[0] ?? 'Some items could not be added. Please try again.',
        }))
        setProposalStates((prev) => ({ ...prev, [msgId]: 'failed' }))
        return
      }

      setProposalStates((prev) => ({ ...prev, [msgId]: 'approved' }))
    } catch (err) {
      setProposalErrors((prev) => ({
        ...prev,
        [msgId]: err instanceof Error ? err.message : 'Failed to add items. Please try again.',
      }))
      setProposalStates((prev) => ({ ...prev, [msgId]: 'failed' }))
    }
  }, [pendingProposals])

  /**
   * Reject a chat-proposed pantry update.
   *
   * The AI service has no reject/skip operation for proposals (only
   * `POST /v1/workflows/apply`, which writes to the DB) — rejection is a
   * client-side dismissal only. It does not call the AI service, so a failed
   * "rejection" can never happen and this is synchronous.
   */
  const rejectProposal = useCallback((msgId: string) => {
    setProposalStates((prev) => ({ ...prev, [msgId]: 'rejected' }))
  }, [])

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
    proposalErrors,
    sendMessage,
    sendChipMessage,
    cancelStream,
    startNewChat,
    approveProposal,
    rejectProposal,
  }
}
