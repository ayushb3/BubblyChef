/**
 * Unit tests for the pure route-guard decision logic backing
 * `lib/supabase/middleware.ts` (issue #382 — guest mode via Supabase
 * anonymous auth).
 *
 * `next/server`'s `NextRequest`/`NextResponse` rely on Web `Request`/
 * `Response` globals that this project's jsdom Jest environment doesn't
 * provide, so the actual middleware function (cookie plumbing, the real
 * `signInAnonymously()` call, real redirects) is NOT exercised here — it's
 * browser/dev-server-only verified. This file only covers the decision
 * table `decideRouteAction` produces, which the middleware then acts on.
 */

import { decideRouteAction, isPublicPath } from '@/lib/supabase/auth-routing'

describe('isPublicPath', () => {
  it('treats /login as public', () => {
    expect(isPublicPath('/login')).toBe(true)
  })

  it('treats /auth/callback as public', () => {
    expect(isPublicPath('/auth/callback')).toBe(true)
  })

  it('treats everything else as protected', () => {
    expect(isPublicPath('/pantry')).toBe(false)
    expect(isPublicPath('/')).toBe(false)
    expect(isPublicPath('/api/pantry')).toBe(false)
  })
})

describe('decideRouteAction', () => {
  it('signs in a first-time visitor anonymously instead of bouncing to /login', () => {
    const action = decideRouteAction({ hasUser: false, isAnonymous: false, pathname: '/pantry' })
    expect(action).toEqual({ type: 'sign-in-anonymously' })
  })

  it('does not try to auto-sign-in a visitor already on /login', () => {
    const action = decideRouteAction({ hasUser: false, isAnonymous: false, pathname: '/login' })
    expect(action).toEqual({ type: 'continue' })
  })

  it('does not try to auto-sign-in a visitor on /auth/callback', () => {
    const action = decideRouteAction({ hasUser: false, isAnonymous: false, pathname: '/auth/callback' })
    expect(action).toEqual({ type: 'continue' })
  })

  it('lets an anonymous guest continue browsing protected routes', () => {
    const action = decideRouteAction({ hasUser: true, isAnonymous: true, pathname: '/pantry' })
    expect(action).toEqual({ type: 'continue' })
  })

  it('does NOT bounce an anonymous guest away from /login — they may want a separate real account', () => {
    const action = decideRouteAction({ hasUser: true, isAnonymous: true, pathname: '/login' })
    expect(action).toEqual({ type: 'continue' })
  })

  it('bounces a real, already-authenticated user away from /login', () => {
    const action = decideRouteAction({ hasUser: true, isAnonymous: false, pathname: '/login' })
    expect(action).toEqual({ type: 'redirect', pathname: '/' })
  })

  it('lets a real, already-authenticated user browse protected routes', () => {
    const action = decideRouteAction({ hasUser: true, isAnonymous: false, pathname: '/pantry' })
    expect(action).toEqual({ type: 'continue' })
  })
})
