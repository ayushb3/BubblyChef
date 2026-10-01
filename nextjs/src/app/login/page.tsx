'use client'

import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { takeLoginEmail } from '@/lib/auth/login-prefill'
import { isGuestUser } from '@/lib/auth/guest'
import {
  clearAccountSwitchTried,
  clearLoginLinkStarted,
  consumeLoginLinkStarted,
  markLoginLinkStarted,
  hasTriedAccountSwitch,
  isLinkCollisionCode,
  isSessionMissingError,
  markAccountSwitchTried,
} from '@/lib/auth/google-link'
import { useRouter } from 'next/navigation'
import FloatingBubbles from '@/components/ui/FloatingBubbles'
import SpringButton from '@/components/ui/SpringButton'
import BubblesMascot from '@/components/ui/BubblesMascot'

// Shown while a colliding guest is being signed in to the existing account.
const COLLISION_SWITCHING_MESSAGE =
  'You already have a BubblyChef account with that Google login. Signing you in. Your guest pantry stays behind.'

// Shown when the automatic switch can't run (redirect failed to start, session
// unreadable, or no sessionStorage to guard a loop): the user does it with a
// click instead.
const COLLISION_FALLBACK_MESSAGE =
  "That Google account already belongs to a different BubblyChef account. You can sign in to it instead, but your guest pantry won't move over."

// Shown when switching can't help: the visitor isn't a guest (their plain
// sign-in itself collided) or a switch was already tried once. Never mentions a
// guest pantry.
const EXISTING_EMAIL_MESSAGE =
  'That email already has a BubblyChef account. Sign in with your email and password instead.'

