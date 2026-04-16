'use client'

import { motion, LayoutGroup } from 'framer-motion'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
  { id: 'quick', label: 'Quick (<30min)' },
]

interface RecipeFiltersProps {
  activeFilter: string
  onFilterChange: (filter: string) => void
}

export default function RecipeFilters({ activeFilter, onFilterChange }: RecipeFiltersProps) {
  return (
    <>
      {/* Mobile: horizontal scrollable row */}
      <div className="md:hidden flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-none">
        <LayoutGroup id="mobile-filters">
          {FILTERS.map((f) => (
            <motion.button
              key={f.id}
              onClick={() => onFilterChange(f.id)}
              layout
              className="relative flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors"
              style={{
                background: activeFilter === f.id ? 'var(--color-primary)' : 'var(--color-surface)',
                color: activeFilter === f.id ? '#fff' : 'var(--color-muted)',
                border: `1.5px solid ${activeFilter === f.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                boxShadow: activeFilter === f.id ? '0 2px 8px rgba(255,183,197,0.4)' : 'none',
              }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            >
              {f.label}
            </motion.button>
          ))}
        </LayoutGroup>
      </div>

      {/* Desktop: bookmark tabs on right edge */}
      <div className="hidden md:flex flex-col gap-1 absolute right-0 top-12 z-10">
        <LayoutGroup id="desktop-filters">
          {FILTERS.map((f, i) => {
            const isActive = activeFilter === f.id
            return (
              <motion.button
                key={f.id}
                onClick={() => onFilterChange(f.id)}
                layout
                className="relative text-xs font-bold py-2 pl-3 pr-1 rounded-l-md text-left min-w-[90px] transition-colors"
                style={{
                  background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: isActive ? '#fff' : 'var(--color-muted)',
                  border: `1.5px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRight: 'none',
                  boxShadow: isActive ? '2px 2px 8px rgba(255,183,197,0.35)' : '1px 1px 4px rgba(0,0,0,0.06)',
                  transform: `translateX(${isActive ? '4px' : '0px'})`,
                  marginTop: i === 0 ? 0 : -1,
                }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {f.label}
              </motion.button>
            )
          })}
        </LayoutGroup>
      </div>
    </>
  )
}
