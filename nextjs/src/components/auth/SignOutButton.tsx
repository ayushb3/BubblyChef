'use client'

import { useRouter } from 'next/navigation'
import { SignOut } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import SpringButton from '@/components/ui/SpringButton'

export default function SignOutButton() {
  const router = useRouter()

  const handleSignOut = async () => {
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error(error)
      return
    }
    router.push('/login')
    router.refresh()
  }

  return (
    <SpringButton
      onClick={handleSignOut}
      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] text-sm font-semibold hover:border-[#ff9aa2] hover:text-[#ff9aa2] transition-colors"
    >
      <SignOut size={18} weight="fill" />
      Sign out
    </SpringButton>
  )
}