const SESSION_CHECK_FAILED_MESSAGE = "Couldn't check your current session. Please try again."

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  // A collision (#389) is being resolved by signing in to the existing account.
  const [switchingAccount, setSwitchingAccount] = useState(false)
  // Show the manual "sign in to that account instead" button.
  const [showSignInInstead, setShowSignInInstead] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()

  // /auth/callback redirects failed OAuth attempts back here with
  // ?error=<message> (missing code, a failed exchange, or the provider's own
  // error_description) — read via window.location rather than
  // useSearchParams() to avoid a Suspense boundary for what's otherwise a
  // plain client page. Read once on mount and strip the params so a refresh
  // doesn't keep re-showing a stale error.
  //
  // A guest's linkIdentity collision (#389) mostly arrives this way: Supabase
  // only learns the Google account belongs to another user after Google
  // redirects back, so it shows up as ?error=...&error_code=<collision code>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    if (oauthError) {
      if (isLinkCollisionCode(params.get('error_code'))) {
        void handleCollision()
      } else {
        clearAccountSwitchTried()
        clearLoginLinkStarted()
        // Deliberate: any error we don't recognise shows Supabase's own text.
        setError(oauthError)
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('error')
      url.searchParams.delete('error_code')
      window.history.replaceState({}, '', url.toString())
    } else {
      // A clean load of /login ends any earlier switch attempt.
      clearAccountSwitchTried()
      clearLoginLinkStarted()
    }
    // Mount-only: read the redirect's params once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Prefill the email handed over from the profile's "Save your account"
  // card (#588).
  useEffect(() => {
    const stashed = takeLoginEmail()
    if (stashed) setEmail(stashed)
  }, [])

  // Plain Google sign-in (no guest check). Used for a non-guest's normal click
  // and to sign a colliding guest in to the account that owns the Google
  // identity. Never merges: the guest's data stays under the anonymous user id.
  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw error
  }

  const showCollisionFallback = () => {
    setSwitchingAccount(false)
    setGoogleLoading(false)
    setError(COLLISION_FALLBACK_MESSAGE)
    setShowSignInInstead(true)
  }

  // The Google account already belongs to another BubblyChef user. Someone
  // who clicked Google here wants into their account, so a guest is signed in
  // to it directly rather than asked for a second click. Only when THIS browser
  // started the link from /login (the marker) and only once per attempt: a
  // collision from anywhere else (the profile banner, a hand-made URL) gets the
  // message and the manual button, and a second collision or a non-guest gets
  // the email/password hint.
  async function handleCollision() {
    const startedHere = consumeLoginLinkStarted()
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError && !isSessionMissingError(userError)) {
        showCollisionFallback()
        return
      }
      if (!isGuestUser(user) || hasTriedAccountSwitch()) {
        clearAccountSwitchTried()
        setSwitchingAccount(false)
        setShowSignInInstead(false)
        setGoogleLoading(false)
        setError(EXISTING_EMAIL_MESSAGE)
        return
      }
      if (!startedHere) {
        showCollisionFallback()
        return
      }
      // Without the one-shot flag a deterministic collision could loop, so no
      // storage means no automatic switch.
      if (!markAccountSwitchTried()) {
        showCollisionFallback()
        return
      }
      setError(null)
      setShowSignInInstead(false)
      setSwitchingAccount(true)
      setGoogleLoading(true)
      await signInWithGoogle()
    } catch {
      showCollisionFallback()
    }
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setCheckEmail(false)
    setShowSignInInstead(false)
    setGoogleLoading(true)

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      // Fail closed. A failed session check (network error, expired token)
      // returns a null user, which would read as "not a guest" and take the
      // signInWithOAuth path: a new account, with the guest's data orphaned
      // under the old user id (the bug #389 fixes). Only "no session at all"
      // is a genuine non-guest.
      if (userError && !isSessionMissingError(userError)) {
        setError(SESSION_CHECK_FAILED_MESSAGE)
        setGoogleLoading(false)
        return
      }

      if (isGuestUser(user)) {
        // Attach Google to the guest's existing user id so their pantry,
        // recipes and chat carry over (same call as SaveAccountBanner, #382).
        // The marker lets a collision on the way back auto-switch; see handleCollision.
        markLoginLinkStarted()
        const { error } = await supabase.auth.linkIdentity({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        })
        if (error) {
          if (isLinkCollisionCode(error.code)) {
            await handleCollision()
            return
          }
          throw error
        }
      } else {
        await signInWithGoogle()
      }
      // On success the browser is redirected to Google, then back to
      // /auth/callback — nothing more to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setGoogleLoading(false)
    }
  }

  // The manual fallback: plain sign-in to the account that owns the Google
  // identity. Marks the one-shot flag so a repeat collision stops at the
  // email/password hint instead of switching again.
  const handleSignInInstead = async () => {
    setError(null)
    setShowSignInInstead(false)
    setGoogleLoading(true)
    markAccountSwitchTried()
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setGoogleLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCheckEmail(false)
    setShowSignInInstead(false)
    setLoading(true)

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: email.split('@')[0] },
          },
        })
        if (error) throw error
        // When email confirmation is enabled, signUp succeeds but returns no
        // session. Pushing to `/` would bounce off the auth middleware with no
        // message. Stay put and tell the user to confirm their email instead.
        if (!data.session) {
          setCheckEmail(true)
          return
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
      }
      // A guest (or another user) may have populated React Query's cache in
      // this same tab — e.g. the starter-context pills (issue #651), whose
      // cache key isn't user-scoped and outlives sign-out only via the
      // sign-out path's own clear. Without this, a guest who signs into a
      // real account here can see the guest's cached data for up to the
      // longest `staleTime` in play (5 min for starter context) before it
      // naturally refetches.
      queryClient.clear()
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
      <FloatingBubbles />

      <div className="relative z-10 w-full max-w-sm">
        <div className="bg-[var(--color-surface)] rounded-3xl p-8 shadow-lg border border-[var(--color-border)]">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="mb-3 flex justify-center">
              <BubblesMascot state="happy" size={100} />
            </div>
            <h1 className="text-3xl font-extrabold text-[var(--color-primary)]">
              BubblyChef
            </h1>
            <p className="text-sm text-[var(--color-muted)] mt-1">
              Your kawaii kitchen companion ✨
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-white text-[var(--color-text)] focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-muted)]"
                placeholder="you@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-2xl border border-[var(--color-border)] bg-white text-[var(--color-text)] focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-muted)]"
                placeholder="Min 6 characters"
              />
            </div>

            {checkEmail && (
              <p className="text-sm text-[var(--color-text)] bg-[var(--color-accent)]/10 px-4 py-2 rounded-2xl">
                Almost there! Check your inbox for a confirmation link, then sign in.
              </p>
            )}

            {switchingAccount && (
              <p className="text-sm text-[var(--color-text)] bg-[var(--color-accent)]/10 px-4 py-2 rounded-2xl">
                {COLLISION_SWITCHING_MESSAGE}
              </p>
            )}

            {error && (
              <p className="text-sm text-[var(--color-coral)] bg-[var(--color-coral)]/10 px-4 py-2 rounded-2xl">
                {error}
              </p>
            )}

            {showSignInInstead && (
              <SpringButton
                type="button"
                onClick={handleSignInInstead}
                disabled={googleLoading}
                className="w-full py-2.5 px-4 rounded-full bg-white border border-[var(--color-border)] text-[var(--color-text)] text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sign in to that account instead
              </SpringButton>
            )}

            <SpringButton
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-full bg-[var(--color-primary)] text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '...' : isSignUp ? 'Sign Up' : 'Sign In'}
            </SpringButton>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-[var(--color-border)]" />
            <span className="text-xs text-[var(--color-muted)]">or</span>
            <div className="h-px flex-1 bg-[var(--color-border)]" />
          </div>

          <SpringButton
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full py-3 px-4 rounded-full bg-white border border-[var(--color-border)] text-[var(--color-text)] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 009 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.95 10.7A5.4 5.4 0 013.68 9c0-.59.1-1.17.27-1.7V4.97H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"
              />
            </svg>
            {googleLoading ? '...' : 'Continue with Google'}
          </SpringButton>

          <p className="text-center text-sm text-[var(--color-muted)] mt-6">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setCheckEmail(false); setShowSignInInstead(false) }}
              className="text-[var(--color-accent)] underline font-medium"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
