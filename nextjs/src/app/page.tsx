import { createClient } from '@/lib/supabase/server'
import HeroHome from '@/components/dashboard/HeroHome'
import { coerceExpiryPriority, DEFAULT_EXPIRY_PRIORITY, type ExpiryPriority } from '@/lib/expiry-priority'

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

  // Expiry priority (#502, #755): read server-side the way the profile page does.
  // Off skips the Bubbles card's "food expires today" case. A guest with no
  // profile row yet, a row from before the column, or a failed read all read as
  // Gentle, the level everyone had before the setting existed.
  let expiryPriority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('expiry_priority')
      .eq('user_id', user.id)
      .maybeSingle()
    expiryPriority = coerceExpiryPriority(profile?.expiry_priority)
  }

  // The kitchen home (#748) owns its own header (eyebrow, title, the bubbles
  // counter, the bell and the profile button) and runs full-bleed, so the page
  // adds no header and no side padding.
  return (
    <main className="min-h-screen pb-24">
      <HeroHome
        displayName={displayName}
        initialKitchenTheme={initialKitchenTheme}
        initialExpiryPriority={expiryPriority}
      />
    </main>
  )
}
