'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import FloatingBubbles from '@/components/ui/FloatingBubbles'
import SpringButton from '@/components/ui/SpringButton'
import BubblesMascot from '@/components/ui/BubblesMascot'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleGoogleSignIn = async () => {
    setError(null)
    setCheckEmail(false)
    setGoogleLoading(true)

    // TODO(#382 composition point): if an anonymous (guest) session is active
    // here, this should call `supabase.auth.linkIdentity({ provider: 'google', ... })`
    // instead of `signInWithOAuth`, so the Google identity attaches to the
    // guest's existing UID/pantry instead of starting a fresh account. No
    // #382 branch was available to check against while building this, so
    // this is the straightforward new-sign-in path only. See the callback
    // route (`app/auth/callback/route.ts`) for the fuller note.
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      // On success the browser is redirected to Google, then back to
      // /auth/callback — nothing more to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setGoogleLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCheckEmail(false)
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

            {error && (
              <p className="text-sm text-[#ff9aa2] bg-[#ff9aa2]/10 px-4 py-2 rounded-2xl">
                {error}
              </p>
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
              onClick={() => { setIsSignUp(!isSignUp); setError(null); setCheckEmail(false) }}
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
