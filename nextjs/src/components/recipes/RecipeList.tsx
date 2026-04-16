'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import RecipeDetail from './RecipePage'
import { type Recipe } from './RecipePage'
import RecipeSearchBar from './RecipeSearchBar'
import BubblesMascot from '@/components/ui/BubblesMascot'

interface RecipeListProps {
  recipes: Recipe[]
}

function MetaChip({ label }: { label: string }) {
  return (
    <span
      className="inline-block border border-[var(--color-border)] px-2 py-0.5 rounded text-xs text-[var(--color-muted)] font-semibold uppercase tracking-wide"
    >
      {label}
    </span>
  )
}

function RecipeCard({
  recipe,
  isExpanded,
  onToggle,
}: {
  recipe: Recipe
  isExpanded: boolean
  onToggle: () => void
}) {
  const totalTime = recipe.total_time_minutes
    ? `${recipe.total_time_minutes} min`
    : recipe.prep_time_minutes || recipe.cook_time_minutes
    ? `${(recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0)} min`
    : null

  return (
    <div
      className="rounded-2xl overflow-hidden border border-[var(--color-border)]"
      style={{
        background: 'var(--color-surface)',
        boxShadow: isExpanded
          ? '0 4px 20px rgba(255,183,197,0.2)'
          : '0 1px 4px rgba(0,0,0,0.05)',
        transition: 'box-shadow 0.2s',
      }}
    >
      {/* Collapsed header — always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3"
        aria-expanded={isExpanded}
      >
        {/* Emoji */}
        <span className="text-2xl flex-shrink-0 leading-none select-none">
          {recipe.tags?.find((t) => /^\p{Emoji}/u.test(t)) ?? '🍽️'}
        </span>

        {/* Title + chips */}
        <div className="flex-1 min-w-0">
          <p
            className="font-extrabold text-[var(--color-text)] text-sm leading-tight line-clamp-1"
            style={{ fontFamily: 'Nunito, sans-serif' }}
          >
            {recipe.title}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {recipe.cuisine && <MetaChip label={recipe.cuisine} />}
            {totalTime && <MetaChip label={totalTime} />}
            {recipe.difficulty && <MetaChip label={recipe.difficulty} />}
            {isExpanded && recipe.servings && (
              <MetaChip label={`Serves ${recipe.servings}`} />
            )}
          </div>
        </div>

        {/* Chevron */}
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="flex-shrink-0 text-[var(--color-muted)] text-base select-none"
          aria-hidden
        >
          ▼
        </motion.span>
      </button>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="body"
            initial={{ opacity: 0, scaleY: 0.96 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.96 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ transformOrigin: 'top' }}
          >
            <div
              className="border-t border-[var(--color-border)]"
              style={{ maxHeight: '70vh', overflowY: 'auto' }}
            >
              <RecipeDetail recipe={recipe} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function RecipeList({ recipes }: RecipeListProps) {
  const [search, setSearch] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filteredRecipes = recipes.filter(
    (r) =>
      !search ||
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const handleSearch = useCallback((q: string) => {
    setIsSearching(true)
    setSearch(q)
    setExpandedId(null)
    setTimeout(() => setIsSearching(false), 400)
  }, [])

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="flex flex-col gap-3 w-full max-w-md mx-auto px-2">
      {/* Search */}
      <RecipeSearchBar onSearch={handleSearch} isSearching={isSearching} />

      {/* Recipe count */}
      {recipes.length > 0 && (
        <p
          className="text-xs text-[var(--color-muted)] text-center"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          {filteredRecipes.length === recipes.length
            ? `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''} in your book`
            : `${filteredRecipes.length} of ${recipes.length} recipes`}
        </p>
      )}

      {/* Empty state */}
      {filteredRecipes.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <BubblesMascot state="thinking" size={72} />
          <p
            className="text-sm text-[var(--color-muted)]"
            style={{ fontFamily: 'Nunito, sans-serif' }}
          >
            {search
              ? `No recipes match "${search}"`
              : 'No recipes yet — start chatting with Chef Bubbly!'}
          </p>
        </div>
      )}

      {/* Accordion list */}
      <div className="flex flex-col gap-2.5">
        {filteredRecipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            isExpanded={expandedId === recipe.id}
            onToggle={() => handleToggle(recipe.id)}
          />
        ))}
      </div>
    </div>
  )
}
