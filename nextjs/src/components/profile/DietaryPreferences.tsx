'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { updateDietaryPreferences } from '@/lib/api/profile'

const DIETARY_PREFS = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free']

interface DietaryPreferencesProps {
  /** `user_profiles.id`, or null when the signed-in user has no profile row yet (e.g. an unattached guest). */
  profileId: string | null
  /** Preferences already stored on the profile, rendered as pre-selected on mount. */
  initialSelected: string[]
}

export default function DietaryPreferences({ profileId, initialSelected }: DietaryPreferencesProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (next: string[]) => {
      if (!profileId) {
        throw new Error('Create an account to save dietary preferences')
      }
      return updateDietaryPreferences(profileId, next)
    },
    onSuccess: () => {
      setStatus('saved')
      setErrorMessage(null)
    },
    onError: (err: Error) => {
      setStatus('error')
      setErrorMessage(err.message || 'Could not save preferences')
    },
  })

  const handleToggle = (pref: string) => {
    const previous = selected
    const next = selected.includes(pref)
      ? selected.filter((p) => p !== pref)
      : [...selected, pref]

    // Optimistic toggle; roll back to the pre-toggle selection if the save fails,
    // so the UI never keeps showing a state that was never actually persisted.
    setSelected(next)
    setStatus('idle')
    setErrorMessage(null)
    mutation.mutate(next, { onError: () => setSelected(previous) })
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Dietary preferences">
        {DIETARY_PREFS.map((pref) => {
          const isSelected = selected.includes(pref)
          return (
            <button
              key={pref}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => handleToggle(pref)}
              className={`px-4 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                isSelected
                  ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                  : 'border-[var(--color-primary)] text-[var(--color-primary)]'
              }`}
            >
              {pref}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs h-4" aria-live="polite">
        {status === 'saved' && <span className="text-[var(--color-primary)]">Saved!</span>}
        {status === 'error' && <span className="text-[#ff9aa2]">{errorMessage}</span>}
      </p>
    </div>
  )
}
