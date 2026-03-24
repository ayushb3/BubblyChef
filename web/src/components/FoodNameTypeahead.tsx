import { useState, useEffect, useCallback, useRef } from 'react';
import { useFoodSearch } from '../api/client';
import type { FoodSearchResult } from '../types';

/** Title-case a string: capitalize first letter of each word. */
function titleCase(s: string): string {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Format a category slug for display: replace underscores, title-case. */
function formatCategory(cat: string): string {
  return titleCase(cat.replace(/_/g, ' '));
}

interface FoodNameTypeaheadProps {
  value: string;
  onChange: (value: string) => void;
  borderColor?: 'mint' | 'pink';
  inputRef?: (el: HTMLInputElement | null) => void;
  onSelect?: (result: FoodSearchResult) => void;
  placeholder?: string;
  maxSuggestions?: number;
}

/**
 * Typeahead name input with food library lookup.
 * Debounces queries to GET /api/foods/search and shows suggestions
 * with emoji, canonical name, and category.
 */
export function FoodNameTypeahead({
  value,
  onChange,
  borderColor = 'pink',
  inputRef: externalRef,
  onSelect,
  placeholder = 'e.g., Milk, Chicken breast...',
  maxSuggestions = 6,
}: FoodNameTypeaheadProps) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);

  // Debounce the query by 200ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(value), 200);
    return () => clearTimeout(timer);
  }, [value]);

  const { data: results } = useFoodSearch(debouncedQuery, maxSuggestions);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = useCallback((result: FoodSearchResult) => {
    const displayName = titleCase(result.canonical);
    onChange(displayName);
    setOpen(false);
    // Update the underlying input value so refs pick it up
    if (localInputRef.current) {
      localInputRef.current.value = displayName;
    }
    onSelect?.(result);
  }, [onChange, onSelect]);

  const bc = borderColor === 'mint' ? 'pastel-mint' : 'pastel-pink';

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        ref={(el) => {
          localInputRef.current = el;
          externalRef?.(el);
        }}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => { if (value.trim().length >= 1) setOpen(true); }}
        placeholder={placeholder}
        className={`w-full px-4 py-3 rounded-xl border border-${bc}/20 focus:outline-none focus:border-${bc} focus:ring-2 focus:ring-${bc}/20 transition-all text-sm font-semibold dark:bg-night-raised dark:border-night-border dark:text-night-text dark:placeholder-night-secondary`}
      />
      {open && results && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-night-surface rounded-xl shadow-soft-lg border border-soft-charcoal/10 dark:border-night-border overflow-hidden max-h-56 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.canonical}
              type="button"
              onClick={() => handleSelect(r)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-pastel-pink/10 dark:hover:bg-night-raised transition-colors text-sm"
            >
              <span className="text-base flex-shrink-0">{r.emoji}</span>
              <span className="font-medium text-soft-charcoal dark:text-night-text">{titleCase(r.canonical)}</span>
              <span className="ml-auto text-xs text-soft-charcoal/40 dark:text-night-secondary/60">{formatCategory(r.category)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
