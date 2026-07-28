'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import { refineRecipe } from '@/lib/api/recipes'

interface RefinementHistoryEntry {
  prompt: string
  appliedAt: string
}

interface RecipeRefinementModalProps {
  isOpen: boolean
  onClose: () => void
  recipe: Record<string, unknown>
  onSave: (updated: Record<string, unknown>) => void
}

export default function RecipeRefinementModal({
  isOpen,
  onClose,
  recipe,
  onSave,
}: RecipeRefinementModalProps) {
  const [currentRecipe, setCurrentRecipe] = useState<Record<string, unknown>>(recipe)
  const [history, setHistory] = useState<RefinementHistoryEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const [refining, setRefining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when modal opens with a new recipe
  useEffect(() => {
    if (isOpen) {
      setCurrentRecipe(recipe)
      setHistory([])
      setPrompt('')
      setError(null)
      setSaving(false)
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen, recipe])

  async function handleRefine() {
    const trimmed = prompt.trim()
    if (!trimmed || refining) return
    setRefining(true)
    setError(null)
    try {
      const result = await refineRecipe({ recipe: currentRecipe, prompt: trimmed })
      const updatedRecipe = result.recipe as unknown as Record<string, unknown>
      setCurrentRecipe(updatedRecipe)
      setHistory((prev) => [
        ...prev,
        {
          prompt: trimmed,
          appliedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ])
      setPrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refinement failed. Try again.')
    } finally {
      setRefining(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(currentRecipe)
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleRefine()
    }
  }

  const recipeTitle = typeof currentRecipe.title === 'string' ? currentRecipe.title : 'Recipe'
  const ingredientsCount = Array.isArray(currentRecipe.ingredients)
    ? currentRecipe.ingredients.length
    : 0
  const instructionsCount = Array.isArray(currentRecipe.instructions)
    ? currentRecipe.instructions.length
    : 0
  const hasChanges = history.length > 0

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(92,74,90,0.35)', backdropFilter: 'blur(2px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Modal — slide up from bottom */}
          <motion.div
            key="modal"
            className="fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-3xl overflow-hidden"
            style={{
              background: 'var(--color-bg)',
              maxHeight: '92dvh',
              boxShadow: '0 -8px 40px rgba(92,74,90,0.18)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: 'var(--color-border)' }}
              />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2
                className="text-lg font-extrabold"
                style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
              >
                Refine with AI
              </h2>
              <button
                onClick={onClose}
                className="focus-ring w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70 active:scale-95"
                style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}
                aria-label="Close"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M2 2l12 12M14 2L2 14" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
              {/* Current recipe preview */}
              <div
                className="rounded-2xl p-4"
                style={{
                  background: 'var(--color-surface)',
                  border: '1.5px solid var(--color-border)',
                }}
              >
                <p
                  className="font-extrabold text-base leading-tight"
                  style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
                >
                  {recipeTitle}
                </p>
                <div className="flex gap-3 mt-1">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {ingredientsCount} ingredient{ingredientsCount !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {instructionsCount} step{instructionsCount !== 1 ? 's' : ''}
                  </span>
                  {hasChanges && (
                    <span
                      className="text-xs font-bold"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      {history.length} refinement{history.length !== 1 ? 's' : ''} applied
                    </span>
                  )}
                </div>
              </div>

              {/* Refinement history */}
              {history.length > 0 && (
                <div>
                  <p
                    className="text-xs font-bold uppercase tracking-wider mb-2"
                    style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
                  >
                    History
                  </p>
                  <ul className="space-y-2">
                    <AnimatePresence initial={false}>
                      {history.map((entry, i) => (
                        <motion.li
                          key={i}
                          className="flex items-start justify-between gap-2 rounded-xl px-3 py-2"
                          style={{
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                          }}
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <span
                            className="text-sm leading-snug flex-1"
                            style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
                          >
                            {entry.prompt}
                          </span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                              {entry.appliedAt}
                            </span>
                            <span
                              className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                              style={{
                                background: '#e6f9f0',
                                color: '#2d7a56',
                              }}
                            >
                              Applied
                            </span>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </div>
              )}

              {/* Empty history hint */}
              {history.length === 0 && (
                <p
                  className="text-sm text-center py-4"
                  style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
                >
                  Type a refinement below — e.g. "make it vegetarian" or "reduce cook time"
                </p>
              )}
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  className="mx-5 mb-2 px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{
                    background: '#fff5f5',
                    border: '1.5px solid #f5c0c0',
                    color: '#e05252',
                    fontFamily: 'Nunito, sans-serif',
                  }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input area */}
            <div
              className="flex-shrink-0 px-4 py-3 border-t"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
              }}
            >
              {/* Refinement input row */}
              <div className="flex gap-2 mb-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. make it vegan, less spicy..."
                  disabled={refining}
                  className="focus-ring flex-1 rounded-full px-4 py-2.5 text-sm disabled:opacity-50"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1.5px solid var(--color-border)',
                    color: 'var(--color-text)',
                    fontFamily: 'Nunito, sans-serif',
                  }}
                  aria-label="Refinement prompt"
                />
                <SpringButton
                  onClick={handleRefine}
                  disabled={!prompt.trim() || refining}
                  className="px-4 py-2.5 rounded-full text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 active:scale-95"
                  style={{ background: 'var(--color-primary)' } as React.CSSProperties}
                >
                  {refining ? (
                    <>
                      <svg
                        className="w-3.5 h-3.5 animate-spin"
                        fill="none"
                        viewBox="0 0 16 16"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path d="M8 2a6 6 0 100 12A6 6 0 008 2z" strokeOpacity={0.3} />
                        <path d="M8 2a6 6 0 016 6" strokeLinecap="round" />
                      </svg>
                      Refining...
                    </>
                  ) : (
                    'Send'
                  )}
                </SpringButton>
              </div>

              {/* Save / Discard row */}
              <div className="flex gap-2">
                <SpringButton
                  onClick={handleSave}
                  disabled={!hasChanges || saving}
                  className="flex-1 py-2.5 rounded-full text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                  style={{ background: 'var(--color-accent)' } as React.CSSProperties}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </SpringButton>
                <SpringButton
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-full text-sm font-bold active:scale-95"
                  style={
                    {
                      background: 'var(--color-bg)',
                      color: 'var(--color-muted)',
                      border: '1.5px solid var(--color-border)',
                    } as React.CSSProperties
                  }
                >
                  Discard
                </SpringButton>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
