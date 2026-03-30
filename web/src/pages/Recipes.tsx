import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Clock, Trash2, BookOpen } from 'lucide-react';
import { useRecipes, useDeleteRecipe } from '../api/client';
import type { RecipeLibraryItem } from '../types';

// ─── Debounce hook ─────────────────────────────────────────────────────────────

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ─── Filter chip data ──────────────────────────────────────────────────────────

const CUISINE_CHIPS = ['Italian', 'Asian', 'Mexican', 'Mediterranean', 'American', 'French'];
const MEAL_TYPE_CHIPS = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];

// ─── Recipe card ───────────────────────────────────────────────────────────────

const RECIPE_EMOJIS = ['🍝', '🥘', '🍜', '🥗', '🍲', '🍛', '🥙', '🫕'];

function recipeEmoji(id: string): string {
  // Hash the UUID string to a stable index
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RECIPE_EMOJIS[h % RECIPE_EMOJIS.length];
}

function RecipeCard({
  recipe,
  onDelete,
}: {
  recipe: RecipeLibraryItem;
  onDelete: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(recipe.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      onClick={() => navigate(`/recipes/${recipe.id}`)}
      className="bg-white dark:bg-night-surface rounded-2xl shadow-soft overflow-hidden cursor-pointer hover:shadow-soft-lg active:scale-[0.98] transition-all"
    >
      {/* Thumbnail */}
      <div className="relative h-28 bg-pastel-peach flex items-center justify-center overflow-hidden">
        {recipe.thumbnail_url ? (
          <img
            src={recipe.thumbnail_url}
            alt={recipe.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <span className="text-4xl">{recipeEmoji(recipe.id)}</span>
        )}
        {recipe.is_draft && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-pastel-peach border border-deep-peach text-xs font-semibold text-soft-charcoal">
            Draft
          </span>
        )}
        <button
          onClick={handleDelete}
          className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-95 ${
            confirmDelete
              ? 'bg-deep-coral text-white'
              : 'bg-white dark:bg-night-raised text-soft-charcoal dark:text-night-secondary opacity-70 hover:opacity-100'
          }`}
          aria-label={confirmDelete ? 'Confirm delete' : 'Delete recipe'}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Content */}
      <div className="p-3 space-y-1.5">
        <h3 className="font-bold text-soft-charcoal dark:text-night-text text-sm leading-snug line-clamp-2">
          {recipe.title}
        </h3>
        <div className="flex flex-wrap gap-1">
          {recipe.cuisine && (
            <span className="px-1.5 py-0.5 rounded-full bg-pastel-lavender text-xs text-soft-charcoal dark:text-night-text">
              {recipe.cuisine}
            </span>
          )}
          {recipe.meal_type && (
            <span className="px-1.5 py-0.5 rounded-full bg-pastel-mint text-xs text-soft-charcoal dark:text-night-text capitalize">
              {recipe.meal_type}
            </span>
          )}
        </div>
        {recipe.total_time_minutes != null && (
          <div className="flex items-center gap-1 text-xs text-soft-charcoal dark:text-night-secondary opacity-60">
            <Clock size={11} />
            <span>{recipe.total_time_minutes} min</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ isSearch }: { isSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <span className="text-5xl mb-4">{isSearch ? '🔍' : '📖'}</span>
      <h2 className="text-lg font-bold text-soft-charcoal dark:text-night-text mb-2">
        {isSearch ? 'No recipes found' : 'No recipes yet'}
      </h2>
      <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-60 max-w-xs">
        {isSearch
          ? 'Try a different search or clear your filters.'
          : 'Save recipes from chat or ask Bubbles to generate one!'}
      </p>
    </div>
  );
}

// ─── Recipes page ──────────────────────────────────────────────────────────────

export function Recipes() {
  const [search, setSearch] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [mealType, setMealType] = useState('');
  const debouncedSearch = useDebounced(search, 300);

  const { data, isLoading } = useRecipes({
    q: debouncedSearch || undefined,
    cuisine: cuisine || undefined,
    meal_type: mealType || undefined,
    limit: 40,
  });

  const { mutate: deleteRecipe } = useDeleteRecipe();
  const recipes = data?.items ?? [];
  const hasFilters = !!debouncedSearch || !!cuisine || !!mealType;

  const handleDelete = useCallback((id: string) => {
    deleteRecipe(id);
  }, [deleteRecipe]);

  return (
    <div className="min-h-screen bg-cream dark:bg-night-base pb-24">
      {/* Header */}
      <header className="px-5 pt-6 pb-4 lg:px-8 lg:pt-8">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen size={20} className="text-deep-pink" />
          <h1 className="text-display font-extrabold text-deep-pink dark:text-night-pink">
            Recipe Library
          </h1>
        </div>
        <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-60">
          {data?.total_count != null
            ? `${data.total_count} saved recipe${data.total_count !== 1 ? 's' : ''}`
            : 'Your saved recipes'}
        </p>
      </header>

      {/* Search */}
      <div className="px-5 lg:px-8 mb-3">
        <div className="flex items-center gap-2 bg-white dark:bg-night-surface rounded-2xl px-4 py-2.5 shadow-soft border border-border-subtle dark:border-night-border">
          <Search size={16} className="text-soft-charcoal dark:text-night-secondary opacity-50 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes..."
            className="flex-1 bg-transparent text-sm text-soft-charcoal dark:text-night-text placeholder-soft-charcoal dark:placeholder-night-secondary placeholder-opacity-40 outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-soft-charcoal dark:text-night-secondary opacity-50 hover:opacity-80 text-xs"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Cuisine filter chips */}
      <div className="px-5 lg:px-8 mb-2">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {CUISINE_CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => setCuisine(cuisine === c ? '' : c)}
              className={`shrink-0 px-3 py-1.5 rounded-pill text-xs font-semibold transition-all active:scale-95 ${
                cuisine === c
                  ? 'bg-deep-lavender text-white shadow-soft'
                  : 'bg-white dark:bg-night-surface text-soft-charcoal dark:text-night-text border border-border-subtle dark:border-night-border'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Meal type filter chips */}
      <div className="px-5 lg:px-8 mb-4">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {MEAL_TYPE_CHIPS.map((m) => (
            <button
              key={m}
              onClick={() => setMealType(mealType === m ? '' : m)}
              className={`shrink-0 px-3 py-1.5 rounded-pill text-xs font-semibold transition-all active:scale-95 capitalize ${
                mealType === m
                  ? 'bg-deep-mint text-white shadow-soft'
                  : 'bg-white dark:bg-night-surface text-soft-charcoal dark:text-night-text border border-border-subtle dark:border-night-border'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="px-5 lg:px-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-night-surface rounded-2xl overflow-hidden" aria-busy="true">
              <div className="h-28 skeleton" />
              <div className="p-3 space-y-2">
                <div className="h-4 skeleton rounded-full w-3/4" />
                <div className="h-3 skeleton rounded-full w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <EmptyState isSearch={hasFilters} />
      ) : (
        <div className="px-5 lg:px-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <AnimatePresence mode="popLayout">
            {recipes.map((recipe, i) => (
              <motion.div
                key={recipe.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.3) }}
              >
                <RecipeCard recipe={recipe} onDelete={handleDelete} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
