import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { awardBubbles } from '@/lib/bubbles'

interface ApplyProposalAction {
  name?: string
  action?: string
  [key: string]: unknown
}

// Sibling issue to file: ai-service's ApplyResponse.affected_item_ids is
// defined but never populated by POST /v1/workflows/apply (see
// ai-service/bubbly_chef/api/routes/workflows.py), so this synthesizes a
// ref_key from the request id + item name instead of a real pantry item id.
// Swap to affected_item_ids once the backend populates it.
//
// Known gap (issue #541, "POST /v1/workflows/apply never populates
// ApplyResponse.affected_item_ids"): this route gates the whole award on
// `data.success === true`, which the ai-service only sets when
// `failed == 0`. On a partial failure nothing here is awarded, even for the
// actions that did apply, because the proxy has no per-action success
// signal to award against (only the aggregate `applied_count`). useChat
// retries only the failed actions under the same request_id, so the
// first-pass successful items never get awarded. Fixing #541 (populating
// affected_item_ids) would let this award per successfully-applied item
// instead of all-or-nothing.
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [, user] = auth

  const body = await request.json()
  const response = await aiProxyJson('/v1/workflows/apply', body)

  if (response.status >= 200 && response.status < 300 && body.intent === 'pantry_update') {
    try {
      const data = await response.clone().json()
      if (data.success === true) {
        const requestId: string | undefined = body.request_id
        const actions: ApplyProposalAction[] = body.proposal?.actions ?? []
        // Only 'add' actions earn pantry_add — 'update', 'remove', and 'use'
        // are not adds and must not mint bubbles for them (see
        // PantryProposalAction.action_type in nextjs/src/types/chat.ts).
        const addActions = actions.filter((action) => action.action === 'add')
        if (requestId) {
          await Promise.all(
            addActions.map((action) => {
              const normalizedName = String(action.name ?? '').toLowerCase().trim()
              const refKey = `${requestId}:${normalizedName}`.slice(0, 200)
              return awardBubbles(user.id, 'pantry_add', refKey)
            }),
          )
        }
      }
    } catch {
      // Award is best-effort; never let a parse failure affect the response.
    }
  }

  return response
}
