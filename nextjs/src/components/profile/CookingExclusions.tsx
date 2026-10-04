'use client'

import ExclusionRow from '@/components/profile/ExclusionRow'
import { updateFoodExclusions } from '@/lib/api/profile'

interface CookingExclusionsProps {
  /** `user_profiles.id`, or null when the signed-in user has no profile row yet (e.g. an unattached guest). */
  profileId: string | null
  /** Allergies already stored on the profile. */
  initialAllergies: string[]
  /** Disliked ingredients already stored on the profile. */
  initialDislikes: string[]
}

const NEEDS_ACCOUNT = 'Could not save allergies and dislikes'

/**
 * The profile's two food-exclusion rows (issue #500), under Dietary Preferences.
 *
 * The copy is the point: an allergy is a hard "never suggested" (safety, not
 * preference — nothing the user types in chat overrides it), a dislike is just
 * "left out of suggestions" (a message that asks for the ingredient wins).
 */
export default function CookingExclusions({
  profileId,
  initialAllergies,
  initialDislikes,
}: CookingExclusionsProps) {
  const saveFor =
    (field: 'allergies' | 'disliked_ingredients') =>
    (next: string[]): Promise<void> => {
      if (!profileId) return Promise.reject(new Error(NEEDS_ACCOUNT))
      return updateFoodExclusions(profileId, { [field]: next })
    }

  return (
    <div className="space-y-5">
      <ExclusionRow
        title="Allergies — never suggested"
        listLabel="Allergies"
        inputLabel="Add an allergy"
        addLabel="Add allergy"
        placeholder="e.g. peanut"
        initial={initialAllergies}
        save={saveFor('allergies')}
      />
      <ExclusionRow
        title="Dislikes — left out of suggestions"
        listLabel="Disliked ingredients"
        inputLabel="Add a disliked ingredient"
        addLabel="Add dislike"
        placeholder="e.g. cilantro"
        initial={initialDislikes}
        save={saveFor('disliked_ingredients')}
      />
    </div>
  )
}
