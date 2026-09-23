'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { SignOut } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import SpringButton from '@/components/ui/SpringButton'

export default function SignOutButton() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const handleSignOut = async () => {
    setError(null)
    const supabase = createClient()
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      console.error(signOutError)
      setError('Could not sign out. Please try again.')
      return
    }
    // Drop every cached query (pantry, recipes, bubbles, ...) — otherwise
    // the next sign-in in the same tab renders whatever the previous user
    // last fetched until each query happens to refetch. `BubblePop` in
    // particular derives an award popup from the bubbles balance delta, so
    // a stale cache can show user B an award computed off user A's balance.
    queryClient.clear()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="w-full">
      <SpringButton
        onClick={handleSignOut}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] text-sm font-semibold hover:border-[#ff9aa2] hover:text-[#ff9aa2] transition-colors"
      >
        <SignOut size={18} weight="fill" />
        Sign out
      </SpringButton>
      {error && (
        <p className="mt-2 text-xs text-[#ff9aa2] text-center">{error}</p>
      )}
    </div>
  )
}
