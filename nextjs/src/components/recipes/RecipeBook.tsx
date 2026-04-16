'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import RecipePage, { type Recipe } from './RecipePage'
import RecipeSearchBar from './RecipeSearchBar'
import RecipeFilters from './RecipeFilters'

// Page flip variants — animates around the spine (left edge = origin)
const pageVariants = {
  enter: (direction: number) => ({
    rotateY: direction > 0 ? 90 : -90,
    opacity: 0,
    transformOrigin: direction > 0 ? 'left center' : 'right center',
  }),
  center: {
    rotateY: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    rotateY: direction > 0 ? -90 : 90,
    opacity: 0,
    transformOrigin: direction > 0 ? 'left center' : 'right center',
  }),
}

const pageTransition = { duration: 0.4, ease: [0.4, 0, 0.2, 1] as const }

function BookCover({ isEmpty }: { isEmpty: boolean }) {
  return (
    <div className="chowder-panel w-full h-full flex flex-col items-center justify-center rounded-lg relative overflow-hidden">
      {/* Decorative border */}
      <div
        className="absolute inset-3 rounded-lg pointer-events-none"
        style={{ border: '2px solid rgba(255,255,255,0.4)' }}
      />
      <div
        className="absolute inset-5 rounded-lg pointer-events-none"
        style={{ border: '1px solid rgba(255,183,197,0.5)' }}
      />

      <span className="text-6xl mb-4 select-none">📖</span>
      <h1
        className="text-3xl font-extrabold text-white text-center leading-tight px-6"
        style={{ fontFamily: 'Nunito, sans-serif', textShadow: '0 2px 4px rgba(0,0,0,0.15)' }}
      >
        My Recipe Book
      </h1>
      <p className="text-white/80 text-sm mt-2 text-center px-8">
        {isEmpty
          ? 'No recipes yet — start chatting with Chef Bubbly!'
          : 'Your personal kitchen collection ✨'}
      </p>
    </div>
  )
}

function NavButton({
  onClick,
  disabled,
  children,
  side,
}: {
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
  side: 'left' | 'right'
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.08 }}
      whileTap={{ scale: disabled ? 1 : 0.92 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className="absolute top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-lg shadow-md z-20 disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        background: '#E8C9A0',
        color: '#7A5C3A',
        [side === 'left' ? 'left' : 'right']: '-20px',
      }}
      aria-label={side === 'left' ? 'Previous page' : 'Next page'}
    >
      {children}
    </motion.button>
  )
}

interface RecipeBookProps {
  recipes: Recipe[]
}

