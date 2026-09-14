'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isGuestUser } from '@/lib/auth/guest'
import SpringButton from '@/components/ui/SpringButton'

/**
 * Low-pressure, dismissible prompt offering a guest (anonymous Supabase
 * session, issue #382) the option to add real credentials. Renders nothing
 * for a signed-in-for-real user.
 *
 * Uses `supabase.auth.updateUser({ email, password })` — the SDK's
 * identity-linking path for converting an anonymous session in place. The
 * UID never changes, so everything the guest already added (pantry,
 * recipes) carries over with no migration step. Supabase emails a
 * confirmation link (routed through the existing `/auth/callback` handler);
 * until it's clicked, `is_anonymous` stays `true`, so the banner keeps
 * showing a "check your email" state rather than disappearing early.
 */
interface SaveAccountBannerProps {
  /**
   * When true the dismiss/collapse affordances are hidden — use this for the
   * permanent profile-page entry point so guests can always access save-account
   * even after dismissing the floating banner (issue #393).
   */
  persistent?: boolean
}

export default function SaveAccountBanner({ persistent = false }: SaveAccountBannerProps) {
  const [isGuest, setIsGuest] = useState(false)
  const [expanded, setExpanded] = useState(persistent)
  const [dismissed, setDismissed] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (active) setIsGuest(isGuestUser(user))
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsGuest(isGuestUser(session?.user))
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  if (!isGuest || (!persistent && dismissed)) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ email, password })
      if (updateError) throw updateError
      setCheckEmail(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)] text-left"
      >
        <span className="text-sm font-medium text-[var(--color-text)]">
          🫧 You&apos;re browsing as a guest — save your account to keep your pantry safe
        </span>
        {!persistent && (
          <span
            role="button"
            aria-label="Dismiss for now"
            onClick={(e) => {
              e.stopPropagation()
              setDismissed(true)
            }}
            className="text-[var(--color-muted)] text-xs shrink-0"
          >
            ✕
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-accent)] p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-[var(--color-text)]">
          🫧 Save your account
        </p>
        {!persistent && (
          <button
            type="button"
            aria-label="Collapse"
            onClick={() => setExpanded(false)}
            className="text-[var(--color-muted)] text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {checkEmail ? (
        <p className="text-sm text-[var(--color-text)] bg-[var(--color-accent)]/10 px-4 py-2 rounded-2xl">
          Almost there! Check your inbox and confirm to finish saving your account.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-xs text-[var(--color-muted)]">
            Add an email + password and your guest pantry stays exactly as it is —
            nothing to redo.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@email.com"
            aria-label="Email"
            className="w-full px-4 py-2.5 rounded-2xl border border-[var(--color-border)] bg-white text-[var(--color-text)] focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-muted)] text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Min 6 characters"
            aria-label="Password"
            className="w-full px-4 py-2.5 rounded-2xl border border-[var(--color-border)] bg-white text-[var(--color-text)] focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-muted)] text-sm"
          />
          {error && (
            <p className="text-sm text-[#ff9aa2] bg-[#ff9aa2]/10 px-4 py-2 rounded-2xl">
              {error}
            </p>
          )}
          <SpringButton
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-full bg-[var(--color-primary)] text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '...' : 'Save my account'}
          </SpringButton>
        </form>
      )}
    </div>
  )
}
