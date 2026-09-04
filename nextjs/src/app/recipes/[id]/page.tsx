'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import SpringButton from '@/components/ui/SpringButton'
import RecipeRefinementModal from '@/components/recipes/RecipeRefinementModal'
import { ingredientParts } from '@/lib/recipe-helpers'
import type { GeneratedRecipe } from '@/types/recipes'

// ─── Meta badge ──────────────────────────────────────────────────────────────

function MetaBadge({ icon, label }: { icon: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
        fontFamily: 'Nunito, sans-serif',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}

// ─── Dietary tag pill ─────────────────────────────────────────────────────────

function DietaryPill({ tag }: { tag: string }) {
  return (
    <span
      className="inline-block px-3 py-1 rounded-full text-xs font-bold"
      style={{
        background: 'var(--color-accent)',
        color: '#fff',
        fontFamily: 'Nunito, sans-serif',
      }}
    >
      {tag}
    </span>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RecipeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : ''

  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showRefinementModal, setShowRefinementModal] = useState(false)

  const fetchRecipe = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/recipes/${id}`)
      if (res.status === 404) {
        setError('not_found')
        return
      }
      if (!res.ok) {
        setError('fetch_error')
        return
      }
      const data: GeneratedRecipe = await res.json()
      setRecipe(data)
    } catch {
      setError('fetch_error')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchRecipe()
  }, [fetchRecipe])

  function toggleIngredient(idx: number) {
    setCheckedIngredients((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/recipes/${id}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/recipes')
      } else {
        setDeleting(false)
        setShowDeleteConfirm(false)
      }
    } catch {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  async function handleRefinementSave(updated: Record<string, unknown>) {
    const res = await fetch(`/api/recipes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    if (res.ok) {
      await fetchRecipe()
    }
    setShowRefinementModal(false)
  }

  const totalTime = recipe?.total_time_minutes
    ? `${recipe.total_time_minutes} min`
    : recipe?.prep_time_minutes || recipe?.cook_time_minutes
    ? `${(recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0)} min`
    : null

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-4 py-16 gap-6"
        style={{ background: 'var(--color-bg)' }}
      >
        <BubblesMascot state="thinking" size={80} />
        <p
          className="text-sm font-semibold"
          style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
        >
          Loading recipe...
        </p>
      </main>
    )
  }

  // ── Error / 404 state ──────────────────────────────────────────────────────
  if (error || !recipe) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-4 py-16 gap-4"
        style={{ background: 'var(--color-bg)' }}
      >
        <BubblesMascot state="surprised" size={90} />
        <h1
          className="text-xl font-extrabold text-center"
          style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
        >
          {error === 'not_found' ? 'Recipe not found' : 'Could not load recipe'}
        </h1>
        <p
          className="text-sm text-center"
          style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
        >
          {error === 'not_found'
            ? "This recipe doesn't exist or was deleted."
            : 'Something went wrong. Please try again.'}
        </p>
        <Link
          href="/recipes"
          className="mt-2 px-6 py-2 rounded-full font-bold text-white text-sm"
          style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
        >
          Back to Recipes
        </Link>
      </main>
    )
  }

  // ── Recipe detail ──────────────────────────────────────────────────────────
  return (
    <>
      <main
        className="min-h-screen pb-24"
        style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}
      >
        <div className="max-w-2xl mx-auto px-4 pt-6">
          {/* Header row */}
          <FadeInView>
            <div className="flex items-start justify-between gap-4 mb-5">
              {/* Back button */}
              <button
                onClick={() => router.push('/recipes')}
                className="flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-70 active:scale-95 flex-shrink-0 mt-1"
                style={{ color: 'var(--color-muted)' }}
              >
                <span aria-hidden>←</span>
                <span>Recipes</span>
              </button>

              {/* Action buttons */}
              <div className="flex gap-2 flex-shrink-0">
                <SpringButton
                  className="px-4 py-2 rounded-full text-sm font-bold text-white active:scale-95"
                  style={{ background: 'var(--color-accent)' } as React.CSSProperties}
                  onClick={() => setShowRefinementModal(true)}
                >
                  Edit with AI
                </SpringButton>
                <SpringButton
                  className="px-4 py-2 rounded-full text-sm font-bold active:scale-95"
                  style={
                    {
                      background: 'var(--color-surface)',
                      color: '#e05252',
                      border: '1.5px solid #f5c0c0',
                    } as React.CSSProperties
                  }
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete
                </SpringButton>
              </div>
            </div>
          </FadeInView>

          {/* Title */}
          <FadeInView delay={0.05}>
            <h1
              className="text-3xl font-extrabold leading-tight mb-3"
              style={{ color: 'var(--color-text)' }}
            >
              {recipe.title}
            </h1>
          </FadeInView>

          {/* Meta row */}
          <FadeInView delay={0.08}>
            <div className="flex flex-wrap gap-2 mb-4">
              {totalTime && <MetaBadge icon="⏱️" label={totalTime} />}
              {recipe.servings && <MetaBadge icon="🍽️" label={`Serves ${recipe.servings}`} />}
              {recipe.difficulty && <MetaBadge icon="⭐" label={recipe.difficulty} />}
              {recipe.cuisine && <MetaBadge icon="🌍" label={recipe.cuisine} />}
              {recipe.meal_type && <MetaBadge icon="🕐" label={recipe.meal_type} />}
            </div>
          </FadeInView>

          {/* Description */}
          {recipe.description && (
            <FadeInView delay={0.1}>
              <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                {recipe.description}
              </p>
            </FadeInView>
          )}

          {/* Delete confirmation */}
          <AnimatePresence>
            {showDeleteConfirm && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="mb-5 p-4 rounded-2xl border flex flex-col gap-2"
                style={{
                  background: '#fff5f5',
                  borderColor: '#f5c0c0',
                }}
              >
                <p className="text-sm font-bold" style={{ color: '#e05252' }}>
                  Are you sure you want to delete this recipe?
                </p>
                <div className="flex gap-2">
                  <SpringButton
                    className="px-4 py-2 rounded-full text-sm font-bold text-white active:scale-95"
                    style={{ background: '#e05252' } as React.CSSProperties}
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting...' : 'Delete'}
                  </SpringButton>
                  <SpringButton
                    className="px-4 py-2 rounded-full text-sm font-bold active:scale-95"
                    style={
                      {
                        background: 'var(--color-surface)',
                        color: 'var(--color-muted)',
                        border: '1.5px solid var(--color-border)',
                      } as React.CSSProperties
                    }
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </SpringButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Ingredients */}
          {recipe.ingredients.length > 0 && (
            <FadeInView delay={0.12}>
              <section className="mb-6">
                <h2
                  className="text-lg font-extrabold mb-3"
                  style={{ color: 'var(--color-text)' }}
                >
                  Ingredients
                </h2>
                <div
                  className="rounded-3xl p-4 space-y-2"
                  style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
                >
                  {recipe.ingredients.map((ing, i) => {
                    const checked = checkedIngredients.has(i)
                    const { label, preparation, optional } = ingredientParts(ing)
                    return (
                      <motion.label
                        key={i}
                        className="flex items-start gap-3 cursor-pointer select-none"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03, duration: 0.25 }}
                      >
                        {/* Custom checkbox */}
                        <div className="flex-shrink-0 mt-0.5">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => toggleIngredient(i)}
                          />
                          <div
                            className="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
                            style={{
                              borderColor: checked ? 'var(--color-accent)' : 'var(--color-border)',
                              background: checked ? 'var(--color-accent)' : 'transparent',
                            }}
                            onClick={() => toggleIngredient(i)}
                          >
                            {checked && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                viewBox="0 0 12 12"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                        </div>
                        <span
                          className="text-sm leading-6 transition-colors"
                          style={{
                            color: checked ? 'var(--color-muted)' : 'var(--color-text)',
                            textDecoration: checked ? 'line-through' : 'none',
                            opacity: checked ? 0.6 : 1,
                          }}
                        >
                          {label}
                          {preparation && (
                            <span style={{ color: 'var(--color-muted)' }}> ({preparation})</span>
                          )}
                          {optional && (
                            <span
                              className="ml-1 text-xs italic"
                              style={{ color: 'var(--color-muted)' }}
                            >
                              optional
                            </span>
                          )}
                        </span>
                      </motion.label>
                    )
                  })}
                </div>
              </section>
            </FadeInView>
          )}

          {/* Instructions */}
          {recipe.instructions.length > 0 && (
            <FadeInView delay={0.15}>
              <section className="mb-6">
                <h2
                  className="text-lg font-extrabold mb-3"
                  style={{ color: 'var(--color-text)' }}
                >
                  Steps
                </h2>
                <ol className="space-y-4">
                  {recipe.instructions.map((step, i) => (
                    <motion.li
                      key={i}
                      className="flex items-start gap-3"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.25 }}
                    >
                      <span
                        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-extrabold"
                        style={{ background: 'var(--color-accent)' }}
                      >
                        {i + 1}
                      </span>
                      <p
                        className="text-sm leading-relaxed pt-1.5"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {step}
                      </p>
                    </motion.li>
                  ))}
                </ol>
              </section>
            </FadeInView>
          )}

          {/* Tips */}
          {recipe.tips && recipe.tips.length > 0 && (
            <FadeInView delay={0.18}>
              <section className="mb-6">
                <div
                  className="rounded-3xl p-4"
                  style={{
                    background: '#fffbea',
                    border: '1.5px solid #ffe9a0',
                  }}
                >
                  <h2 className="text-base font-extrabold mb-2" style={{ color: '#b58a00' }}>
                    Tips
                  </h2>
                  <ul className="space-y-1">
                    {recipe.tips.map((tip, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span>💡</span>
                        <span style={{ color: '#6b5600' }}>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            </FadeInView>
          )}

          {/* Dietary tags */}
          {recipe.dietary_tags && recipe.dietary_tags.length > 0 && (
            <FadeInView delay={0.2}>
              <div className="flex flex-wrap gap-2 mb-6">
                {recipe.dietary_tags.map((tag) => (
                  <DietaryPill key={tag} tag={tag} />
                ))}
              </div>
            </FadeInView>
          )}
        </div>
      </main>

      {/* AI Refinement Modal */}
      <RecipeRefinementModal
        isOpen={showRefinementModal}
        onClose={() => setShowRefinementModal(false)}
        recipe={recipe as unknown as Record<string, unknown>}
        onSave={handleRefinementSave}
      />
    </>
  )
}
