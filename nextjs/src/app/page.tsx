import { createClient } from '@/lib/supabase/server'
import HeroHome from '@/components/dashboard/HeroHome'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const displayName =
    user?.user_metadata?.username ?? user?.email?.split('@')[0] ?? 'friend'

  return (
    <main className="min-h-screen pb-24 px-4 pt-8 max-w-lg mx-auto">
      <HeroHome displayName={displayName} />
    </main>
  )
}
