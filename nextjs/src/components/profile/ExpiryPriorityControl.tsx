'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { updateExpiryPriority } from '@/lib/api/profile'
import { EXPIRY_PRIORITIES, type ExpiryPriority } from '@/lib/expiry-priority'

interface ExpiryPriorityControlProps {
  /** `user_profiles.id`, or null when the signed-in user has no profile row yet (e.g. an unattached guest). */
  profileId: string | null
  /** The level already stored on the profile (Gentle for a profile that never set one). */
  initialValue: ExpiryPriority
}

const LABELS: Record<ExpiryPriority, string> = {
  off: 'Off',
  gentle: 'Gentle',
  aggressive: 'Aggressive',
}

// What the selected level does. An explicit dish request wins at every level, so
// the copy says "where it fits" rather than promising expiring food always appears.
const DESCRIPTIONS: Record<ExpiryPriority, string> = {
  off: "Ignores what's about to expire when suggesting recipes.",
  gentle: 'Works food that is about to expire into suggestions, only where it fits.',
  aggressive: 'Builds suggestions around food that is about to expire wherever it can work.',
}

/**
 * The profile's "Use up expiring food" setting (issue #502): a three-way segmented
 * control persisted to `user_profiles.expiry_priority`. A dish the user asks for by
 * name is never hijacked by expiring food, whatever the level.
 *
 * Same optimistic-change-and-rollback pattern as the dietary chips (#394): the choice
 * shows immediately and is restored if the save fails.
 */
export default function ExpiryPriorityControl({
  profileId,
  initialValue,
}: ExpiryPriorityControlProps) {
  const [value, setValue] = useState<ExpiryPriority>(initialValue)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (next: ExpiryPriority) => {
      if (!profileId) {
        throw new Error('Create an account to save this setting')
      }
      return updateExpiryPriority(profileId, next)
    },
    onSuccess: () => {
      setStatus('saved')
      setErrorMessage(null)
    },
    onError: (err: Error) => {
      setStatus('error')
      setErrorMessage(err.message || 'Could not save')
    },
  })

  const choose = (next: ExpiryPriority) => {
    if (next === value) return
    const previous = value
    setValue(next)
    setStatus('idle')
    setErrorMessage(null)
    mutation.mutate(next, { onError: () => setValue(previous) })
  }

  return (
    <div>
      <p id="expiry-priority-label" className="text-sm font-semibold text-[var(--color-text)] mb-2">
        Use up expiring food
      </p>
      <div
        role="radiogroup"
        aria-label="Use up expiring food"
        className="flex rounded-full border border-[var(--color-primary)] overflow-hidden"
      >
        {EXPIRY_PRIORITIES.map((level) => {
          const selected = level === value
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(level)}
              className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                selected
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-primary)]'
              }`}
            >
              {LABELS[level]}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">{DESCRIPTIONS[value]}</p>
      <p className="mt-1 text-xs min-h-4" aria-live="polite">
        {status === 'saved' && <span className="text-[var(--color-primary)]">Saved!</span>}
        {status === 'error' && <span className="text-[var(--color-coral)]">{errorMessage}</span>}
      </p>
    </div>
  )
}
