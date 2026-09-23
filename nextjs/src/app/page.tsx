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
  // both the server-rendered HTML and the client's first render already
  // agree on it — no client round trip needed before the first paint picks
  // the right key. The balance (needed to know which themes are *unlocked*)
  // is still client-only (`/api/bubbles`), so `useKitchenTheme` trusts this
  // key optimistically until that resolves — see
  // `resolveKitchenThemeOptimistic`'s docstring in `lib/kitchen/themes.ts`
  // for why that's safe (post-merge review on PR #594, finding 2).
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
