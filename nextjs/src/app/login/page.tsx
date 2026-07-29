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
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: email.split('@')[0] },
          },
        })
        if (error) throw error
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

          <p className="text-center text-sm text-[var(--color-muted)] mt-6">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null) }}
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
