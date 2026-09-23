import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth callback for Supabase's PKCE flow (issue #383 — Google sign-in).
 *
 * Google redirects here with a `code` query param after the user
 * authorizes. We exchange it for a session (this sets the auth cookies via
 * the server client's `setAll`) and then send the user into the app.
 *
 * `exchangeCodeForSession` is the correct call for both the plain
 * `signInWithOAuth` flow and the guest `linkIdentity` flow (issue #389) — a
 * guest's `linkIdentity({ provider: 'google' })` redirect also lands back
 * here with a `code` param, and Supabase resolves the link server-side
 * during the exchange. The one case that needs special handling is a
 * collision: if the Google account is already linked to a different
 * BubblyChef account, Supabase can't discover that until Google redirects
 * back, so it arrives here as `error_code=identity_already_exists` rather
 * than as a synchronous error from `linkIdentity`. We forward `error_code`
 * alongside `error` so `login/page.tsx` can show a friendly message and a
 * "sign in to that account instead" fallback instead of the raw error text.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description')
  const errorCode = searchParams.get('error_code')
  const next = searchParams.get('next') ?? '/'

  if (errorDescription) {
    const params = new URLSearchParams({ error: errorDescription })
    if (errorCode) params.set('error_code', errorCode)
    return NextResponse.redirect(`${origin}/login?${params.toString()}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Missing authorization code')}`
  )
}
