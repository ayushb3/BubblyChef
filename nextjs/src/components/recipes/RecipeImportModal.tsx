'use client'

import { useState, useRef, useEffect } from 'react'
import BubblesMascot from '@/components/ui/BubblesMascot'
import { type Recipe } from './RecipePage'
import PixelSheet from '@/components/ui/PixelSheet'

interface RecipeImportModalProps {
  onImported: (recipe: Partial<Recipe>, sourceUrl: string) => void
  onClose: () => void
}

type ImportState = 'idle' | 'loading' | 'error'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_url: "That doesn't look like a valid URL.",
  fetch_failed: "We couldn't reach that page. Check the URL and try again.",
  paywalled: "That page is behind a paywall and can't be imported.",
  not_a_recipe: "We couldn't find a recipe in that link.",
  // Typed reasons for YouTube video import (issue #528)
  video_unavailable: "We couldn't open that video. It may be private, age-restricted or removed.",
  video_timeout: 'That took too long. Please try again in a moment.',
  video_failed: "We couldn't watch that video right now. Please try again in a moment.",
}

// A video import is Gemini watching the clip, which takes longer than reading a
// page. The server gives up well inside this (60s video call); this is the
// backstop so the modal can never spin forever if the request hangs.
const IMPORT_TIMEOUT_MS = 90_000

const isYouTubeUrl = (s: string) => /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(s.trim())

export default function RecipeImportModal({ onImported, onClose }: RecipeImportModalProps) {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<ImportState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])
  // Close is blocked while an import is in flight (#247): an accidental tap
  // would silently discard the result. PixelSheet sends Escape, the scrim, the
  // header X and drag-dismiss through this one guarded close.
  const handleClose = () => {
    if (state !== 'loading') onClose()
  }

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

    const controller = new AbortController()
    abortRef.current = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, IMPORT_TIMEOUT_MS)

    try {
      const res = await fetch('/api/recipes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
        signal: controller.signal,
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
      const rawRecipe = ('recipe' in raw ? raw.recipe : raw) as Record<string, unknown>
      const recipe: Partial<Recipe> = {
        ...rawRecipe,
        // image_url isn't in the Recipe type but scrapers return it — preserve as thumbnail_url
        thumbnail_url: (rawRecipe.thumbnail_url ?? rawRecipe.image_url ?? null) as string | null,
      }
      onImported(recipe, trimmed)
    } catch {
      // Unmounted (aborted by the cleanup): nothing left to update.
      if (controller.signal.aborted && !timedOut) return
      setErrorMsg(timedOut ? ERROR_MESSAGES.video_timeout : ERROR_MESSAGES.fetch_failed)
      setState('error')
    } finally {
      clearTimeout(timer)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleImport()
  }

  return (
    <PixelSheet
      open
      onClose={handleClose}
      title="Import from URL 🔗"
      titleId="recipe-import-modal-title"
      closeDisabled={state === 'loading'}
      footer={
        <div className="flex gap-3">
          <button
            onClick={handleImport}
            disabled={state === 'loading' || !url.trim()}
            className="font-sans flex-1 py-2.5 rounded-full text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-transform"
            style={{ background: 'var(--color-primary)' }}
          >
            {state === 'loading' ? 'Importing…' : 'Import'}
          </button>
          <button
            onClick={handleClose}
            disabled={state === 'loading'}
            className="font-sans flex-1 py-2.5 rounded-full text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform"
            style={{
              background: 'var(--color-bg)',
              border: '1.5px solid var(--color-border)',
              color: 'var(--color-muted)',
            }}
          >
            Cancel
          </button>
        </div>
      }
    >
      {/* Body */}
      <div className="space-y-3">
        <p
          className="font-sans text-xs text-[var(--color-muted)]"
        >
          Browse a site, copy the recipe URL (or a YouTube recipe video, Shorts work too),
          and paste it below.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'AllRecipes', href: 'https://www.allrecipes.com', noImage: true },
            { label: 'Serious Eats', href: 'https://www.seriouseats.com', noImage: true },
            { label: 'BBC Good Food', href: 'https://www.bbcgoodfood.com/recipes' },
            { label: 'NYT Cooking', href: 'https://cooking.nytimes.com' },
            { label: 'Food Network', href: 'https://www.foodnetwork.com/recipes' },
          ].map(({ label, href, noImage }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={noImage ? 'Images may not be available for this site' : undefined}
              className="font-sans inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold no-underline hover:opacity-80 active:scale-95 transition-all"
              style={{
                background: 'var(--color-bg)',
                border: '1.5px solid var(--color-border)',
                color: 'var(--color-primary-dark)',
              }}
            >
              {label}
              {noImage && <span style={{ color: 'var(--color-warn-icon)' }}>⚠</span>}
              {' '}↗
            </a>
          ))}
        </div>

        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (state === 'error') setState('idle')
          }}
          onKeyDown={handleKeyDown}
          placeholder="Recipe page or YouTube link..."
          disabled={state === 'loading'}
          autoFocus
          className="font-sans w-full rounded-xl px-4 py-2.5 text-sm border focus:border-[var(--color-primary)] disabled:opacity-50"
          style={{
            background: 'var(--color-bg)',
            border: `1.5px solid ${state === 'error' ? 'var(--color-coral)' : 'var(--color-border)'}`,
            color: 'var(--color-text)',
          }}
        />

        {state === 'error' && (
          <p
            className="font-sans text-xs font-semibold"
            style={{ color: 'var(--color-coral)' }}
          >
            {errorMsg}
          </p>
        )}

        {state === 'loading' && (
          <p
            className="font-sans text-xs text-[var(--color-muted)] flex items-center gap-1.5"
          >
            <BubblesMascot state="thinking" size={20} />
            {isYouTubeUrl(url)
              ? 'Watching the video… this can take up to a minute'
              : 'Extracting recipe…'}
          </p>
        )}
      </div>
    </PixelSheet>
  )
}
