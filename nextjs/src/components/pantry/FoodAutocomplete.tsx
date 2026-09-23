'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchFoods, type FoodCatalogEntry } from '@/lib/api/foods'

interface FoodAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onSelect: (entry: FoodCatalogEntry) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  id?: string
}

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 250

/**
 * Ingredient-name autocomplete for the manual "Type" pantry-add row
 * (issue #398). Wraps a plain text input in a combobox: as the user types,
 * matching entries from the food catalog (`GET /api/foods/search`) show in a
 * keyboard-navigable dropdown. Selecting one hands the full catalog entry
 * back to the caller, which fills in unit/category/location/expiry.
 *
 * Deliberately just a text input underneath — existing tests locate this row
 * by placeholder/display value (see `pantry-add-sheet-tab-persistence.test.tsx`),
 * so the input's own behavior (value, onChange, placeholder) is unchanged;
 * this only adds a dropdown on top.
 */
export default function FoodAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  ariaLabel = 'Item name',
  className,
  id,
}: FoodAutocompleteProps) {
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Whether the user has typed in this field since it mounted. A focus that
  // arrives before that — a modal's focus trap landing on a pre-filled name,
  // say — must not pop last query's suggestions over the form.
  const userHasTypedRef = useRef(false)
  const listboxId = useId()
  const generatedId = useId()
  const inputId = id ?? generatedId

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim())
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  const trimmed = debouncedQuery
  const { data: suggestions = [] } = useQuery({
    queryKey: ['foods-search', trimmed],
    queryFn: () => searchFoods(trimmed),
    enabled: trimmed.length >= MIN_QUERY_LENGTH && isOpen,
    staleTime: 60_000,
  })

  // Dismiss on outside click, matching FacetDropdown's pattern.
  useEffect(() => {
    if (!isOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen])

  const handleInputChange = (next: string) => {
    userHasTypedRef.current = true
    onChange(next)
    setHighlightedIndex(-1)
    setIsOpen(next.trim().length >= MIN_QUERY_LENGTH)
  }

  const commitSelection = (entry: FoodCatalogEntry) => {
    onSelect(entry)
    setIsOpen(false)
    setHighlightedIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && value.trim().length >= MIN_QUERY_LENGTH) {
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((i) => (i + 1) % suggestions.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
        break
      case 'Enter':
        if (highlightedIndex >= 0) {
          e.preventDefault()
          commitSelection(suggestions[highlightedIndex])
        }
        break
      case 'Escape':
        // Only close the dropdown, not the sheet it lives in (issue #439).
        // `preventDefault` is the signal: `useModalFocusTrap` skips an Escape
        // that's already been handled. (`stopPropagation` alone is not enough —
        // React's delegated listener lives on `document` in this app, next to
        // the trap's own listener, so it can't stop a sibling on the same node.)
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
        setHighlightedIndex(-1)
        break
      default:
        break
    }
  }

  const showDropdown = isOpen && trimmed.length >= MIN_QUERY_LENGTH && suggestions.length > 0

  return (
    <div className="relative" ref={containerRef}>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          highlightedIndex >= 0 && suggestions[highlightedIndex]
            ? `${listboxId}-option-${highlightedIndex}`
            : undefined
        }
        autoComplete="off"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => {
          if (!userHasTypedRef.current) return
          setIsOpen(value.trim().length >= MIN_QUERY_LENGTH)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel} suggestions`}
          className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl overflow-hidden max-h-56 overflow-y-auto"
          style={{
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-pop, 0 8px 24px rgba(0,0,0,0.12))',
          }}
        >
          {suggestions.map((entry, index) => (
            <li
              key={entry.canonical}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === highlightedIndex}
            >
              <button
                type="button"
                // onMouseDown fires before the input's onBlur, so the click
                // registers before the dropdown would otherwise be dismissed.
                onMouseDown={(e) => {
                  e.preventDefault()
                  commitSelection(entry)
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
                style={{
                  color: 'var(--color-text)',
                  background:
                    index === highlightedIndex ? 'var(--color-bg, rgba(0,0,0,0.04))' : 'transparent',
                }}
              >
                {entry.emoji && <span aria-hidden="true">{entry.emoji}</span>}
                <span className="flex-1 capitalize">{entry.canonical}</span>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {entry.category}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
