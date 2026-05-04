'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { List, X, Heart, PencilSimple, Trash } from "@phosphor-icons/react"
import RecipeDetail, { type Recipe } from './RecipePage'
import RecipeSearchBar from './RecipeSearchBar'
import BubblesMascot from '@/components/ui/BubblesMascot'
import RecipeEditModal from './RecipeEditModal'
import RecipeDeleteConfirm from './RecipeDeleteConfirm'
import RecipeImportModal from './RecipeImportModal'

interface RecipeBookProps {
  recipes: Recipe[]
  onMutate?: () => void
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

function MetaChip({ label }: { label: string }) {
  return (
    <span className="inline-block border border-[var(--color-border)] px-2 py-0.5 rounded text-xs text-[var(--color-muted)] font-semibold uppercase tracking-wide">
      {label}
    </span>
  )
}

export default function RecipeBook({ recipes, onMutate }: RecipeBookProps) {
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(
    recipes.length > 0 ? recipes[0].id : null,
  )
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importDraft, setImportDraft] = useState<Partial<Recipe> | null>(null)
  const [mutating, setMutating] = useState(false)

  const filteredRecipes = useMemo(
    () =>
      search
        ? recipes
            .map((r) => ({ r, score: scoreRecipe(r, search) }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .map(({ r }) => r)
        : recipes,
    [recipes, search],
  )

  useEffect(() => {
    if (search.trim() && filteredRecipes.length > 0) {
      setSelectedId(filteredRecipes[0].id)
    }
  }, [search, filteredRecipes])

  const selectedRecipe = recipes.find((r) => r.id === selectedId) ?? filteredRecipes[0] ?? null

  const handleSearch = useCallback((q: string) => {
    setSearch(q)
  }, [])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setSidebarOpen(false)
  }

  const handleFavorite = async () => {
    if (!selectedRecipe) return
    const newVal = !selectedRecipe.is_favorite
    const res = await fetch(`/api/recipes/${selectedRecipe.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorite: newVal }),
    })
    if (res.ok) onMutate?.()
  }

  const handleEditSave = async (updates: Partial<Recipe>) => {
    setMutating(true)
    await fetch(`/api/recipes/${selectedRecipe!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setMutating(false)
    setEditOpen(false)
    onMutate?.()
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
    const res = await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...importDraft, ...updates, source_type: 'url' }),
    })
    setMutating(false)
    setImportDraft(null)
    if (res.ok) {
      const saved = await res.json()
      onMutate?.()
      setSelectedId(saved.id ?? null)
    }
  }

  const handleDeleteConfirm = async () => {
    setMutating(true)
    const nextRecipe = filteredRecipes.find((r) => r.id !== selectedRecipe?.id) ?? null
    await fetch(`/api/recipes/${selectedRecipe!.id}`, { method: 'DELETE' })
    setMutating(false)
    setDeleteOpen(false)
    setSelectedId(nextRecipe?.id ?? null)
    onMutate?.()
  }

  const totalTime = selectedRecipe?.total_time_minutes
    ? `${selectedRecipe.total_time_minutes} min`
    : selectedRecipe?.prep_time_minutes || selectedRecipe?.cook_time_minutes
    ? `${(selectedRecipe.prep_time_minutes ?? 0) + (selectedRecipe.cook_time_minutes ?? 0)} min`
    : null

  return (
    <div className="w-full max-w-md mx-auto px-2 flex flex-col gap-3">
      {/* Search + Import */}
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <RecipeSearchBar onSearch={handleSearch} />
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className="flex-shrink-0 px-3 py-2 rounded-full text-sm font-bold text-white active:scale-95 transition-transform"
          style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
          title="Import recipe from URL"
          aria-label="Import recipe from URL"
        >
          🔗 Import
        </button>
      </div>

      {/* Book container */}
      <div
        className="relative rounded-2xl overflow-hidden border border-[var(--color-border)]"
        style={{
          background: 'var(--color-surface)',
          boxShadow: '0 4px 24px rgba(255,183,197,0.15)',
          minHeight: '520px',
        }}
      >
        {/* ─── Sidebar overlay ─── */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                key="backdrop"
                className="absolute inset-0 z-10"
                style={{ background: 'rgba(0,0,0,0.18)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSidebarOpen(false)}
              />

              {/* Sidebar panel */}
              <motion.div
                key="sidebar"
                className="absolute left-0 top-0 bottom-0 z-20 flex flex-col"
                style={{
                  width: '72%',
                  maxWidth: '280px',
                  background: 'var(--color-surface)',
                  borderRight: '1px solid var(--color-border)',
                }}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              >
                {/* Sidebar header */}
                <div
                  className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-[var(--color-border)]"
                  style={{ background: 'var(--color-bg)' }}
                >
                  <span
                    className="font-extrabold text-sm text-[var(--color-text)]"
                    style={{ fontFamily: 'Nunito, sans-serif' }}
                  >
                    Recipes 🍳
                  </span>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="text-[var(--color-muted)] hover:text-[var(--color-text)] p-1.5 rounded-full hover:bg-[var(--color-border)] transition-colors"
                    aria-label="Close sidebar"
                  >
                     <X size={16} weight="bold" />
                  </button>
                </div>

                {/* Recipe list */}
                <ul className="flex-1 overflow-y-auto">
                  {filteredRecipes.length === 0 ? (
                    <li className="px-4 py-6 text-center text-xs text-[var(--color-muted)]"
                      style={{ fontFamily: 'Nunito, sans-serif' }}>
                      {search ? `No results for "${search}"` : 'No recipes yet'}
                    </li>
                  ) : (
                    filteredRecipes.map((r) => {
                      const isActive = r.id === selectedId
                      return (
                        <li key={r.id}>
                          <button
                            onClick={() => handleSelect(r.id)}
                            className="w-full text-left px-4 py-3 text-sm transition-colors"
                            style={{
                              background: isActive ? 'var(--color-bg)' : 'transparent',
                              borderLeft: `3px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`,
                              fontFamily: 'Nunito, sans-serif',
                              fontWeight: isActive ? 700 : 400,
                              color: isActive
                                ? 'var(--color-text)'
                                : 'var(--color-muted)',
                            }}
                          >
                            <span className="line-clamp-2">{r.title}</span>
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>

                {/* Recipe count */}
                <div
                  className="px-4 py-2 text-xs text-[var(--color-muted)] border-t border-[var(--color-border)] flex-shrink-0"
                  style={{ fontFamily: 'Nunito, sans-serif' }}
                >
                  {filteredRecipes.length} of {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ─── Hamburger tab ─── */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-0 top-4 z-10 flex items-center justify-center rounded-r-lg shadow-sm"
            style={{
              width: '28px',
              height: '40px',
              background: 'var(--color-primary)',
              color: '#fff',
              fontSize: '14px',
            }}
            aria-label="Open recipe list"
          >
            <List size={16} weight="bold" />
          </button>
        )}

        {/* ─── Main recipe panel ─── */}
        {selectedRecipe ? (
          <div className="flex flex-col h-full">
            {/* Recipe header */}
            <div
              className="px-5 pt-4 pb-3 flex-shrink-0"
              style={{ paddingLeft: '40px' }} // clear the hamburger tab
            >
              <h2
                className="text-xl font-extrabold text-[var(--color-text)] leading-tight"
                style={{ fontFamily: 'Nunito, sans-serif' }}
              >
                {selectedRecipe.title}
              </h2>
              {selectedRecipe.description && (
                <p className="text-xs text-[var(--color-muted)] mt-0.5 line-clamp-2">
                  {selectedRecipe.description}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedRecipe.cuisine && <MetaChip label={selectedRecipe.cuisine} />}
                {totalTime && <MetaChip label={totalTime} />}
                {selectedRecipe.difficulty && <MetaChip label={selectedRecipe.difficulty} />}
                {selectedRecipe.servings && (
                  <MetaChip label={`Serves ${selectedRecipe.servings}`} />
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-1.5 mt-2">
                <button
                  onClick={handleFavorite}
                  className="flex items-center justify-center w-9 h-9 rounded-full transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                  aria-label={selectedRecipe.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                  title={selectedRecipe.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart
                    size={18}
                    weight={selectedRecipe.is_favorite ? 'fill' : 'regular'}
                    style={{ color: selectedRecipe.is_favorite ? 'var(--color-primary)' : 'var(--color-muted)' }}
                  />
                </button>
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex items-center justify-center w-9 h-9 rounded-full transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  aria-label="Edit recipe"
                  title="Edit recipe"
                >
                  <PencilSimple size={18} />
                </button>
                <button
                  onClick={() => setDeleteOpen(true)}
                  className="flex items-center justify-center w-9 h-9 rounded-full transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  aria-label="Delete recipe"
                  title="Delete recipe"
                >
                  <Trash size={18} />
                </button>
              </div>

              {/* Delete confirm strip */}
              {deleteOpen && (
                <RecipeDeleteConfirm
                  recipeTitle={selectedRecipe.title}
                  onConfirm={handleDeleteConfirm}
                  onCancel={() => setDeleteOpen(false)}
                  deleting={mutating}
                />
              )}
            </div>

            {/* Divider */}
            <div className="h-px flex-shrink-0" style={{ background: 'var(--color-border)' }} />

            {/* Scrollable recipe body */}
            <div className="flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedRecipe.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                >
                  <RecipeDetail recipe={selectedRecipe} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
            <BubblesMascot state="thinking" size={72} />
            <p
              className="text-sm text-[var(--color-muted)] text-center px-6"
              style={{ fontFamily: 'Nunito, sans-serif' }}
            >
              No recipes yet — start chatting with Chef Bubbly!
            </p>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editOpen && selectedRecipe && (
        <RecipeEditModal
          recipe={selectedRecipe}
          onSave={handleEditSave}
          onClose={() => setEditOpen(false)}
        />
      )}

      {importOpen && (
        <RecipeImportModal
          onImported={handleImported}
          onClose={() => setImportOpen(false)}
        />
      )}

      {/* Import confirmation — review/edit extracted recipe before saving */}
      {importDraft && (
        <RecipeEditModal
          recipe={{ id: '', user_id: '', created_at: '', ...importDraft } as Recipe}
          onSave={handleImportSave}
          onClose={() => setImportDraft(null)}
        />
      )}
    </div>
  )
}
