'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { streamChatMessage, fetchChatHistory } from '@/lib/api/chat'
import type { ChatMessage, ChatResponse } from '@/types/chat'

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL || 'http://localhost:8888'

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
    Record<string, 'pending' | 'approved' | 'rejected'>
  >({})
  const [workflowIds, setWorkflowIds] = useState<Record<string, string>>({})
  const historyLoaded = useRef(false)
  // Guards against `sendMessage` racing the in-flight history fetch below: if
  // the user sends before the fetch resolves, the resolution must not clobber
  // the message(s) that arrived in the meantime.
  const hasSentRef = useRef(false)

  // ── History loading / resume ─────────────────────────────────────────────

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

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    // Keep streamed content if tokens arrived, otherwise use envelope
                    content: msg.content || fallbackContent,
                    intent: response.intent,
                    response,
                  }
                : msg,
            ),
          )

          // Track workflow for proposal approval
          if (response.workflow_id && response.requires_review) {
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
    clearStoredConversationId()
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
