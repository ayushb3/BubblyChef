'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence, useAnimation, type PanInfo } from 'framer-motion'
import { Heart, DotsThree } from '@phosphor-icons/react'
import RecipeDetail, { type Recipe } from './RecipePage'
import RecipeSearchBar from './RecipeSearchBar'
import BubblesMascot from '@/components/ui/BubblesMascot'
import RecipeEditModal from './RecipeEditModal'
import RecipeDeleteConfirm from './RecipeDeleteConfirm'
import RecipeImportModal from './RecipeImportModal'
import CookModal from './CookModal'
import { springs, heartPopVariants } from '@/lib/motion'

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

// Page-turn animation variants — book-page-curl feel
const pageVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? '60%' : '-60%',
    rotateY: dir > 0 ? -15 : 15,
    opacity: 0,
    scale: 0.92,
  }),
  center: {
    x: 0,
    rotateY: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (dir: number) => ({
    x: dir > 0 ? '-60%' : '60%',
    rotateY: dir > 0 ? 12 : -12,
    opacity: 0,
    scale: 0.92,
  }),
}

const pageTransition = springs.page

const SWIPE_THRESHOLD = 50
const VELOCITY_THRESHOLD = 300

export default function RecipeBook({ recipes, onMutate }: RecipeBookProps) {
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(
    recipes.length > 0 ? recipes[0].id : null,
  )
  const [direction, setDirection] = useState<1 | -1>(1)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [cookOpen, setCookOpen] = useState(false)
  const [importDraft, setImportDraft] = useState<Partial<Recipe> | null>(null)
  const [mutating, setMutating] = useState(false)
  // Local optimistic overrides for favorite state — avoids full re-fetch on toggle
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [thumbError, setThumbError] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const heartControls = useAnimation()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!errorMessage) return
    const t = setTimeout(() => setErrorMessage(null), 5000)
    return () => clearTimeout(t)
  }, [errorMessage])

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [menuOpen])

  // Merge optimistic favorite overrides into the recipe list
  const recipesWithOverrides = useMemo(
    () => recipes.map((r) => r.id in favoriteOverrides ? { ...r, is_favorite: favoriteOverrides[r.id] } : r),
    [recipes, favoriteOverrides],
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

  useEffect(() => {
    if (search.trim() && filteredRecipes.length > 0) {
      setSelectedId(filteredRecipes[0].id)
    }
  }, [search, filteredRecipes])

  const selectedRecipe = recipesWithOverrides.find((r) => r.id === selectedId) ?? recipesWithOverrides[0] ?? null

  // Reset hero image error state whenever the selected recipe changes
  useEffect(() => { setThumbError(false) }, [selectedId])

  const currentIndex = filteredRecipes.findIndex((r) => r.id === selectedId)

  const goNext = useCallback(() => {
    if (currentIndex < filteredRecipes.length - 1) {
      setDirection(1)
      setSelectedId(filteredRecipes[currentIndex + 1].id)
      setSidebarOpen(false)
    }
  }, [currentIndex, filteredRecipes])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1)
      setSelectedId(filteredRecipes[currentIndex - 1].id)
      setSidebarOpen(false)
    }
  }, [currentIndex, filteredRecipes])

  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.x < -SWIPE_THRESHOLD || info.velocity.x < -VELOCITY_THRESHOLD) {
        goNext()
      } else if (info.offset.x > SWIPE_THRESHOLD || info.velocity.x > VELOCITY_THRESHOLD) {
        goPrev()
      }
    },
    [goNext, goPrev],
  )

  const handleSearch = useCallback((q: string) => {
    setSearch(q)
  }, [])

  const handleSelect = (id: string) => {
    const newIndex = filteredRecipes.findIndex((r) => r.id === id)
    setDirection(newIndex > currentIndex ? 1 : -1)
    setSelectedId(id)
    setSidebarOpen(false)
  }

  const handleFavorite = async () => {
    if (!selectedRecipe) return
    setErrorMessage(null)
    const id = selectedRecipe.id
    const newVal = !selectedRecipe.is_favorite
    setFavoriteOverrides((prev) => ({ ...prev, [id]: newVal }))
    void heartControls.start('pop').then(() => heartControls.start('idle'))
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
    }
  }

  const handleEditSave = async (updates: Partial<Recipe>) => {
    setMutating(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/recipes/${selectedRecipe!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to save')
      setEditOpen(false)
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
    if (res.status === 409) {
      // Already saved — navigate to the existing recipe instead
      const data = await res.json()
      setImportOpen(false)
      if (data.existing_id) setSelectedId(data.existing_id)
      setErrorMessage(`"${data.existing_title ?? 'This recipe'}" is already in your book.`)
      return
    }
    if (res.ok) {
      const saved = await res.json()
      setImportOpen(false)
      onMutate?.()
      setSelectedId(saved.id ?? null)
    }
  }

  const handleDeleteConfirm = async () => {
    setMutating(true)
    setErrorMessage(null)
    const nextRecipe = filteredRecipes.find((r) => r.id !== selectedRecipe?.id) ?? null
    try {
      const res = await fetch(`/api/recipes/${selectedRecipe!.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setDeleteOpen(false)
      setSelectedId(nextRecipe?.id ?? null)
      onMutate?.()
    } catch {
      setErrorMessage('Could not delete recipe. Please try again.')
    } finally {
      setMutating(false)
    }
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
          className="flex-shrink-0 px-3 py-2 rounded-full text-sm font-bold text-[var(--color-text)] active:scale-95 transition-transform"
          style={{ background: 'var(--color-accent)', fontFamily: 'Nunito, sans-serif' }}
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
          boxShadow: 'var(--shadow-soft)',
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
                style={{ background: 'var(--color-backdrop)' }}
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
                    className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-lg leading-none px-1"
                    aria-label="Close sidebar"
                  >
                    ✕
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
                              color: isActive ? 'var(--color-text)' : 'var(--color-muted)',
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
            ☰
          </button>
        )}

        {/* ─── Main recipe panel ─── */}
        {selectedRecipe ? (
          <div className="flex flex-col h-full">
            {/* Recipe header — hero variant when thumbnail exists and loads successfully */}
            {selectedRecipe.thumbnail_url && !thumbError ? (
              <div className="flex-shrink-0">
                {/* Hero image with title overlay */}
                <div className="relative w-full overflow-hidden" style={{ height: '180px' }}>
                  <img
                    src={selectedRecipe.thumbnail_url}
                    alt={selectedRecipe.title}
                    className="w-full h-full object-cover"
                    onError={() => setThumbError(true)}
                  />
                  {/* Gradient overlay — title sits on top */}
                  <div
                    className="absolute inset-0 flex flex-col justify-end px-4 pb-3"
                    style={{
                      background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 55%, transparent 100%)',
                    }}
                  >
                    <h2
                      className="text-lg font-extrabold text-white leading-tight line-clamp-2"
                      style={{ fontFamily: 'Nunito, sans-serif', textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}
                    >
                      {selectedRecipe.title}
                    </h2>
                    {selectedRecipe.description && (
                      <p className="text-xs text-white/80 mt-0.5 line-clamp-1">
                        {selectedRecipe.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Tags + chips + actions — below the hero */}
                <div className="px-4 pt-2 pb-3">
                  {selectedRecipe.tags && selectedRecipe.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selectedRecipe.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-bg)] text-[var(--color-primary-dark)] border border-[var(--color-border)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedRecipe.cuisine && <MetaChip label={selectedRecipe.cuisine} />}
                    {totalTime && <MetaChip label={totalTime} />}
                    {selectedRecipe.difficulty && <MetaChip label={selectedRecipe.difficulty} />}
                    {selectedRecipe.servings && <MetaChip label={`Serves ${selectedRecipe.servings}`} />}
                  </div>
                  {/* Action buttons — Cook on left, Heart + menu on right */}
                  <div className="flex items-center justify-between">
                    {/* Cook it — primary-tinted to signal the main action */}
                    <button
                      onClick={() => setCookOpen(true)}
                      disabled={mutating}
                      className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                      style={{ background: 'color-mix(in srgb, var(--color-primary) 18%, var(--color-bg))', border: '1.5px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border))' }}
                      aria-label="Cook this recipe"
                      title="Cook it"
                    >
                      🍳
                    </button>

                    <div className="flex items-center gap-2">
                      {/* Heart button — 44x44 with pop animation */}
                      <motion.button
                        onClick={handleFavorite}
                        disabled={mutating}
                        className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                        aria-label={selectedRecipe.is_favorite ? 'Unfavorite' : 'Favorite'}
                        title={selectedRecipe.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <motion.span variants={heartPopVariants} animate={heartControls} initial="idle">
                          <Heart
                            size={20}
                            weight={selectedRecipe.is_favorite ? 'fill' : 'regular'}
                            color={selectedRecipe.is_favorite ? 'var(--color-coral)' : 'var(--color-muted)'}
                          />
                        </motion.span>
                      </motion.button>

                      {/* Overflow menu — Edit + Delete */}
                      <div className="relative" ref={menuRef}>
                        <button
                          onClick={() => setMenuOpen((o) => !o)}
                          disabled={mutating}
                          className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                          aria-label="More options"
                          aria-haspopup="true"
                          aria-expanded={menuOpen}
                        >
                          <DotsThree size={20} weight="bold" color="var(--color-muted)" />
                        </button>
                        <AnimatePresence>
                          {menuOpen && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9, y: -4 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: -4 }}
                              transition={springs.snappy}
                              className="absolute right-0 top-12 z-20 rounded-2xl overflow-hidden"
                              style={{
                                background: 'var(--color-surface)',
                                border: '1px solid var(--color-border)',
                                boxShadow: 'var(--shadow-pop)',
                                minWidth: '140px',
                              }}
                            >
                              <button
                                onClick={() => { setMenuOpen(false); setEditOpen(true) }}
                                className="w-full px-4 py-3 text-left text-sm font-semibold flex items-center gap-2 hover:bg-[var(--color-bg)] transition-colors"
                                style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => { setMenuOpen(false); setDeleteOpen(true) }}
                                className="w-full px-4 py-3 text-left text-sm font-semibold flex items-center gap-2 hover:bg-[var(--color-bg)] transition-colors"
                                style={{ color: 'var(--color-coral)', fontFamily: 'Nunito, sans-serif' }}
                              >
                                🗑️ Delete
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                  {deleteOpen && (
                    <RecipeDeleteConfirm
                      recipeTitle={selectedRecipe.title}
                      onConfirm={handleDeleteConfirm}
                      onCancel={() => setDeleteOpen(false)}
                      deleting={mutating}
                    />
                  )}
                </div>
              </div>
            ) : (
              /* Plain header — no thumbnail */
              <div
                className="px-4 pt-4 pb-3 flex-shrink-0"
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
                {selectedRecipe.tags && selectedRecipe.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedRecipe.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--color-bg)] text-[var(--color-primary-dark)] border border-[var(--color-border)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedRecipe.cuisine && <MetaChip label={selectedRecipe.cuisine} />}
                  {totalTime && <MetaChip label={totalTime} />}
                  {selectedRecipe.difficulty && <MetaChip label={selectedRecipe.difficulty} />}
                  {selectedRecipe.servings && (
                    <MetaChip label={`Serves ${selectedRecipe.servings}`} />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {/* Action buttons — Cook on left, Heart + menu on right */}
                  <div className="flex items-center justify-between w-full">
                    {/* Cook it — primary-tinted to signal the main action */}
                    <button
                      onClick={() => setCookOpen(true)}
                      disabled={mutating}
                      className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                      style={{ background: 'color-mix(in srgb, var(--color-primary) 18%, var(--color-bg))', border: '1.5px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border))' }}
                      aria-label="Cook this recipe"
                      title="Cook it"
                    >
                      🍳
                    </button>

                    <div className="flex items-center gap-2">
                      {/* Heart button — 44x44 with pop animation */}
                      <motion.button
                        onClick={handleFavorite}
                        disabled={mutating}
                        className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                        aria-label={selectedRecipe.is_favorite ? 'Unfavorite' : 'Favorite'}
                        title={selectedRecipe.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <motion.span variants={heartPopVariants} animate={heartControls} initial="idle">
                          <Heart
                            size={20}
                            weight={selectedRecipe.is_favorite ? 'fill' : 'regular'}
                            color={selectedRecipe.is_favorite ? 'var(--color-coral)' : 'var(--color-muted)'}
                          />
                        </motion.span>
                      </motion.button>

                      {/* Overflow menu — Edit + Delete */}
                      <div className="relative" ref={menuRef}>
                        <button
                          onClick={() => setMenuOpen((o) => !o)}
                          disabled={mutating}
                          className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
                          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                          aria-label="More options"
                          aria-haspopup="true"
                          aria-expanded={menuOpen}
                        >
                          <DotsThree size={20} weight="bold" color="var(--color-muted)" />
                        </button>
                        <AnimatePresence>
                          {menuOpen && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9, y: -4 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: -4 }}
                              transition={springs.snappy}
                              className="absolute right-0 top-12 z-20 rounded-2xl overflow-hidden"
                              style={{
                                background: 'var(--color-surface)',
                                border: '1px solid var(--color-border)',
                                boxShadow: 'var(--shadow-pop)',
                                minWidth: '140px',
                              }}
                            >
                              <button
                                onClick={() => { setMenuOpen(false); setEditOpen(true) }}
                                className="w-full px-4 py-3 text-left text-sm font-semibold flex items-center gap-2 hover:bg-[var(--color-bg)] transition-colors"
                                style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => { setMenuOpen(false); setDeleteOpen(true) }}
                                className="w-full px-4 py-3 text-left text-sm font-semibold flex items-center gap-2 hover:bg-[var(--color-bg)] transition-colors"
                                style={{ color: 'var(--color-coral)', fontFamily: 'Nunito, sans-serif' }}
                              >
                                🗑️ Delete
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                </div>
                {deleteOpen && (
                  <RecipeDeleteConfirm
                    recipeTitle={selectedRecipe.title}
                    onConfirm={handleDeleteConfirm}
                    onCancel={() => setDeleteOpen(false)}
                    deleting={mutating}
                  />
                )}
              </div>
            )}

            {/* Error banner */}
            {errorMessage && (
              <div
                className="mx-4 mt-2 px-3 py-2 rounded-xl text-sm flex items-center justify-between"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontFamily: 'Nunito, sans-serif',
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

            {/* Divider */}
            <div className="h-px flex-shrink-0" style={{ background: 'var(--color-border)' }} />

            {/* Page indicator + nav arrows */}
            {filteredRecipes.length > 1 && (
              <div className="flex items-center justify-between px-5 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <button
                  onClick={goPrev}
                  disabled={currentIndex === 0}
                  className="text-[var(--color-primary-dark)] text-lg px-1 disabled:opacity-30 active:scale-90 transition-transform"
                  aria-label="Previous recipe"
                >
                  ‹
                </button>
                <span className="text-xs text-[var(--color-muted)]" style={{ fontFamily: 'Nunito, sans-serif' }}>
                  {currentIndex + 1} / {filteredRecipes.length}
                </span>
                <button
                  onClick={goNext}
                  disabled={currentIndex === filteredRecipes.length - 1}
                  className="text-[var(--color-primary-dark)] text-lg px-1 disabled:opacity-30 active:scale-90 transition-transform"
                  aria-label="Next recipe"
                >
                  ›
                </button>
              </div>
            )}

            {/* Scrollable recipe body — book page-turn animation */}
            <div className="flex-1 overflow-hidden relative" style={{ perspective: '1200px' }}>
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={selectedRecipe.id}
                  custom={direction}
                  variants={pageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={pageTransition}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.1}
                  onDragEnd={handleDragEnd}
                  style={{
                    height: '100%',
                    overflowY: 'auto',
                    transformOrigin: direction > 0 ? 'left center' : 'right center',
                    cursor: 'grab',
                    willChange: 'transform',
                  }}
                  whileDrag={{ cursor: 'grabbing' }}
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

      {/* Cook modal */}
      {cookOpen && selectedRecipe && (
        <CookModal
          recipeId={selectedRecipe.id}
          recipeTitle={selectedRecipe.title}
          onClose={() => setCookOpen(false)}
          onCooked={() => {
            onMutate?.()
          }}
        />
      )}
    </div>
  )
}
