import { createClient } from '@/lib/supabase/server'
import BubblesHeader from '@/components/layout/BubblesHeader'
import ProfileHeaderButton from '@/components/layout/ProfileHeaderButton'
import BubblesPill from '@/components/layout/BubblesPill'
import HeroHome from '@/components/dashboard/HeroHome'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const displayName =
    user?.user_metadata?.username?.trim() || user?.email?.split('@')[0] || 'Bubbly'

  return (
    <main className="min-h-screen pb-24">
      <BubblesHeader
        showSubtitle
        rightSlot={
          <div className="flex items-center gap-2">
            <BubblesPill />
            <ProfileHeaderButton />
          </div>
        }
      />
      <div className="px-4 pt-4 max-w-lg mx-auto">
        <HeroHome displayName={displayName} />
      </div>
    </main>
  )
}
