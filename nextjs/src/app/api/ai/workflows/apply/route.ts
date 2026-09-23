import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { awardBubbles } from '@/lib/bubbles'

interface ApplyProposalAction {
  name?: string
  [key: string]: unknown
}

// Sibling issue to file: ai-service's ApplyResponse.affected_item_ids is
// defined but never populated by POST /v1/workflows/apply (see
// ai-service/bubbly_chef/api/routes/workflows.py), so this synthesizes a
// ref_key from the request id + item name instead of a real pantry item id.
// Swap to affected_item_ids once the backend populates it.
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
        if (requestId) {
          await Promise.all(
            actions.map((action) => {
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
