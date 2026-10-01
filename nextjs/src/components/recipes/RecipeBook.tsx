'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import type { Recipe } from './RecipePage'
import RecipeCard from './RecipeCard'
import PantryRecipeDetail from './PantryRecipeDetail'
import RecipeSearchBar from './RecipeSearchBar'
import EmptyState from '@/components/ui/EmptyState'
import RecipeEditModal from './RecipeEditModal'
import RecipeDeleteConfirm from './RecipeDeleteConfirm'
import RecipeImportModal from './RecipeImportModal'
import CookModal from './CookModal'
import GuidedCookFlow from './GuidedCookFlow'
import {
  startGuidedCookSession,
  getActiveCookSession,
  clearActiveCookSession,
  markGuidedFlowOpen,
  clearGuidedFlowOpen,
  wasGuidedFlowOpen,
  getAmendedIngredients,
} from '@/lib/cook-session'
import { toRecipeIngredients } from '@/lib/cook-amendment'
import SpringButton from '@/components/ui/SpringButton'

interface RecipeBookProps {
  recipes: Recipe[]
  onMutate?: () => void
  /**
   * `?resume=<recipe id>` (issue #755): the Bubbles card's "Pick up at step N". A
   * saved guided cook for this recipe reopens directly at its step instead of
   * asking "Resume cooking?" again: the user just said so on home.
   */
  resumeRecipeId?: string | null
}

function scoreRecipe(r: Recipe, q: string): number {
  const lq = q.toLowerCase()
  let score = 0
  const title = r.title.toLowerCase()
  if (title.startsWith(lq)) score += 3
  else if (title.includes(lq)) score += 2
  if (r.tags?.some((t) => t.toLowerCase().includes(lq))) score += 1
  if (r.cuisine?.toLowerCase().includes(lq)) score += 1
  if (r.meal_type?.toLowerCase().includes(lq)) score += 1
  if ((r.description ?? '').toLowerCase().includes(lq)) score += 0.5
  return score
}

