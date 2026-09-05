/**
 * Chat API client — calls the AI service directly from the browser.
 *
 * Direct connection (not proxied through Next.js) to avoid
 * Vercel serverless function timeouts on long-running streams.
 */

import { createClient } from '@/lib/supabase/client'
import type {
  ChatRequest,
  ChatResponse,
  ConversationHistoryTurn,
  ConversationSession,
  AIHealthStatus,
  PantryProposalAction,
} from '@/types/chat'

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL || 'http://localhost:8888'

/**
 * Get a fresh Supabase access token for Authorization header.
 */
async function getAuthToken(): Promise<string> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('Not authenticated')
  }
  return session.access_token
}

/**
 * Authenticated fetch wrapper for the AI service.
 */
async function aiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAuthToken()
  return fetch(`${AI_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

/**
 * Stream a chat message via SSE.
 *
 * Calls POST /v1/chat/stream on the AI service and parses the
 * Server-Sent Events stream. Each token is delivered to onToken,
 * the final envelope (with intent, proposal, etc.) to onDone.
 *
 * Ported from web/src/api/client.ts:487-556 with Supabase auth.
 */
export async function streamChatMessage(
  request: ChatRequest,
  onToken: (token: string) => void,
  onDone: (response: ChatResponse) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await aiFetch('/v1/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return
    onError(err instanceof Error ? err : new Error(String(err)))
    return
  }

  if (!response.ok || !response.body) {
    onError(new Error(`Chat request failed: ${response.status}`))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // The caller clears its streaming state only from `onDone`/`onError`, so a
  // stream that ends without emitting an `envelope` or `error` event (backend
  // crash mid-stream, dropped proxy connection, truncated body) used to leave
  // the UI streaming forever with no way out but a reload (#241). Track whether
  // a terminal callback actually fired and synthesise one if it did not.
  let settled = false
  const settle = (fn: () => void) => {
    if (settled) return
    settled = true
    fn()
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      let currentEventType = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6)
          try {
            const parsed = JSON.parse(jsonStr)
            if (parsed.type === 'token' || currentEventType === 'token') {
              onToken(parsed.content ?? '')
              // 20ms visual throttle for streaming effect
              await new Promise((r) => setTimeout(r, 20))
            } else if (
              parsed.type === 'envelope' ||
              currentEventType === 'envelope'
            ) {
              settle(() => onDone(parsed.data))
            } else if (
              parsed.type === 'error' ||
              currentEventType === 'error'
            ) {
              settle(() =>
                onError(new Error(parsed.message ?? 'Stream error')),
              )
              return
            }
            // 'done' event is informational; envelope follows it
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }
  } catch (err) {
    // An abort is a deliberate user action; the caller already reset its own
    // state when it aborted, so mark this settled without firing a callback.
    if ((err as DOMException)?.name === 'AbortError') {
      settled = true
      return
    }
    settle(() => onError(err instanceof Error ? err : new Error(String(err))))
  } finally {
    reader.releaseLock()
    // Reached when the body closed cleanly but no envelope ever arrived.
    settle(() =>
      onError(new Error('The response ended unexpectedly. Please try again.')),
    )
  }
}

/**
 * Fetch conversation history from the AI service.
 */
export async function fetchChatHistory(
  conversationId: string,
): Promise<ConversationHistoryTurn[]> {
  const res = await aiFetch(`/v1/chat/history/${conversationId}`)
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`)
  return res.json()
}

/**
 * List the current user's conversation sessions.
 */
export async function fetchChatSessions(): Promise<ConversationSession[]> {
  const res = await aiFetch('/v1/chat/sessions')
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`)
  return res.json()
}

/**
 * Check AI provider availability (unauthenticated).
 */
export async function checkAIHealth(): Promise<AIHealthStatus> {
  const res = await fetch(`${AI_SERVICE_URL}/health/ai`)
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  return res.json()
}

/**
 * Result of applying a chat-proposed pantry update.
 */
export interface ApplyProposalResult {
  success: boolean
  appliedCount: number
  failedCount: number
  errors: string[]
  /**
   * Subset of the original actions that failed to apply.
   *
   * The AI service does not return failed action objects directly — it returns
   * error strings like `"Item not found: eggs"`. We reconstruct this list by
   * matching error messages against the original action names so the retry path
   * in useChat can resend only the failed subset and avoid double-counting the
   * ones that already succeeded (`add` is not idempotent: it does
   * `new_qty = existing + qty`).
   *
   * When no names can be extracted (e.g. an unexpected error format), this is
   * undefined — callers fall back to resending all original actions.
   */
  failedActions?: PantryProposalAction[]
}

/**
 * Apply a pantry-update proposal surfaced by chat.
 *
 * Routes through the same Next.js proxy the receipt-scan confirmation flow
 * uses (`POST /api/ai/workflows/apply` → AI service `POST /v1/workflows/apply`),
 * so chat approval and scan confirmation persist items the same way. The
 * proxy forwards the Supabase session server-side, so no token handling is
 * needed here (unlike the direct-to-service calls above).
 *
 * The AI service's `apply_pantry_proposal` reads a flat action shape
 * (`action`, `name`, `quantity`, `unit`, `category`, `location`), not the
 * nested `{ action_type, item }` shape chat's `PantryProposalAction` uses —
 * this maps between the two.
 */
export async function applyPantryProposal(
  requestId: string,
  actions: PantryProposalAction[],
): Promise<ApplyProposalResult> {
  const res = await fetch('/api/ai/workflows/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: requestId,
      intent: 'pantry_update',
      proposal: {
        actions: actions.map((action) => ({
          action: action.action_type,
          name: action.item.name,
          quantity: action.item.quantity,
          unit: action.item.unit,
          category: action.item.category,
          location: action.item.storage_location,
        })),
      },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to add items' }))
    throw new Error(err.error ?? `Failed to add items: ${res.status}`)
  }

  const data = await res.json()
  const errors: string[] = Array.isArray(data.errors) ? data.errors : []
  const failedCount: number = typeof data.failed_count === 'number' ? data.failed_count : 0

  // Derive the failed action objects from error strings so the retry path can
  // resend only what failed. The backend emits "Item not found: <name>" and
  // similar patterns — extract the name after ": " and match against the
  // original action list (case-insensitive).
  let failedActions: PantryProposalAction[] | undefined
  if (failedCount > 0 && errors.length > 0) {
    const failedNames = new Set(
      errors
        .map((e) => {
          const m = e.match(/:\s*(.+)$/)
          return m ? m[1].trim().toLowerCase() : null
        })
        .filter((n): n is string => n !== null),
    )
    const matched = failedNames.size > 0
      ? actions.filter((a) => failedNames.has(a.item.name.toLowerCase()))
      : undefined
    // If we couldn't match any names, leave failedActions undefined so the
    // caller falls back to resending all actions (better than silently dropping).
    failedActions = matched && matched.length > 0 ? matched : undefined
  }

  return {
    success: Boolean(data.success),
    appliedCount: typeof data.applied_count === 'number' ? data.applied_count : 0,
    failedCount,
    errors,
    failedActions,
  }
}
