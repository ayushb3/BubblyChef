import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth callback for Supabase's PKCE flow (issue #383 — Google sign-in).
 *
 * Google redirects here with a `code` query param after the user
 * authorizes. We exchange it for a session (this sets the auth cookies via
 * the server client's `setAll`) and then send the user into the app.
 *
 * Composition point with issue #382 (guest mode / anonymous auth, landing in
 * parallel — no branch for it was visible in this worktree at the time this
 * was written): if the browser still holds an anonymous session when Google
 * redirects back here, `exchangeCodeForSession` as used below will replace it
 * with a brand new signed-in session/UID rather than linking the Google
 * identity onto the existing anonymous UID, so the guest's pantry data would
 * be silently orphaned. Supabase's fix for that is to call
 * `linkIdentity({ provider: 'google' })` from the *client* while the
 * anonymous session is still active (before ever hitting this route), instead
 * of `signInWithOAuth` — that's a change to the caller in `login/page.tsx`
 * (or wherever the guest's "upgrade to a real account" entry point lives),
 * not to this callback. Left as-is pending #382 landing; whoever picks this
 * up next should check for an active anonymous session before choosing
 * `signInWithOAuth` vs `linkIdentity`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description')
  const next = searchParams.get('next') ?? '/'

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription)}`
    )
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
