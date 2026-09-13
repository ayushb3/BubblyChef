/**
 * Pure route-guard decision logic for `lib/supabase/middleware.ts`
 * (issue #382 — guest mode via Supabase anonymous auth).
 *
 * Pulled out of the middleware so it's testable without a live
 * `NextRequest`/`NextResponse` (jsdom has no `Request`/`Response` globals,
 * so `next/server` can't be imported in this project's Jest environment —
 * see `src/__tests__/auth-routing.test.ts`). The middleware itself —
 * calling `signInAnonymously()`, setting cookies, actually redirecting —
 * is unverified outside a real browser/dev server in this environment.
 */

export type RouteAction =
  | { type: 'continue' }
  | { type: 'sign-in-anonymously' }
  | { type: 'redirect'; pathname: string }

const PUBLIC_PATHS = ['/login', '/auth/callback']

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path))
}

export function decideRouteAction(params: {
  hasUser: boolean
  isAnonymous: boolean
  pathname: string
}): RouteAction {
  const { hasUser, isAnonymous, pathname } = params

  // No session at all on a protected route — start the visitor as a guest
  // instead of forcing a login wall.
  if (!hasUser && !isPublicPath(pathname)) {
    return { type: 'sign-in-anonymously' }
  }

  // A real (non-anonymous) session visiting /login gets bounced home.
  // Anonymous guests are NOT bounced — they may want to sign into a
  // separate, pre-existing real account rather than converting this one.
  if (hasUser && !isAnonymous && pathname === '/login') {
    return { type: 'redirect', pathname: '/' }
  }

  return { type: 'continue' }
}
