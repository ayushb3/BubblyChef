import { createClient } from '@/lib/supabase/server'

const dietaryPrefs = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free']

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName = user?.user_metadata?.username ?? user?.email?.split('@')[0] ?? 'friend'

  return (
    <div className="pb-24">
      {/* Header strip with avatar */}
      <div className="relative">
        <div className="chowder-panel h-28" />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mascot/bubbles-happy.png"
            alt="Bubbles"
            width={80}
            height={80}
            style={{ width: 80, height: 80, objectFit: 'contain' }}
          />
        </div>
      </div>

      {/* Name */}
      <div className="text-center mt-14 mb-6 px-6">
        <p className="text-xl font-extrabold text-[var(--color-text)]">{displayName}</p>
        {user?.email && (
          <p className="text-sm text-[var(--color-muted)] mt-0.5">{user.email}</p>
        )}
      </div>

      <div className="px-6 space-y-6 max-w-md mx-auto">
        {/* Dietary preferences */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Dietary Preferences
          </p>
          <div className="flex flex-wrap gap-2">
            {dietaryPrefs.map((pref) => (
              <span
                key={pref}
                className="px-4 py-1.5 rounded-full border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium"
              >
                {pref}
              </span>
            ))}
          </div>
        </section>

        {/* About */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            About
          </p>
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            <div className="px-4 py-3 flex justify-between text-sm">
              <span className="text-[var(--color-muted)]">Version</span>
              <span className="text-[var(--color-text)] font-medium">0.1.0</span>
            </div>
            <div className="px-4 py-3 flex justify-between text-sm">
              <span className="text-[var(--color-muted)]">App</span>
              <span className="text-[var(--color-text)] font-medium">BubblyChef ✨</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
