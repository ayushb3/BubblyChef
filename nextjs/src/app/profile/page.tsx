import { createClient } from '@/lib/supabase/server'
import SaveAccountBanner from '@/components/auth/SaveAccountBanner'
import SignOutButton from '@/components/auth/SignOutButton'
import DisplayNameField from '@/components/profile/DisplayNameField'

const dietaryPrefs = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free']

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const rawUsername = user?.user_metadata?.username as string | undefined
  const displayName = rawUsername || user?.email?.split('@')[0] || 'Guest'
  const hasRealName = !!rawUsername

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

      {/* Editable display name + email */}
      <DisplayNameField initialName={displayName} hasRealName={hasRealName} />
      {user?.email && (
        <p className="text-center text-sm text-[var(--color-muted)] -mt-4 mb-6 px-6">{user.email}</p>
      )}

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

        {/* Account — permanent save-account for guests + sign-out for all */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Account
          </p>
          <div className="space-y-3">
            {/* Persistent save-account: stays visible even after the floating banner is dismissed */}
            <SaveAccountBanner persistent />
            <SignOutButton />
          </div>
        </section>
      </div>
    </div>
  )
}