export default function RecipeBook({ recipes }: RecipeBookProps) {
  const [search, setSearch] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(0) // 0 = cover
  const [direction, setDirection] = useState(1)

  // Filter recipes
  const filteredRecipes = recipes.filter((r) => {
    const matchesSearch =
      !search ||
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(search.toLowerCase())

    const matchesFilter =
      activeFilter === 'all' ||
      (activeFilter === 'quick' && (r.total_time_minutes ?? Infinity) < 30) ||
      r.meal_type?.toLowerCase() === activeFilter

    return matchesSearch && matchesFilter
  })

  const totalPages = filteredRecipes.length // page 0 = cover, pages 1..n = recipes
  const canPrev = currentPage > 0
  const canNext = currentPage < totalPages

  const goNext = () => {
    if (!canNext) return
    setDirection(1)
    setCurrentPage((p) => p + 1)
  }

  const goPrev = () => {
    if (!canPrev) return
    setDirection(-1)
    setCurrentPage((p) => p - 1)
  }

  // Reset to cover when filter changes
  useEffect(() => {
    setCurrentPage(0)
  }, [activeFilter, search])

  const handleSearch = useCallback((q: string) => {
    setIsSearching(true)
    setSearch(q)
    setTimeout(() => setIsSearching(false), 400)
  }, [])

  const currentRecipe = currentPage > 0 ? filteredRecipes[currentPage - 1] : null

  return (
    <div className="flex flex-col items-center gap-4 w-full px-2 md:px-0">
      {/* Search bar */}
      <div className="w-full max-w-md">
        <RecipeSearchBar onSearch={handleSearch} isSearching={isSearching} />
      </div>

      {/* Book + desktop filters */}
      <div className="relative w-full" style={{ maxWidth: '720px' }}>
        <RecipeFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        {/* Book container */}
        <div
          className="relative w-full rounded-lg overflow-visible"
          style={{
            perspective: '1200px',
            minHeight: '480px',
          }}
        >
          {/* Nav buttons */}
          <NavButton onClick={goPrev} disabled={!canPrev} side="left">
            ‹
          </NavButton>
          <NavButton onClick={goNext} disabled={!canNext} side="right">
            ›
          </NavButton>

          {/* Book pages */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentPage}
              custom={direction}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={pageTransition}
              className="w-full"
              style={{ transformStyle: 'preserve-3d' }}
            >
              {/* Desktop: two-page spread */}
              <div className="hidden md:flex w-full rounded-lg overflow-hidden shadow-xl"
                style={{ minHeight: '480px', background: '#FFFAFC' }}>
                {/* Left page */}
                <div
                  className="w-1/2 flex flex-col border-r"
                  style={{ borderColor: 'var(--color-border)', minHeight: '480px' }}
                >
                  {currentPage === 0 || !currentRecipe ? (
                    <BookCover isEmpty={filteredRecipes.length === 0} />
                  ) : (
                    <RecipeListCard
                      recipes={filteredRecipes}
                      currentIndex={currentPage - 1}
                      onSelect={(i) => {
                        setDirection(i + 1 > currentPage ? 1 : -1)
                        setCurrentPage(i + 1)
                      }}
                    />
                  )}
                </div>

                {/* Spine shadow */}
                <div
                  className="absolute left-1/2 top-0 bottom-0 w-px pointer-events-none"
                  style={{
                    boxShadow: '2px 0 8px rgba(0,0,0,0.08), -2px 0 8px rgba(0,0,0,0.08)',
                  }}
                />

                {/* Right page */}
                <div className="w-1/2" style={{ minHeight: '480px' }}>
                  {currentRecipe ? (
                    <RecipePage recipe={currentRecipe} />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] text-sm gap-2 p-8">
                      <span className="text-4xl">👈</span>
                      <p className="text-center" style={{ fontFamily: 'Nunito, sans-serif' }}>
                        Pick a recipe from the left to open it here
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile: single page */}
              <div
                className="md:hidden w-full rounded-lg overflow-hidden shadow-xl"
                style={{ minHeight: '480px', background: '#FFFAFC' }}
              >
                {currentPage === 0 || !currentRecipe ? (
                  <div style={{ minHeight: '480px' }}>
                    <BookCover isEmpty={filteredRecipes.length === 0} />
                  </div>
                ) : (
                  <div style={{ minHeight: '480px' }}>
                    <RecipePage recipe={currentRecipe} />
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Page counter */}
        <div
          className="text-center mt-3 text-xs text-[var(--color-muted)]"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          {currentPage === 0
            ? `${totalPages} recipe${totalPages !== 1 ? 's' : ''} in your book`
            : `Page ${currentPage} of ${totalPages}`}
        </div>
      </div>

      {/* Mobile filters below book */}
      <div className="md:hidden w-full max-w-md">
        <RecipeFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      </div>
    </div>
  )
}

// Left-page list card for desktop spread
function RecipeListCard({
  recipes,
  currentIndex,
  onSelect,
}: {
  recipes: Recipe[]
  currentIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <div
      className="flex flex-col h-full overflow-hidden rounded-l-lg"
      style={{ background: 'var(--color-surface)' }}
    >
      <div className="chowder-panel px-4 py-3 flex-shrink-0">
        <h3
          className="text-base font-extrabold text-white"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          Recipes 🍳
        </h3>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]">
        {recipes.map((r, i) => (
          <li key={r.id}>
            <button
              onClick={() => onSelect(i)}
              className="w-full text-left px-4 py-3 hover:bg-[var(--color-bg)] transition-colors"
              style={{
                background: i === currentIndex ? 'var(--color-bg)' : undefined,
                borderLeft:
                  i === currentIndex ? '3px solid var(--color-primary)' : '3px solid transparent',
              }}
            >
              <p
                className="font-semibold text-sm text-[var(--color-text)] line-clamp-1"
                style={{ fontFamily: 'Nunito, sans-serif' }}
              >
                {r.title}
              </p>
              {(r.cuisine || r.meal_type) && (
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  {[r.cuisine, r.meal_type].filter(Boolean).join(' · ')}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
