'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import FoodAutocomplete from '@/components/pantry/FoodAutocomplete'
import { termKey } from '@/lib/profile-lists'

interface ExclusionRowProps {
  /** Visible heading, e.g. "Allergies — never suggested". */
  title: string
  /** Accessible name for the chip list, e.g. "Allergies". */
  listLabel: string
  /** Accessible name for the text input, e.g. "Add an allergy". */
  inputLabel: string
  /** Accessible name for the add button, e.g. "Add allergy". */
  addLabel: string
  placeholder: string
  /** Entries already stored on the profile, rendered as chips on mount. */
  initial: string[]
  /** Persist the full list. Rejects on failure so the row can roll back. */
  save: (next: string[]) => Promise<void>
}

/**
 * One free-text token row on the profile (issue #500): chips with remove, plus a
 * text field with suggestions from the food catalog (`GET /api/foods/search`,
 * via `FoodAutocomplete`). Free text is always allowed — an allergy to something
 * the catalog doesn't know must still be savable.
 *
 * Same optimistic-change-and-rollback pattern as the dietary chips (#394): the
 * list updates immediately and is restored if the save fails, so the UI never
 * keeps showing an allergy that was never actually persisted.
 */
export default function ExclusionRow({
  title,
  listLabel,
  inputLabel,
  addLabel,
  placeholder,
  initial,
  save,
}: ExclusionRowProps) {
  const [tokens, setTokens] = useState<string[]>(initial)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (next: string[]) => save(next),
    onSuccess: () => {
      setStatus('saved')
      setErrorMessage(null)
    },
    onError: (err: Error) => {
      setStatus('error')
      setErrorMessage(err.message || 'Could not save')
    },
  })

  const commit = (next: string[]) => {
    const previous = tokens
    setTokens(next)
    setStatus('idle')
    setErrorMessage(null)
    mutation.mutate(next, { onError: () => setTokens(previous) })
  }

  const add = (raw: string) => {
    const term = raw.trim().replace(/\s+/g, ' ')
    setDraft('')
    if (!term) return
    if (tokens.some((t) => termKey(t) === termKey(term))) return
    commit([...tokens, term])
  }

  return (
    <div>
      <p className="text-sm font-semibold text-[var(--color-text)] mb-2">{title}</p>
      <ul className="flex flex-wrap gap-2 mb-2" aria-label={listLabel}>
        {tokens.map((token) => (
          <li
            key={termKey(token)}
            className="flex items-center gap-1 pl-3 pr-1 py-1 rounded-full border border-[var(--color-primary)] text-sm font-medium text-[var(--color-primary)]"
          >
            <span>{token}</span>
            <button
              type="button"
              aria-label={`Remove ${token}`}
              onClick={() => commit(tokens.filter((t) => termKey(t) !== termKey(token)))}
              className="w-6 h-6 rounded-full text-base leading-none"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add(draft)
        }}
      >
        <div className="flex-1 min-w-0">
          <FoodAutocomplete
            value={draft}
            onChange={setDraft}
            onSelect={(entry) => add(entry.canonical)}
            placeholder={placeholder}
            ariaLabel={inputLabel}
            className="w-full px-3 py-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)]"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-full border border-[var(--color-primary)] text-sm font-medium text-[var(--color-primary)]"
        >
          {addLabel}
        </button>
      </form>
      <p className="mt-2 text-xs min-h-4" aria-live="polite">
        {status === 'saved' && <span className="text-[var(--color-primary)]">Saved!</span>}
        {status === 'error' && <span className="text-[var(--color-coral)]">{errorMessage}</span>}
      </p>
    </div>
  )
}
