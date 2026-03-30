import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Trash2,
  Clock,
  Users,
  Sparkles,
  Send,
  X,
  Loader2,
  Check,
} from 'lucide-react';
import { useRecipe, useUpdateRecipe, useDeleteRecipe, useRefineRecipe } from '../api/client';
import type { RecipeDetailType } from '../types';

// ─── Difficulty colours (reuse pattern from Chat.tsx) ─────────────────────────

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-pastel-mint text-soft-charcoal',
  medium: 'bg-pastel-peach text-soft-charcoal',
  hard: 'bg-pastel-coral text-white',
};

// ─── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({
  recipe,
  onClose,
  onSaved,
}: {
  recipe: RecipeDetailType;
  onClose: () => void;
  onSaved: (updated: RecipeDetailType) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [preview, setPreview] = useState<RecipeDetailType>(recipe);
  const [isSaved, setIsSaved] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { mutate: refine, isPending: isRefining } = useRefineRecipe();
  const { mutate: save, isPending: isSaving } = useUpdateRecipe();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = prompt.trim();
    if (!text || isRefining) return;
    setPrompt('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    refine(
      { id: recipe.id, prompt: text },
      {
        onSuccess: (refined) => {
          setPreview(refined);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', text: `Updated! Here's a preview of the changes.` },
          ]);
          setIsSaved(false);
        },
        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', text: `Oops — couldn't refine: ${err.message}` },
          ]);
        },
      },
    );
  };

  const handleSave = () => {
    save(
      { id: recipe.id, data: preview as Parameters<typeof save>[0]['data'] },
      {
        onSuccess: (saved) => {
          setIsSaved(true);
          onSaved(saved);
        },
      },
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="w-full sm:max-w-2xl max-h-[90vh] bg-white dark:bg-night-surface rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle dark:border-night-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-deep-pink" />
            <h2 className="font-bold text-soft-charcoal dark:text-night-text">Edit with AI</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-soft-charcoal dark:text-night-secondary hover:bg-pastel-pink dark:hover:bg-night-raised active:scale-95 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Two-panel body — stacked on mobile, side-by-side on sm+ */}
        <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
          {/* Left: mini chat */}
          <div className="flex flex-col sm:w-1/2 border-b sm:border-b-0 sm:border-r border-border-subtle dark:border-night-border">
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[120px] sm:min-h-0"
              role="log"
              aria-live="polite"
            >
              {messages.length === 0 && (
                <p className="text-xs text-soft-charcoal dark:text-night-secondary opacity-50 text-center pt-4">
                  Tell me how to refine this recipe...
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <span
                    className={`px-3 py-1.5 rounded-2xl text-sm max-w-[85%] ${
                      m.role === 'user'
                        ? 'bg-pastel-pink text-soft-charcoal rounded-br-sm dark:bg-night-pink dark:text-night-text'
                        : 'bg-cream dark:bg-night-raised text-soft-charcoal dark:text-night-text rounded-bl-sm'
                    }`}
                  >
                    {m.text}
                  </span>
                </div>
              ))}
              {isRefining && (
                <div className="flex justify-start">
                  <span className="px-3 py-2 rounded-2xl rounded-bl-sm bg-cream dark:bg-night-raised flex items-center gap-1">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="w-1.5 h-1.5 rounded-full bg-pastel-pink animate-bounce"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {/* Input */}
            <div className="shrink-0 px-3 pb-3 pt-2 border-t border-border-subtle dark:border-night-border">
              <div className="flex gap-2 items-center bg-cream dark:bg-night-raised rounded-2xl px-3 py-2">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                  placeholder='e.g. "make it vegan"'
                  disabled={isRefining}
                  className="flex-1 bg-transparent text-sm text-soft-charcoal dark:text-night-text placeholder-soft-charcoal dark:placeholder-night-secondary placeholder-opacity-40 outline-none disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!prompt.trim() || isRefining}
                  className="w-8 h-8 rounded-full bg-deep-pink text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all"
                >
                  {isRefining ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Right: live preview */}
          <div className="sm:w-1/2 overflow-y-auto px-4 py-3 space-y-3">
            <p className="text-xs font-bold text-soft-charcoal dark:text-night-secondary opacity-50 uppercase tracking-wide">
              Preview
            </p>
            <h3 className="font-bold text-soft-charcoal dark:text-night-text">{preview.title}</h3>
            {preview.description && (
              <p className="text-xs text-soft-charcoal dark:text-night-secondary opacity-60">
                {preview.description}
              </p>
            )}
            {(preview.ingredients ?? []).length > 0 && (
              <div>
                <p className="text-xs font-bold text-soft-charcoal dark:text-night-secondary opacity-50 uppercase tracking-wide mb-1">
                  Ingredients
                </p>
                <ul className="space-y-1">
                  {preview.ingredients.map((ing, i) => (
                    <li key={i} className="text-xs text-soft-charcoal dark:text-night-text flex gap-1.5">
                      <span className="text-deep-pink mt-0.5">•</span>
                      <span>
                        {ing.amount && ing.unit ? `${ing.amount} ${ing.unit} ` : ''}
                        <span className="font-medium">{ing.name}</span>
                        {ing.notes && <span className="opacity-50"> ({ing.notes})</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer buttons */}
        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-border-subtle dark:border-night-border">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-pill border-2 border-border-subtle dark:border-night-border text-soft-charcoal dark:text-night-secondary font-semibold text-sm active:scale-95 transition-all"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || isSaved}
            className="flex-1 py-2.5 rounded-pill bg-deep-pink text-white font-bold text-sm shadow-soft disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-1.5"
          >
            {isSaving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : isSaved ? (
              <><Check size={15} /> Saved</>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── RecipeDetail page ─────────────────────────────────────────────────────────

export function RecipeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const recipeId = id ?? null;
  const { data: recipe, isLoading, error } = useRecipe(recipeId);
  const [localRecipe, setLocalRecipe] = useState<RecipeDetailType | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { mutate: deleteRecipe, isPending: isDeleting } = useDeleteRecipe();

  const displayed = localRecipe ?? recipe;

  const handleDelete = () => {
    if (!recipeId) return;
    if (confirmDelete) {
      deleteRecipe(recipeId, {
        onSuccess: () => navigate('/recipes', { replace: true }),
      });
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-cream dark:bg-night-base pb-24 px-5 pt-6">
        <div className="h-8 skeleton rounded-full w-24 mb-6" aria-busy="true" />
        <div className="space-y-4">
          <div className="h-10 skeleton rounded-2xl w-3/4" />
          <div className="h-4 skeleton rounded-full w-full" />
          <div className="h-4 skeleton rounded-full w-2/3" />
        </div>
      </div>
    );
  }

  if (error || !displayed) {
    return (
      <div className="min-h-screen bg-cream dark:bg-night-base flex items-center justify-center px-5">
        <div className="text-center space-y-3">
          <span className="text-4xl">😕</span>
          <p className="text-soft-charcoal dark:text-night-text font-semibold">Recipe not found</p>
          <button
            onClick={() => navigate('/recipes')}
            className="px-4 py-2 rounded-pill bg-deep-pink text-white text-sm font-bold"
          >
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  const totalTime = displayed.total_time_minutes
    ?? (((displayed.prep_time_minutes ?? 0) + (displayed.cook_time_minutes ?? 0)) || null);

  return (
    <>
      <div className="min-h-screen bg-cream dark:bg-night-base pb-24">
        {/* Header */}
        <header className="px-5 pt-6 pb-4 lg:px-8 lg:pt-8">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-sm text-soft-charcoal dark:text-night-secondary opacity-70 hover:opacity-100 active:scale-95 transition-all"
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold transition-all active:scale-95 ${
                confirmDelete
                  ? 'bg-deep-coral text-white'
                  : 'bg-white dark:bg-night-surface text-deep-coral border border-deep-coral dark:border-deep-coral'
              }`}
            >
              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {confirmDelete ? 'Confirm Delete' : 'Delete'}
            </button>
          </div>

          <h1 className="text-2xl font-extrabold text-soft-charcoal dark:text-night-text leading-tight">
            {displayed.title}
          </h1>
          {displayed.description && (
            <p className="text-sm text-soft-charcoal dark:text-night-secondary opacity-60 mt-1">
              {displayed.description}
            </p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-2 mt-3">
            {totalTime != null && totalTime > 0 && (
              <div className="flex items-center gap-1 text-sm text-soft-charcoal dark:text-night-secondary opacity-70">
                <Clock size={14} />
                <span>{totalTime} min</span>
              </div>
            )}
            {displayed.servings != null && (
              <div className="flex items-center gap-1 text-sm text-soft-charcoal dark:text-night-secondary opacity-70">
                <Users size={14} />
                <span>{displayed.servings} servings</span>
              </div>
            )}
            {displayed.difficulty && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${DIFFICULTY_COLORS[displayed.difficulty] ?? 'bg-cream text-soft-charcoal'}`}>
                {displayed.difficulty}
              </span>
            )}
            {displayed.cuisine && (
              <span className="px-2 py-0.5 rounded-pill text-xs font-semibold bg-pastel-lavender text-soft-charcoal">
                {displayed.cuisine}
              </span>
            )}
            {displayed.is_draft && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-pastel-peach border border-deep-peach text-soft-charcoal">
                Draft
              </span>
            )}
          </div>
        </header>

        {/* Edit with AI button */}
        <div className="px-5 lg:px-8 mb-4">
          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-pill bg-deep-pink text-white font-bold text-sm shadow-soft hover:shadow-soft-lg active:scale-95 transition-all"
          >
            <Sparkles size={15} />
            Edit with AI
          </button>
        </div>

        {/* Ingredients */}
        {displayed.ingredients?.length > 0 && (
          <section className="px-5 lg:px-8 mb-4">
            <div className="bg-white dark:bg-night-surface rounded-2xl p-4 shadow-soft">
              <h2 className="font-bold text-soft-charcoal dark:text-night-text mb-3">Ingredients</h2>
              <ul className="space-y-2">
                {displayed.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-deep-pink mt-0.5 shrink-0">•</span>
                    <span className="text-soft-charcoal dark:text-night-text">
                      {ing.amount && ing.unit ? `${ing.amount} ${ing.unit} ` : ''}
                      <span className="font-medium">{ing.name}</span>
                      {ing.notes && (
                        <span className="text-soft-charcoal dark:text-night-secondary opacity-50"> — {ing.notes}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Instructions */}
        {displayed.instructions?.length > 0 && (
          <section className="px-5 lg:px-8 mb-4">
            <div className="bg-white dark:bg-night-surface rounded-2xl p-4 shadow-soft">
              <h2 className="font-bold text-soft-charcoal dark:text-night-text mb-3">Instructions</h2>
              <ol className="space-y-3">
                {displayed.instructions.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-deep-pink text-white text-sm font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <p className="text-sm text-soft-charcoal dark:text-night-text leading-relaxed pt-0.5">
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* Dietary tags */}
        {displayed.dietary_tags?.length > 0 && (
          <section className="px-5 lg:px-8 mb-4">
            <div className="flex flex-wrap gap-1.5">
              {displayed.dietary_tags.map((tag, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 rounded-full bg-pastel-mint text-xs font-medium text-soft-charcoal dark:text-night-text"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {showEditModal && (
          <EditModal
            recipe={displayed}
            onClose={() => setShowEditModal(false)}
            onSaved={(updated) => {
              setLocalRecipe(updated);
              setShowEditModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
