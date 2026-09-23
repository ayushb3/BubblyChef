import { createClient } from '@/lib/supabase/server'
import SaveAccountBanner from '@/components/auth/SaveAccountBanner'
import SignOutButton from '@/components/auth/SignOutButton'
import DisplayNameField from '@/components/profile/DisplayNameField'
import DietaryPreferences from '@/components/profile/DietaryPreferences'
import ThemePicker from '@/components/ui/ThemePicker'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const rawUsername = user?.user_metadata?.username as string | undefined
  const displayName = rawUsername || user?.email?.split('@')[0] || 'Guest'
  const hasRealName = !!rawUsername

  // Guests without an attached email have no user_profiles row yet (see
  // 00009_guest_profile_on_email.sql) — "no profile yet" is a handled state,
  // not an error, so profileId/initialSelected fall back to null/[].
  let profileId: string | null = null
  let initialDietaryPreferences: string[] = []
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, dietary_preferences')
      .eq('user_id', user.id)
      .single()
    if (profile) {
      profileId = profile.id as string
      initialDietaryPreferences = (profile.dietary_preferences as string[] | null) ?? []
    }
  }

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

        {/* Appearance */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Appearance
          </p>
          <div className="flex items-center justify-between bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] px-4 py-3">
            <span className="text-sm text-[var(--color-text)]">Theme</span>
            <ThemePicker />
          </div>
        </section>

        {/* Dietary preferences */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Dietary Preferences
          </p>
          <DietaryPreferences profileId={profileId} initialSelected={initialDietaryPreferences} />
        </section>
      </div>
    </div>
  )
}