export default function RecipeBook({ recipes, onMutate, resumeRecipeId = null }: RecipeBookProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  // The recipe opened in place (issue #801); null is the list. Edit and delete are
  // started from a card in the list or from the opened recipe, so they name their
  // own recipe instead of leaning on the opened one.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [cookOpen, setCookOpen] = useState(false)
  const [guidedCookOpen, setGuidedCookOpen] = useState(false)
  const [resumeStep, setResumeStep] = useState<number | null>(null)
  const resumeCheckedRef = useRef(false)
  // "Resume cooking?" banner (PR #475) — set on a fresh visit that finds a
  // saved session that was NOT left open in this tab (see the fresh-visit
  // vs. reload rule on the resume-check effect below). Null when there is
  // nothing to offer resuming.
  const [resumeBanner, setResumeBanner] = useState<{
    recipeId: string
    title: string
    step: number
    totalSteps: number
  } | null>(null)
  const [importDraft, setImportDraft] = useState<Partial<Recipe> | null>(null)
  const [mutating, setMutating] = useState(false)
  // Local optimistic overrides for favorite state — avoids full re-fetch on toggle
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({})
  // Same pattern, for structured steps a guided-cook session just ensured
  // (issue #648): the AI service already persisted them, this just keeps
  // this session's copy of `recipes` in sync so re-opening guided cook mode
  // for the same recipe doesn't repeat the ensure call.
  const [stepsOverrides, setStepsOverrides] = useState<Record<string, Recipe['steps']>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [thumbError, setThumbError] = useState(false)

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 5000)
    return () => clearTimeout(t)
  }, [errorMessage])

  // Merge optimistic favorite + structured-steps overrides into the recipe list
  const recipesWithOverrides = useMemo(
    () =>
      recipes.map((r) => {
        const withFavorite = r.id in favoriteOverrides ? { ...r, is_favorite: favoriteOverrides[r.id] } : r
        return r.id in stepsOverrides ? { ...withFavorite, steps: stepsOverrides[r.id] } : withFavorite
      }),
    [recipes, favoriteOverrides, stepsOverrides],
  )

  const filteredRecipes = useMemo(
    () =>
      search
        ? recipesWithOverrides
            .map((r) => ({ r, score: scoreRecipe(r, search) }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .map(({ r }) => r)
        : recipesWithOverrides,
    [recipesWithOverrides, search],
  )

  const selectedRecipe = recipesWithOverrides.find((r) => r.id === selectedId) ?? null
  const editRecipe = recipesWithOverrides.find((r) => r.id === editId) ?? null

  // #489/#490: a mid-cook amendment confirmed in chat for the recipe being
  // cooked. It is an overlay on what this cook shows and deducts, read when a
  // cook surface opens; it is never merged into `recipesWithOverrides`, so the
  // saved recipe (card, detail, edit) is never changed by it.
  const selectedRecipeId = selectedRecipe?.id ?? null
  const amendedIngredients = useMemo(
    () => (selectedRecipeId && (cookOpen || guidedCookOpen) ? getAmendedIngredients(selectedRecipeId) : null),
    [selectedRecipeId, cookOpen, guidedCookOpen],
  )
  const guidedRecipe = useMemo(
    () =>
      selectedRecipe && amendedIngredients
        ? { ...selectedRecipe, ingredients: toRecipeIngredients(amendedIngredients) }
        : selectedRecipe,
    [selectedRecipe, amendedIngredients],
  )

  // Issue #441 / PR #475 — resume an in-progress guided cook after a full
  // page reload, but only *directly* re-open the flow when this looks like
  // that same reload rather than a fresh visit to /recipes.
  //
  // Fresh-visit-vs-reload rule: `wasGuidedFlowOpen` checks a sessionStorage
  // flag that `markGuidedFlowOpen` writes the instant the guided flow mounts
  // and that a cleanup effect below clears the instant it cleanly unmounts —
  // Exit, Finish, Dismiss, or a client-side navigation away from /recipes.
  // An abrupt full-page reload skips that cleanup (the JS context is torn
  // down mid-flight), so the flag is still there on the next mount only if
  // the flow was actually open when the page went away. That's exactly
  // "reload without leaving /recipes" — anything else (a new tab, browser
  // back/forward, returning to /recipes later) finds no flag and is treated
  // as a fresh visit.
  //
  // Runs once, as soon as the recipe list is available (the loader only
  // mounts this component once `recipes` has already been fetched). Looks up
  // the persisted { recipeId, step } record. `getActiveCookSession` refuses
  // to return a record for a recipe whose deduction was confirmed (#440), so
  // this can't resurrect an ended session — but that alone isn't enough to
  // avoid auto-opening the guided flow for a cook the user never guided:
  // only `startGuidedCookSession` (called from `handleOpenGuidedCook` below)
  // ever arms this record, so a chat-started cook (which only calls
  // `startCookSession`) never has one to find here (PR #475 code review).
  useEffect(() => {
    if (resumeCheckedRef.current) return
    if (recipes.length === 0) return
    resumeCheckedRef.current = true
    const active = getActiveCookSession()
    if (!active) return
    const match = recipes.find((r) => r.id === active.recipeId)
    if (!match) return
    if (wasGuidedFlowOpen(active.recipeId) || resumeRecipeId === active.recipeId) {
      // Same tab, reloaded mid-cook — restore directly, exactly as before. A
      // resume link (#755) is the same intent said out loud.
      setSelectedId(match.id)
      setResumeStep(active.step)
      setGuidedCookOpen(true)
    } else {
      // A fresh visit — ask first instead of forcing the flow back open.
      setResumeBanner({
        recipeId: match.id,
        title: match.title,
        step: active.step,
        totalSteps: match.instructions.length,
      })
    }
  }, [recipes, resumeRecipeId])

  // Keeps the `markGuidedFlowOpen` sessionStorage flag in sync with whether
  // the guided flow is actually mounted, for the fresh-visit-vs-reload rule
  // above. The cleanup fires on every clean unmount (Exit/Finish/Dismiss, or
  // this whole page unmounting via client-side navigation) but NOT on an
  // abrupt full-page reload — which is exactly the distinction that effect
  // relies on.
  useEffect(() => {
    if (!guidedCookOpen || !selectedRecipe) return
    const recipeId = selectedRecipe.id
    markGuidedFlowOpen(recipeId)
    return () => clearGuidedFlowOpen(recipeId)
  }, [guidedCookOpen, selectedRecipe])

  const handleResumeBanner = () => {
    if (!resumeBanner) return
    setSelectedId(resumeBanner.recipeId)
    setResumeStep(resumeBanner.step)
    setGuidedCookOpen(true)
    setResumeBanner(null)
  }

  const handleDismissResumeBanner = () => {
    if (!resumeBanner) return
    clearActiveCookSession(resumeBanner.recipeId)
    setResumeBanner(null)
  }

  // Reset hero image error state whenever the selected recipe changes
  useEffect(() => { setThumbError(false) }, [selectedId])

  const handleSearch = useCallback((q: string) => {
    setSearch(q)
  }, [])

  /**
   * Opens the guided step-by-step cook flow. This is the "start cooking"
   * moment for the library's cook path — unlike the chat card's cook flow,
   * there is no separate preview step first, so a fresh session (#440) is
   * armed right here via `startGuidedCookSession`: clears any stale "ended"
   * record left by a previous confirmed cook of this same recipe, so this
   * legitimate new attempt isn't mistaken for a stale re-entry into an
   * already-finished one, and arms the #441 resumable step record — the
   * thing that makes `getActiveCookSession()` findable by the reload-resume
   * effect above. This is the *only* place that record gets armed, so only a
   * cook genuinely started here is ever auto-resumed (PR #475 code review).
   */
  const handleOpenGuidedCook = () => {
    if (!selectedRecipe) return
    startGuidedCookSession(selectedRecipe.id)
    setResumeStep(null)
    setGuidedCookOpen(true)
  }

  const handleFavorite = async (recipe: Recipe) => {
    if (mutating) return
    setMutating(true)
    setErrorMessage(null)
    const id = recipe.id
    const newVal = !recipe.is_favorite
    setFavoriteOverrides((prev) => ({ ...prev, [id]: newVal }))
    try {
      const res = await fetch(`/api/recipes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: newVal }),
      })
      if (!res.ok) throw new Error('Failed to update favorite')
    } catch {
      setFavoriteOverrides((prev) => ({ ...prev, [id]: !newVal }))
      setErrorMessage('Could not update favorite. Please try again.')
    } finally {
      setMutating(false)
    }
  }

  const handleEditSave = async (updates: Partial<Recipe>) => {
    setMutating(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/recipes/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to save')
      setEditId(null)
      onMutate?.()
    } catch {
      setErrorMessage('Could not save changes. Please try again.')
    } finally {
      setMutating(false)
    }
  }

  const handleImported = (extracted: Partial<Recipe>, sourceUrl: string) => {
    let platform: string | null = null
    try {
      const hostname = new URL(sourceUrl).hostname.replace(/^www\./, '')
      const PLATFORM_NAMES: Record<string, string> = {
        'allrecipes.com': 'AllRecipes',
        'food.com': 'Food.com',
        'foodnetwork.com': 'Food Network',
        'bbcgoodfood.com': 'BBC Good Food',
        'seriouseats.com': 'Serious Eats',
        'bonappetit.com': 'Bon Appétit',
        'epicurious.com': 'Epicurious',
        'delish.com': 'Delish',
        'tasty.co': 'Tasty',
        'cooking.nytimes.com': 'NYT Cooking',
        'skinnytaste.com': 'Skinnytaste',
        'halfbakedharvest.com': 'Half Baked Harvest',
        'thekitchn.com': 'The Kitchn',
        'simplyrecipes.com': 'Simply Recipes',
        'smittenkitchen.com': 'Smitten Kitchen',
        'youtube.com': 'YouTube',
        'm.youtube.com': 'YouTube',
        'youtu.be': 'YouTube',
      }
      platform = PLATFORM_NAMES[hostname] ?? hostname
    } catch {
      // malformed URL — leave platform null
    }
    setImportOpen(false)
    setImportDraft({ ...extracted, source_url: sourceUrl, source_platform: platform })
  }

  const handleImportSave = async (updates: Partial<Recipe>) => {
    setMutating(true)
    setErrorMessage(null)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...importDraft, ...updates, source_type: 'url' }),
      })
      if (res.status === 409) {
        // Already saved — navigate to the existing recipe instead
        const data = await res.json()
        setImportOpen(false)
        if (data.existing_id) setSelectedId(data.existing_id)
        setErrorMessage(`"${data.existing_title ?? 'This recipe'}" is already in your book.`)
        return
      }
      if (!res.ok) throw new Error('Failed to import recipe')
      const saved = await res.json()
      setImportOpen(false)
      setImportDraft(null)
      queryClient.invalidateQueries({ queryKey: ['bubbles'] })
      onMutate?.()
      setSelectedId(saved.id ?? null)
    } catch {
      setErrorMessage('Could not import recipe. Please try again.')
    } finally {
      setMutating(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setMutating(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/recipes/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setDeleteId(null)
      // If the deleted recipe was the open one, back to the list.
      if (deleteId === selectedId) setSelectedId(null)
      onMutate?.()
    } catch {
      setErrorMessage('Could not delete recipe. Please try again.')
    } finally {
      setMutating(false)
    }
  }

  const totalMinutes = (r: Recipe): number | null =>
    r.total_time_minutes || ((r.prep_time_minutes ?? 0) + (r.cook_time_minutes ?? 0) || null)

  /** The card for one saved recipe: the list's row, and the opened recipe's header. */
  const savedCard = (r: Recipe, opts: { open: boolean }) => (
    <RecipeCard
      variant="saved"
      title={r.title}
      // The opened recipe shows its photo as a hero below, so its header keeps the emoji tile.
      thumbnailUrl={opts.open ? null : r.thumbnail_url}
      minutes={totalMinutes(r)}
      servings={r.servings}
      cuisine={r.cuisine}
      difficulty={r.difficulty}
      tags={r.tags}
      favorite={Boolean(r.is_favorite)}
      busy={mutating}
      onOpen={opts.open ? undefined : () => setSelectedId(r.id)}
      onToggleFavorite={() => handleFavorite(r)}
      onEdit={() => setEditId(r.id)}
      onDelete={() => setDeleteId(r.id)}
    />
  )

  const deleteConfirm = (r: Recipe) =>
    deleteId === r.id && (
      <RecipeDeleteConfirm
        recipeTitle={r.title}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteId(null)}
        deleting={mutating}
        mealTitles={r.meal_titles ?? []}
      />
    )

  const importButton = (
    <button
      onClick={() => setImportOpen(true)}
      className="font-sans flex-shrink-0 px-3 py-2 rounded-full text-sm font-bold text-[var(--color-text)] active:scale-95 transition-transform"
      style={{ background: 'var(--color-accent)' }}
      title="Import recipe from URL"
      aria-label="Import recipe from URL"
    >
      🔗 Import
    </button>
  )

  return (
    <div className="w-full max-w-md mx-auto px-2 flex flex-col gap-3">
      {/* "Resume cooking?" banner (PR #475) — shown instead of silently
          reopening the guided flow on a fresh visit. See the resume-check
          effect above for the fresh-visit-vs-reload rule. */}
      {resumeBanner && (
        <div
          data-testid="resume-cook-banner"
          className="rounded-2xl px-4 py-3 flex items-start gap-3"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          <span aria-hidden="true" className="text-lg leading-none mt-0.5">
            🍳
          </span>
          <div className="flex-1 min-w-0">
            <p
              className="font-sans text-sm font-semibold leading-snug"
              style={{ color: 'var(--color-text)' }}
            >
              You were cooking <span className="font-extrabold">{resumeBanner.title}</span>
              {resumeBanner.totalSteps > 0 && (
                <>
                  {' '}
                  — step {Math.min(Math.max(resumeBanner.step + 1, 1), resumeBanner.totalSteps)} of{' '}
                  {resumeBanner.totalSteps}
                </>
              )}
            </p>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={handleResumeBanner}
                className="font-sans rounded-full px-4 py-1.5 text-xs font-bold active:scale-95 transition-transform"
                style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
              >
                Resume
              </button>
              <button
                type="button"
                onClick={handleDismissResumeBanner}
                className="font-sans rounded-full px-4 py-1.5 text-xs font-bold active:scale-95 transition-transform"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-muted)',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div
          className="font-sans px-3 py-2 rounded-xl text-sm flex items-center justify-between"
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
          role="alert"
        >
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-2 hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-primary-dark)' }}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {selectedRecipe ? (
        /* ─── One recipe, opened in place ─── */
        <>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="font-sans -mb-1 flex min-h-[44px] items-center gap-1 self-start rounded-full px-2 text-sm font-extrabold text-[var(--color-text)] active:scale-95 transition-transform"
          >
            <span aria-hidden="true">←</span> Back to recipes
          </button>

          {savedCard(selectedRecipe, { open: true })}
          {deleteConfirm(selectedRecipe)}

          <SpringButton
            variant="primary"
            fullWidth
            onClick={handleOpenGuidedCook}
            disabled={mutating}
            aria-label="Cook this recipe"
            title="Cook it"
            data-testid="recipe-book-cook-button"
          >
            <span aria-hidden="true">🍳</span> Cook it
          </SpringButton>

          <div
            className="rounded-2xl overflow-hidden border border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)', boxShadow: 'var(--shadow-soft)' }}
          >
            {selectedRecipe.thumbnail_url && !thumbError && (
              // eslint-disable-next-line @next/next/no-img-element -- user-supplied, arbitrary hosts
              <img
                src={selectedRecipe.thumbnail_url}
                alt={selectedRecipe.title}
                className="w-full object-cover"
                style={{ height: '180px' }}
                onError={() => setThumbError(true)}
              />
            )}
            {selectedRecipe.description && (
              <p className="font-sans px-5 pt-4 text-sm text-[var(--color-muted)]">
                {selectedRecipe.description}
              </p>
            )}
            <PantryRecipeDetail recipe={selectedRecipe} />
          </div>
        </>
      ) : recipes.length === 0 ? (
        <>
          {/* Import stays reachable on an empty library: it is how the first recipe arrives. */}
          <div className="flex justify-end">{importButton}</div>
          <EmptyState
            mascotState="surprised"
            headerLabel="Your Recipe Book"
            headline="No recipes yet"
            subline="Ask Chef Bubbly what to cook, or import a recipe with the link button above."
            ctaLabel="Chat with Bubbles"
            ctaEmoji="💬"
            onCta={() => router.push('/chat')}
          />
        </>
      ) : (
        /* ─── The list ─── */
        <>
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <RecipeSearchBar onSearch={handleSearch} />
            </div>
            {importButton}
          </div>

          {filteredRecipes.length === 0 ? (
            <p className="font-sans py-8 text-center text-sm text-[var(--color-muted)]">
              No results for &ldquo;{search}&rdquo;
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3" aria-label="Saved recipes">
                {filteredRecipes.map((r) => (
                  <li key={r.id}>
                    {savedCard(r, { open: false })}
                    {deleteConfirm(r)}
                  </li>
                ))}
              </ul>
              <p className="font-sans text-center text-xs text-[var(--color-muted)]">
                {filteredRecipes.length} of {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </>
      )}

      {/* Edit modal */}
      {editRecipe && (
        <RecipeEditModal
          recipe={editRecipe}
          onSave={handleEditSave}
          onClose={() => setEditId(null)}
          disabled={mutating}
        />
      )}

      {/* RecipeImportModal declares `exit` animation props on its own root
          motion.div, but without AnimatePresence around this conditional
          mount, React removes the whole subtree the instant `importOpen`
          flips false — before Framer Motion gets a chance to run that exit
          transition, so it was previously inert. */}
      <AnimatePresence>
        {importOpen && (
          <RecipeImportModal
            key="recipe-import-modal"
            onImported={handleImported}
            onClose={() => setImportOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Import confirmation — review/edit extracted recipe before saving */}
      {importDraft && (
        <RecipeEditModal
          recipe={{ id: '', user_id: '', created_at: '', ...importDraft } as Recipe}
          onSave={handleImportSave}
          onClose={() => setImportDraft(null)}
          disabled={mutating}
        />
      )}

      {/* Cook modal — pantry deduction flow (unchanged) */}
      {cookOpen && selectedRecipe && (
        <CookModal
          recipeId={selectedRecipe.id}
          recipeTitle={selectedRecipe.title}
          amendedIngredients={amendedIngredients}
          onClose={() => setCookOpen(false)}
          onCooked={() => {
            onMutate?.()
          }}
        />
      )}

      {/* Guided cook flow — step-by-step Variant E flow (#263).
          Finishing the flow hands off to CookModal so pantry deduction (the
          coherent end of the cook story) stays reachable from the library —
          without it the guided flow would displace the only deduction path. */}
      {guidedCookOpen && selectedRecipe && (
        <GuidedCookFlow
          key={selectedRecipe.id}
          recipe={guidedRecipe ?? selectedRecipe}
          initialStep={resumeStep ?? undefined}
          onStepsResolved={(steps) =>
            setStepsOverrides((prev) => ({ ...prev, [selectedRecipe.id]: steps }))
          }
          onExit={() => {
            // Deliberate exit back to the plain recipe view — nothing left
            // to resume (#441). Not the same as `endCookSession`: a later
            // re-open of guided cook for this recipe should still work.
            clearActiveCookSession(selectedRecipe.id)
            setResumeStep(null)
            setGuidedCookOpen(false)
          }}
          onFinish={() => {
            clearActiveCookSession(selectedRecipe.id)
            setResumeStep(null)
            setGuidedCookOpen(false)
            setCookOpen(true)
          }}
        />
      )}
    </div>
  )
}

