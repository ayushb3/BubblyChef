import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth callback for Supabase's PKCE flow (issue #383 — Google sign-in).
 *
 * Google redirects here with a `code` query param after the user
 * authorizes. We exchange it for a session (this sets the auth cookies via
 * the server client's `setAll`) and then send the user into the app.
 *
 * A guest's `linkIdentity({ provider: 'google' })` (issue #389, called from
 * `login/page.tsx` and `SaveAccountBanner.tsx`) redirects back here with a
 * `code` too, so the same exchange serves both flows. The one case needing
 * special handling is a collision: a Google account that already belongs to
 * another BubblyChef user is only discovered after Google redirects back, so
 * it arrives as `error_code=identity_already_exists` (or `email_exists`).
 * `error_code` is forwarded to /login on every error path so the page can tell
 * a collision from any other failure.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description')
  const errorCode = searchParams.get('error_code')
  const next = searchParams.get('next') ?? '/'

  // Any provider error, even one without a description, goes back to /login
  // with its code so a collision is still recognised.
  const providerError = errorDescription ?? searchParams.get('error')
  if (providerError || errorCode) {
    const params = new URLSearchParams({ error: providerError ?? 'Sign-in failed' })
    if (errorCode) params.set('error_code', errorCode)
    return NextResponse.redirect(`${origin}/login?${params.toString()}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    // The collision can also surface here, at the exchange.
    const codeParam = error.code ? `&error_code=${encodeURIComponent(error.code)}` : ''
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}${codeParam}`
    )
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Missing authorization code')}`
  )
}
