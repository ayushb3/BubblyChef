import { createClient } from '@/lib/supabase/server'
import BubblesHeader from '@/components/layout/BubblesHeader'
import HeroHome from '@/components/dashboard/HeroHome'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const displayName =
    user?.user_metadata?.username ?? user?.email?.split('@')[0] ?? 'friend'

  return (
    <main className="min-h-screen pb-24">
      <BubblesHeader showSubtitle />
      <div className="px-4 pt-4 max-w-lg mx-auto">
        <HeroHome displayName={displayName} />
      </div>
    </main>
  )
}
