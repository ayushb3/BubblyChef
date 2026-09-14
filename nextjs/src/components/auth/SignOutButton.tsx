'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SignOut } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import SpringButton from '@/components/ui/SpringButton'

export default function SignOutButton() {
  const router = useRouter()
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
