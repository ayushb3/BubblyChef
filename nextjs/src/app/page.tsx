import { createClient } from '@/lib/supabase/server'
import BubblesHeader from '@/components/layout/BubblesHeader'
import ProfileHeaderButton from '@/components/layout/ProfileHeaderButton'
import HeroHome from '@/components/dashboard/HeroHome'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const displayName =
    user?.user_metadata?.username?.trim() || user?.email?.split('@')[0] || 'Bubbly'
  // Kitchen theme (#523): read server-side same as displayName above, so
  // there's no client round trip and no flash of the wrong theme before
  // hydration. `resolveKitchenTheme` (in useKitchenTheme) still validates
  // this against the balance/catalog on the client.
  const initialKitchenTheme: string | null = user?.user_metadata?.kitchen_theme ?? null

  return (
    <main className="min-h-screen pb-24">
      <BubblesHeader
        showSubtitle
        rightSlot={<ProfileHeaderButton />}
      />
      <div className="px-4 pt-4 max-w-lg mx-auto">
        <HeroHome displayName={displayName} initialKitchenTheme={initialKitchenTheme} />
      </div>
    </main>
  )
}
