'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { type Recipe } from './RecipePage'

interface RecipeImportModalProps {
  onImported: (recipe: Partial<Recipe>) => void
  onClose: () => void
}

type ImportState = 'idle' | 'loading' | 'error'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_url: "That doesn't look like a valid URL.",
  fetch_failed: "We couldn't reach that page. Check the URL and try again.",
  paywalled: "That page is behind a paywall and can't be imported.",
  not_a_recipe: "We couldn't find a recipe on that page.",
}

export default function RecipeImportModal({ onImported, onClose }: RecipeImportModalProps) {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<ImportState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const isValidUrl = (s: string) => {
    try {
      new URL(s)
      return s.startsWith('http://') || s.startsWith('https://')
    } catch {
      return false
    }
  }

  const handleImport = async () => {
    const trimmed = url.trim()
    if (!isValidUrl(trimmed)) {
      setErrorMsg(ERROR_MESSAGES.invalid_url)
      setState('error')
      return
    }

    setState('loading')
    setErrorMsg('')

    try {
      const res = await fetch('/api/recipes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const reason = (data as { reason?: string }).reason ?? 'fetch_failed'
        setErrorMsg(ERROR_MESSAGES[reason] ?? ERROR_MESSAGES.fetch_failed)
        setState('error')
        return
      }

      const raw = await res.json()
      // AI service wraps in { recipe: ... } envelope
      const recipe: Partial<Recipe> = 'recipe' in raw ? raw.recipe : raw
      onImported(recipe)
    } catch {
      setErrorMsg(ERROR_MESSAGES.fetch_failed)
      setState('error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleImport()
  }

  return (
    <AnimatePresence>
      <>
        <motion.div
          key="import-backdrop"
          className="fixed inset-0 z-50"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        />

        <motion.div
          key="import-panel"
          className="fixed inset-x-4 top-1/2 z-50 rounded-2xl overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            maxWidth: '440px',
            marginInline: 'auto',
            transform: 'translateY(-50%)',
          }}
          initial={{ y: 'calc(-50% + 20px)', opacity: 0 }}
          animate={{ y: '-50%', opacity: 1 }}
          exit={{ y: 'calc(-50% + 20px)', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h2
              className="text-base font-extrabold"
              style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
            >
              Import from URL 🔗
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70 active:scale-95"
              style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-3">
            <p
              className="text-xs text-[var(--color-muted)]"
              style={{ fontFamily: 'Nunito, sans-serif' }}
            >
              Paste a link from AllRecipes, NYT Cooking, BBC Good Food, Serious Eats, and more.
            </p>

            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (state === 'error') setState('idle')
              }}
              onKeyDown={handleKeyDown}
              placeholder="https://www.allrecipes.com/recipe/..."
              disabled={state === 'loading'}
              autoFocus
              className="w-full rounded-xl px-4 py-2.5 text-sm outline-none border focus:border-[var(--color-primary)] disabled:opacity-50"
              style={{
                background: 'var(--color-bg)',
                border: `1.5px solid ${state === 'error' ? 'var(--color-coral)' : 'var(--color-border)'}`,
                color: 'var(--color-text)',
                fontFamily: 'Nunito, sans-serif',
              }}
            />

            {state === 'error' && (
              <p
                className="text-xs font-semibold"
                style={{ color: 'var(--color-coral)', fontFamily: 'Nunito, sans-serif' }}
              >
                {errorMsg}
              </p>
            )}

            {state === 'loading' && (
              <p
                className="text-xs text-[var(--color-muted)] flex items-center gap-1.5"
                style={{ fontFamily: 'Nunito, sans-serif' }}
              >
                <span className="inline-block animate-spin">⏳</span>
                Extracting recipe…
              </p>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex gap-3 px-5 py-4 border-t"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <button
              onClick={handleImport}
              disabled={state === 'loading' || !url.trim()}
              className="flex-1 py-2.5 rounded-full text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-transform"
              style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
            >
              {state === 'loading' ? 'Importing…' : 'Import'}
            </button>
            <button
              onClick={onClose}
              disabled={state === 'loading'}
              className="flex-1 py-2.5 rounded-full text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform"
              style={{
                background: 'var(--color-bg)',
                border: '1.5px solid var(--color-border)',
                color: 'var(--color-muted)',
                fontFamily: 'Nunito, sans-serif',
              }}
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </>
    </AnimatePresence>
  )
}
