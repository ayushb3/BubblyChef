'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  streamChatMessage,
  fetchChatHistory,
  applyPantryProposal,
  rejectPantryProposal,
} from '@/lib/api/chat'
import type {
  ChatMessage,
  ChatResponse,
  PantryProposalData,
  PantryProposalAction,
  PendingProposal,
} from '@/types/chat'
import {
  getClarificationSuggestions,
  mergeTermSuggestions,
  mergeActions,
  filterResolvedTerms,
  proposalActionKey,
} from '@/types/chat'
import { buildRestoredThread } from '@/lib/chat-restore'

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
  const queryClient = useQueryClient()

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
   * Keys (`proposalActionKey`) of the actions a failed card will retry, per
   * message id. Set on every failure, cleared on success. The card keeps rows
   * that already applied read-only and opens the editor only on these.
   */
  const [proposalFailedNames, setProposalFailedNames] = useState<Record<string, string[]>>({})
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
  // True only while a stored conversation id exists and its history fetch is
  // in flight. Gates the empty-state UI so the welcome screen doesn't flash
  // before the restored messages appear. Resolves to false whether the fetch
  // succeeds, fails, or is skipped (no stored id / skipResume).
  const [isResuming, setIsResuming] = useState(() => {
    if (skipResume) return false
    return Boolean(readStoredConversationId())
  })

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
  // Mirror pendingProposals for synchronous reads in setMessages — the merge
  // path needs the EDITED actions (which live only in pendingProposals after
  // updateProposalActions) to build the display-correct merged card.
  const pendingProposalsRef = useRef(pendingProposals)
  useEffect(() => {
    pendingProposalsRef.current = pendingProposals
  }, [pendingProposals])
  // The conversation an approve/reject records against (#444). Read through a
  // ref, never a closure: on a fresh mount the id is only set inside the resume
  // effect, after the first render, so a captured value would be null.
  const conversationIdRef = useRef(conversationId)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

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
    conversationIdRef.current = storedId

    fetchChatHistory(storedId)
      .then((turns) => {
        // A send that happened while this fetch was in flight already owns
        // the thread — restoring history now would discard it.
        if (hasSentRef.current) { setIsResuming(false); return }

        // Stale id handling: a persisted id that no longer resolves to any
        // history must not silently attach new messages to invisible prior
        // context — clear it and fall back to a fresh conversation.
        if (!turns || turns.length === 0) {
          clearStoredConversationId()
          setConversationId(null)
          setIsResuming(false)
          return
        }

        // Pantry proposals restore from the outcome the AI service recorded on
        // the persisted turns, so a card is live only if it was never handled
        // (#444). The mapper never throws; a bad row degrades to a text bubble.
        const restored = buildRestoredThread(turns, storedId)
        setMessages(restored.messages)
        setPendingProposals(restored.pendingProposals)
        setProposalStates(restored.proposalStates)
        setProposalErrors(restored.proposalErrors)
        setProposalFailedNames(restored.proposalFailedNames)
        setIsResuming(false)
      })
      .catch(() => {
        // A send that happened while this fetch was in flight already owns
        // the thread — the fetch failing now doesn't make that id invalid.
        if (hasSentRef.current) { setIsResuming(false); return }

        // History fetch failed — the id is unusable. Clear it rather than
        // starting fresh with a dangling id still in storage.
        clearStoredConversationId()
        setConversationId(null)
        setIsResuming(false)
      })
  }, [skipResume])

  // ── Send message ─────────────────────────────────────────────────────────

  /**
   * Send a message. `context` is optional extra payload for the AI workflow
   * (e.g. `{ cooking_recipe: {...} }` after the Cook flow hands off to chat).
   * `forcedIntent` is set by the confirm-band to deterministically route the
   * turn without going through the classifier.
   */
  const sendMessage = useCallback(
    (
      text: string,
      context?: Record<string, unknown> | null,
      forcedIntent?: 'recipe_card' | 'recipe_brainstorm' | null,
      forcedIntentSource?: string | null,
    ) => {
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
        conversationIdRef.current = convId
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
          ...(forcedIntent ? { forced_intent: forcedIntent } : {}),
          ...(forcedIntent && forcedIntentSource
            ? { forced_intent_source: forcedIntentSource }
            : {}),
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
          const clarificationTerms = getClarificationSuggestions(response)
          const isPantryTurn = response.intent === 'pantry_update'
          const hasActions =
            isPantryTurn && !!proposal && Array.isArray(proposal.actions) && proposal.actions.length > 0

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

              // Fix #340 display/write desync: use the edited actions from
              // pendingProposals (which updateProposalActions patches) as the
              // merge base — NOT targetProposal.actions from the message, which
              // still holds the original un-edited backend values. Without this,
              // an edit-then-merge remounts the card showing the original qty.
              const editedBaseActions =
                pendingProposalsRef.current[targetId]?.actions ?? targetProposal?.actions ?? []

              const mergedProposal: PantryProposalData | null = targetProposal
                ? {
                    ...targetProposal,
                    actions: hasActions
                      ? mergeActions(editedBaseActions, proposal!.actions)
                      : editedBaseActions,
                  }
                : null

              const mergedClarifications = filterResolvedTerms(
                mergeTermSuggestions(
                  getClarificationSuggestions(targetMsg?.response),
                  clarificationTerms,
                ),
                mergedProposal?.actions ?? [],
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
                    .replace(/^\([^)]*(?:still with|still don't know)[^)]*\)\s*/i, '')
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
                    ...(response.next_action === 'confirm_choice'
                      ? { confirmSource: trimmed }
                      : {}),
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
                  // The card now spans this turn too. Any pantry turn joins,
                  // zero-action ones included: it owns the card, so its id must
                  // be a chain member (#444).
                  turnRequestIds: response.request_id
                    ? [...originalPending.turnRequestIds, response.request_id]
                    : originalPending.turnRequestIds,
                }
              } else if (
                response.intent === 'pantry_update' &&
                proposal &&
                'actions' in proposal
              ) {
                next[assistantMsgId] = {
                  requestId: response.request_id,
                  actions: proposal.actions,
                  turnRequestIds: [response.request_id],
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
            response.intent === 'pantry_update' &&
            proposal &&
            'actions' in proposal
          ) {
            setPendingProposals((prev) => ({
              ...prev,
              [assistantMsgId]: {
                requestId: response.request_id,
                actions: proposal.actions,
                turnRequestIds: [response.request_id],
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

        {
          // Chips land after the envelope (issue #498); the turn is already
          // settled and the input unlocked by then.
          onFollowUps: (suggestions: string[]) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId && msg.response
                  ? {
                      ...msg,
                      response: {
                        ...msg.response,
                        metadata: {
                          ...msg.response.metadata,
                          follow_up_suggestions: suggestions,
                          follow_ups_pending: false,
                        },
                      },
                    }
                  : msg,
              ),
            )
          },
          // However the stream ended, stop waiting for chips; a reply that
          // never got them falls back to the static set.
          onStreamEnd: () => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId && msg.response?.metadata?.follow_ups_pending === true
                  ? {
                      ...msg,
                      response: {
                        ...msg.response,
                        metadata: { ...msg.response.metadata, follow_ups_pending: false },
                      },
                    }
                  : msg,
              ),
            )
          },
        },
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
    conversationIdRef.current = null
    setProposalStates({})
    clearStoredConversationId()
    setProposalErrors({})
    setProposalFailedNames({})
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
      // Record the outcome on the persisted turns the card spans (#444). With
      // no conversation id there is nothing to record against: behave as before.
      const convId = conversationIdRef.current
      const result = convId
        ? await applyPantryProposal(pending.requestId, pending.actions, {
            conversationId: convId,
            turnRequestIds: pending.turnRequestIds,
          })
        : await applyPantryProposal(pending.requestId, pending.actions)

      if (!result.success) {
        // If only some actions failed, update pendingProposals to hold only
        // the failed actions so a retry doesn't double-count the ones that
        // already succeeded.
        const hasNarrowed = Boolean(result.failedActions && result.failedActions.length > 0)
        if (hasNarrowed) {
          setPendingProposals((prev) => ({
            ...prev,
            [msgId]: { ...pending, actions: result.failedActions! },
          }))
        }
        // What the retry will send: the narrowed set, else the whole pending set.
        const retryActions = hasNarrowed ? result.failedActions! : pending.actions
        setProposalFailedNames((prev) => ({
          ...prev,
          [msgId]: retryActions.map(proposalActionKey),
        }))
        setProposalErrors((prev) => ({
          ...prev,
          [msgId]: result.errors[0] ?? 'Some items could not be added. Please try again.',
        }))
        setProposalStates((prev) => ({ ...prev, [msgId]: 'failed' }))
        return
      }

      setProposalStates((prev) => ({ ...prev, [msgId]: 'approved' }))
      setProposalFailedNames((prev) => {
        const next = { ...prev }
        delete next[msgId]
        return next
      })
      // The approve route (/api/ai/workflows/apply) awards pantry_add
      // bubbles server-side (#520) — refetch so the balance shown in the UI
      // picks it up, same as every other awarding mutation (CookModal,
      // RecipeBook import, scan confirm, the pantry add sheet).
      queryClient.invalidateQueries({ queryKey: ['bubbles'] })
    } catch (err) {
      // Nothing is known to have applied and the pending set is unchanged, so
      // every pending row stays retryable.
      setProposalFailedNames((prev) => ({
        ...prev,
        [msgId]: pending.actions.map(proposalActionKey),
      }))
      setProposalErrors((prev) => ({
        ...prev,
        [msgId]: err instanceof Error ? err.message : 'Failed to add items. Please try again.',
      }))
      setProposalStates((prev) => ({ ...prev, [msgId]: 'failed' }))
    }
  }, [pendingProposals, queryClient])

  /**
   * Update the pending actions for a proposal in place (no AI round-trip).
   *
   * Called by PantryProposalCard whenever the user edits a quantity/unit
   * inline. The edited actions are what get sent to the DB on approve, not
   * the original backend values.
   *
   * Only actions already in the pending set are kept. The card renders every
   * row and sends its whole list on an edit, so after a partial failure (the
   * pending set narrowed to the failed rows) an unfiltered replace would bring
   * back the rows that already applied and Try again would apply them twice.
   * Before any failure the pending set is every action, so pre-approve edits
   * are unchanged.
   */
  const updateProposalActions = useCallback((msgId: string, actions: PantryProposalAction[]) => {
    setPendingProposals((prev) => {
      const existing = prev[msgId]
      if (!existing) return prev
      const pendingKeys = new Set(existing.actions.map(proposalActionKey))
      return {
        ...prev,
        [msgId]: { ...existing, actions: actions.filter((a) => pendingKeys.has(proposalActionKey(a))) },
      }
    })
  }, [])

  /**
   * Reject a chat-proposed pantry update.
   *
   * The card flips to 'rejected' at once. The dismissal is also recorded on the
   * persisted turns (`POST /v1/workflows/reject`, #444) so it survives a reload
   * and shows on another device. That call is fire and forget: if it fails the
   * worst case is the card coming back pending, which carries no write risk, so
   * it never reverts the UI and never throws.
   */
  const rejectProposal = useCallback((msgId: string) => {
    setProposalStates((prev) => ({ ...prev, [msgId]: 'rejected' }))
    const pending = pendingProposalsRef.current[msgId]
    const convId = conversationIdRef.current
    if (!convId || !pending || pending.turnRequestIds.length === 0) return
    try {
      Promise.resolve(rejectPantryProposal(convId, pending.turnRequestIds)).catch(() => {})
    } catch {
      // Best effort only.
    }
  }, [])

  // ── Chip tap send (interrupts streaming) ────────────────────────────────
  // Clarification pill taps need to send even while a prior response is
  // streaming — the user has already seen enough to respond. Abort the
  // current stream first so sendMessage's isStreaming guard doesn't block it.
  //
  // `context` (issue #651, §1c/§4) forwards a stamped pill's request context
  // (e.g. `{ meal_followup: true }`) straight through to `sendMessage` — set
  // only by the resolver, never from model output.
  const sendChipMessage = useCallback(
    (text: string, context?: Record<string, unknown> | null) => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort()
        streamAbortRef.current = null
        setIsStreaming(false)
      }
      sendMessage(text, context)
    },
    [sendMessage],
  )

  // ── Confirm-band send ────────────────────────────────────────────────────
  // Called when the user taps a confirm-band button. Aborts any in-flight
  // stream (same as sendChipMessage), then sends the button label as the
  // visible user turn with forced_intent set so the backend bypasses the
  // classifier entirely and routes deterministically.
  const sendConfirmChoice = useCallback(
    (
      label: string,
      forcedIntent: 'recipe_card' | 'recipe_brainstorm',
      source?: string | null,
    ) => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort()
        streamAbortRef.current = null
        setIsStreaming(false)
      }
      sendMessage(label, null, forcedIntent, source)
    },
    [sendMessage],
  )

  return {
    messages,
    isStreaming,
    isResuming,
    conversationId,
    proposalStates,
    proposalErrors,
    proposalFailedNames,
    sendMessage,
    sendChipMessage,
    sendConfirmChoice,
    cancelStream,
    startNewChat,
    approveProposal,
    rejectProposal,
    updateProposalActions,
  }
}
