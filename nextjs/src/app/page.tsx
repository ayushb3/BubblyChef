import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { UserCircle } from '@phosphor-icons/react/dist/ssr'
import BubblesHeader from '@/components/layout/BubblesHeader'
import HeroHome from '@/components/dashboard/HeroHome'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const displayName =
    user?.user_metadata?.username?.trim() || user?.email?.split('@')[0] || 'friend'

  return (
    <main className="min-h-screen pb-24">
      <BubblesHeader
        showSubtitle
        rightSlot={
          <Link
            href="/profile"
            aria-label="Profile"
            className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
          >
            <UserCircle size={24} className="text-[var(--color-primary)]" />
          </Link>
        }
      />
      <div className="px-4 pt-4 max-w-lg mx-auto">
        <HeroHome displayName={displayName} />
      </div>
    </main>
  )
}
