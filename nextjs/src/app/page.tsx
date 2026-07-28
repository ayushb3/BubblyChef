import { createClient } from '@/lib/supabase/server'
import BubblesHeader from '@/components/layout/BubblesHeader'
import HeroHome from '@/components/dashboard/HeroHome'
import ThemePicker from '@/components/ui/ThemePicker'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const displayName =
    user?.user_metadata?.username ?? user?.email?.split('@')[0] ?? 'friend'

  return (
    <main className="min-h-screen pb-24">
      <BubblesHeader showSubtitle rightSlot={<ThemePicker />} />
      <div className="px-4 pt-4 max-w-lg mx-auto">
        <HeroHome displayName={displayName} />
      </div>
    </main>
  )
}
