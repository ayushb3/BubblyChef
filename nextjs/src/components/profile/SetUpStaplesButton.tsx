'use client'

import { useTour } from '@/components/onboarding/TourProvider'
import SpringButton from '@/components/ui/SpringButton'

/**
 * Profile entry to the first-run staples sheet (issue #853): tick what you keep
 * on hand and set your household size (the default servings). Opening it here
 * does not start the tour afterwards.
 */
export default function SetUpStaplesButton() {
  const { openStaples } = useTour()

  return (
    <div>
      <SpringButton fullWidth variant="secondary" onClick={openStaples}>
        Staples &amp; household size 🧂
      </SpringButton>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Tick what you usually have, and how many you cook for. Items already in your kitchen aren’t added twice.
      </p>
    </div>
  )
}
