'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface RecipeSearchBarProps {
  onSearch: (query: string) => void
  isSearching?: boolean
}

export default function RecipeSearchBar({ onSearch }: RecipeSearchBarProps) {
  const [value, setValue] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onSearch(value)
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, onSearch])

  return (
    <div className="relative flex items-center w-full max-w-md mx-auto">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search your recipes..."
        className="w-full py-2.5 pl-4 pr-10 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors text-sm font-[Nunito,sans-serif]"
      />

      <AnimatePresence mode="wait">
        {value ? (
          <motion.button
            key="clear"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            onClick={() => setValue('')}
            className="absolute right-3 text-[var(--color-muted)] hover:text-[var(--color-text)] text-lg leading-none"
            aria-label="Clear search"
          >
            ×
          </motion.button>
        ) : (
          <span key="icon" className="absolute right-3 text-base text-[var(--color-muted)] select-none pointer-events-none">
            🔍
          </span>
        )}
      </AnimatePresence>
    </div>
  )
}
