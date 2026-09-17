import { NextResponse } from 'next/server'

/**
 * Unauthenticated health check for post-merge smoke tests (issue: step 3(e)
 * of docs/plans/2026-09-17-autonomous-agent-loop.md).
 *
 * Intentionally does NOT call `requireAuth()` — a smoke test hits this
 * unauthenticated right after a deploy, before any user session exists.
 * `src/lib/supabase/auth-routing.ts`'s `decideRouteAction()` already lets
 * every `/api/*` path through as `{ type: 'continue' }` regardless of auth
 * state, so the middleware never redirects or blocks this route — see that
 * file's comment on why API routes gate themselves instead.
 *
 * `dynamic = 'force-dynamic'` keeps this from being statically cached at
 * build time, so `sha` always reflects the currently running deploy rather
 * than whatever was true when the route was last built.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_GIT_SHA ?? 'unknown'

  return NextResponse.json({
    status: 'ok',
    sha,
    deployedAt: sha !== 'unknown' ? new Date().toISOString() : undefined,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
  })
}
