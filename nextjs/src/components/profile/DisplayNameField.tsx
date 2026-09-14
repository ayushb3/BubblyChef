'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PencilSimple, Check, X } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'

interface DisplayNameFieldProps {
  initialName: string
  /** True when initialName is a real username, false when it's an email-derived or guest fallback. */
  hasRealName: boolean
}

export default function DisplayNameField({ initialName, hasRealName }: DisplayNameFieldProps) {
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(initialName)
  const [value, setValue] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const handleEdit = () => {
    setValue(hasRealName ? displayName : '')
    setError(null)
    setEditing(true)
  }

  const handleCancel = () => {
    setValue(displayName)
    setError(null)
    setEditing(false)
  }

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Name cannot be empty')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({
        data: { username: trimmed },
      })
      if (updateError) throw updateError
      setDisplayName(trimmed)
      setEditing(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save name')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="text-center mt-14 mb-6 px-6">
        <div className="flex items-center justify-center gap-2 max-w-xs mx-auto">
          <input
            autoFocus
            type="text"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') handleCancel()
            }}
            placeholder="Your display name"
            className="flex-1 px-4 py-2 rounded-2xl border border-[var(--color-border)] bg-white text-[var(--color-text)] focus:border-[var(--color-primary)] transition-colors text-center text-sm"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            aria-label="Save name"
            className="p-2 rounded-full bg-[var(--color-primary)] text-white disabled:opacity-50"
          >
            <Check size={16} weight="bold" />
          </button>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Cancel"
            className="p-2 rounded-full border border-[var(--color-border)] text-[var(--color-muted)]"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-[#ff9aa2]">{error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="text-center mt-14 mb-6 px-6">
      <div className="flex items-center justify-center gap-2">
        <p className="text-xl font-extrabold text-[var(--color-text)]">{displayName}</p>
        <button
          type="button"
          onClick={handleEdit}
          aria-label="Edit display name"
          className="p-1 rounded-full text-[var(--color-muted)] hover:text-[var(--color-primary)] transition-colors"
        >
          <PencilSimple size={16} weight="fill" />
        </button>
      </div>
    </div>
  )
}
