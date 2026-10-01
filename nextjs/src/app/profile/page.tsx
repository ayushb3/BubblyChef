import { createClient } from '@/lib/supabase/server'
import SaveAccountBanner from '@/components/auth/SaveAccountBanner'
import SignOutButton from '@/components/auth/SignOutButton'
import DisplayNameField from '@/components/profile/DisplayNameField'
import CookingExclusions from '@/components/profile/CookingExclusions'
import DietaryPreferences from '@/components/profile/DietaryPreferences'
import ExpiryPriorityControl from '@/components/profile/ExpiryPriorityControl'
import {
  coerceExpiryPriority,
  DEFAULT_EXPIRY_PRIORITY,
  type ExpiryPriority,
} from '@/lib/expiry-priority'
import SetUpStaplesButton from '@/components/profile/SetUpStaplesButton'
import TakeTourButton from '@/components/profile/TakeTourButton'
import { isGuestUser } from '@/lib/auth/guest'
import ThemePicker from '@/components/ui/ThemePicker'
import BubblesMascot from '@/components/ui/BubblesMascot'

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
  let initialAllergies: string[] = []
  let initialDislikes: string[] = []
  let initialExpiryPriority: ExpiryPriority = DEFAULT_EXPIRY_PRIORITY
  if (user) {
    // `select('*')`, not a named column list: the allergies / dislikes columns
    // come from migration 00018 (#500), and naming a column that doesn't exist yet
    // would fail the whole read and lose the dietary chips too. A row without them
    // simply reads as empty.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    if (profile) {
      profileId = profile.id as string
      initialDietaryPreferences = (profile.dietary_preferences as string[] | null) ?? []
      initialAllergies = (profile.allergies as string[] | null) ?? []
      initialDislikes = (profile.disliked_ingredients as string[] | null) ?? []
      // A row without the column (migration 00018 not applied) or with an unknown
      // value reads as Gentle, the level everyone had before the setting existed.
      initialExpiryPriority = coerceExpiryPriority(profile.expiry_priority)
    }
  }

  return (
    <div className="pb-24">
      {/* Header strip with avatar */}
      <div className="relative">
        <div className="chowder-panel h-28" />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2">
          <BubblesMascot state="happy" size={80} />
        </div>
      </div>

      {/* Editable display name + email */}
      <DisplayNameField initialName={displayName} hasRealName={hasRealName} />
      {user?.email && (
        <p className="text-center text-sm text-[var(--color-muted)] -mt-4 mb-6 px-6">{user.email}</p>
      )}

      <div className="px-6 space-y-6 max-w-md mx-auto">
        {/* Account — permanent save-account for guests; sign-out for real
            accounts only. A guest "signing out" just discards the anonymous
            user (the middleware mints a fresh one on the next request), so
            the button would really mean "delete my guest data" (#587). */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Account
          </p>
          <div className="space-y-3">
            {/* Persistent save-account: stays visible even after the floating banner is dismissed */}
            <SaveAccountBanner persistent />
            {!isGuestUser(user) && <SignOutButton />}
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
          <div className="mt-4">
            <CookingExclusions
              profileId={profileId}
              initialAllergies={initialAllergies}
              initialDislikes={initialDislikes}
            />
          </div>
        </section>

        {/* Expiry priority (#502) — how hard suggestions push food that's about to expire */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Expiring Food
          </p>
          <ExpiryPriorityControl profileId={profileId} initialValue={initialExpiryPriority} />
        </section>

        {/* Your kitchen — the first-run staples + household size step, reachable again (#853) */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Your Kitchen
          </p>
          <SetUpStaplesButton />
        </section>

        {/* Help — replay the first-run coach-mark tour (#390) */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Help
          </p>
          <TakeTourButton />
        </section>
      </div>
    </div>
  )
}
