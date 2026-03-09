import { useState } from 'react';
import { Send, ChefHat, Clock, Users, RefreshCw, Sparkles, Check, AlertCircle, X } from 'lucide-react';
import { useGenerateRecipe, useRecipeSuggestions } from '../api/client';
import type { GenerateRecipeResponse } from '../types';

const difficultyColors: Record<string, string> = {
  easy: 'bg-pastel-mint text-soft-charcoal',
  medium: 'bg-pastel-peach text-soft-charcoal',
  hard: 'bg-pastel-coral text-white',
};

const statusIcons: Record<string, { icon: React.ReactNode; color: string }> = {
  have: { icon: <Check size={16} />, color: 'text-green-500' },
  partial: { icon: <AlertCircle size={16} />, color: 'text-yellow-500' },
  missing: { icon: <X size={16} />, color: 'text-red-400' },
};

export function Recipes() {
  const [prompt, setPrompt] = useState('');
  const [generatedRecipe, setGeneratedRecipe] = useState<GenerateRecipeResponse | null>(null);

  const { mutate: generateRecipe, isPending: isGenerating } = useGenerateRecipe();
  const { data: suggestions } = useRecipeSuggestions();

  const handleGenerate = (inputPrompt?: string) => {
    const finalPrompt = inputPrompt || prompt;
    if (!finalPrompt.trim()) return;

    generateRecipe(
      {
        prompt: finalPrompt,
        previous_recipe_context: generatedRecipe
          ? JSON.stringify(generatedRecipe.recipe)
          : undefined,
      },
      {
        onSuccess: (data) => {
          setGeneratedRecipe(data);
          if (!inputPrompt) setPrompt('');
        },
      }
    );
  };

  const handleRegenerate = () => {
    if (!prompt.trim() && !generatedRecipe) return;
    const regeneratePrompt = prompt.trim() || `Something similar to ${generatedRecipe?.recipe.title}`;
    generateRecipe(
      { prompt: regeneratePrompt },
      {
        onSuccess: (data) => {
          setGeneratedRecipe(data);
        },
      }
    );
  };

  const handleSuggestionClick = (suggestion: string) => {
    setPrompt(suggestion);
    handleGenerate(suggestion);
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="pt-4">
        <h1 className="text-3xl font-bold text-soft-charcoal flex items-center gap-2">
          Recipe Magic <Sparkles className="text-pastel-lavender" size={28} />
        </h1>
        <p className="text-soft-charcoal/60 text-sm mt-1">
          Tell me what you want to cook!
        </p>
      </div>

      {/* Prompt Input */}
      <div className="bg-white rounded-2xl p-4 shadow-soft">
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            placeholder="What would you like to make?"
            className="flex-1 px-4 py-3 rounded-xl border border-pastel-pink/20 bg-cream-white focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all"
            disabled={isGenerating}
          />
          <button
            onClick={() => handleGenerate()}
            disabled={isGenerating || !prompt.trim()}
            className="px-4 py-3 rounded-xl bg-pastel-pink text-white font-semibold shadow-soft hover:shadow-soft-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isGenerating ? (
              <RefreshCw size={20} className="animate-spin" />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>

        {/* Suggestions */}
        {!generatedRecipe && suggestions && suggestions.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-soft-charcoal/50 mb-2 font-medium">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(suggestion)}
                  disabled={isGenerating}
                  className="px-3 py-1.5 text-sm rounded-full bg-pastel-lavender/10 text-pastel-lavender font-medium hover:bg-pastel-lavender/20 transition-all disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Loading State */}
      {isGenerating && !generatedRecipe && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-pastel-lavender/20 mb-4">
            <ChefHat className="text-pastel-lavender animate-bounce" size={32} />
          </div>
          <p className="text-soft-charcoal font-semibold">Cooking up something delicious...</p>
          <p className="text-soft-charcoal/50 text-sm mt-1">This may take a moment</p>
        </div>
      )}

      {/* Generated Recipe */}
      {generatedRecipe && (
        <RecipeDisplay
          response={generatedRecipe}
          onRegenerate={handleRegenerate}
          isRegenerating={isGenerating}
        />
      )}

      {/* Empty State */}
      {!generatedRecipe && !isGenerating && (
        <div className="text-center py-12">
          <p className="text-6xl mb-4">👨‍🍳</p>
          <h3 className="text-xl font-bold text-soft-charcoal mb-2">
            Ready to cook?
          </h3>
          <p className="text-soft-charcoal/60 max-w-xs mx-auto">
            Ask me what to make and I'll suggest a recipe based on what's in your pantry!
          </p>
        </div>
      )}
    </div>
  );
}

interface RecipeDisplayProps {
  response: GenerateRecipeResponse;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

function RecipeDisplay({ response, onRegenerate, isRegenerating }: RecipeDisplayProps) {
  const { recipe, ingredients_status, missing_count, have_count, pantry_match_score } = response;

  return (
    <div className="space-y-4">
      {/* Pantry Match Summary */}
      <div className="bg-white rounded-2xl p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-soft-charcoal/60">Pantry Match</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-pastel-mint rounded-full transition-all"
                  style={{ width: `${pantry_match_score * 100}%` }}
                />
              </div>
              <span className="text-sm font-bold text-soft-charcoal">
                {Math.round(pantry_match_score * 100)}%
              </span>
            </div>
          </div>
          <div className="flex gap-3 text-sm">
            <span className="text-green-600 font-medium">✓ {have_count}</span>
            <span className="text-red-400 font-medium">✗ {missing_count}</span>
          </div>
        </div>

        {missing_count > 0 && (
          <div className="mt-3 p-3 bg-pastel-peach/20 rounded-xl">
            <p className="text-sm font-medium text-soft-charcoal mb-1">Missing ingredients:</p>
            <p className="text-sm text-soft-charcoal/70">
              {ingredients_status
                .filter(s => s.status === 'missing')
                .map(s => s.ingredient_name)
                .join(', ')}
            </p>
          </div>
        )}
      </div>

      {/* Recipe Card */}
      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-pastel-pink/20 to-pastel-lavender/20">
          <h2 className="text-2xl font-bold text-soft-charcoal">{recipe.title}</h2>
          {recipe.description && (
            <p className="text-soft-charcoal/60 mt-1">{recipe.description}</p>
          )}

          {/* Meta info */}
          <div className="flex flex-wrap gap-3 mt-3">
            {recipe.total_time_minutes && (
              <div className="flex items-center gap-1 text-sm text-soft-charcoal/70">
                <Clock size={16} />
                <span>{recipe.total_time_minutes} min</span>
              </div>
            )}
            {recipe.servings && (
              <div className="flex items-center gap-1 text-sm text-soft-charcoal/70">
                <Users size={16} />
                <span>{recipe.servings} servings</span>
              </div>
            )}
            {recipe.difficulty && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${difficultyColors[recipe.difficulty] || 'bg-gray-100'}`}>
                {recipe.difficulty}
              </span>
            )}
            {recipe.cuisine && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-pastel-lavender/20 text-pastel-lavender">
                {recipe.cuisine}
              </span>
            )}
          </div>
        </div>

        {/* Ingredients */}
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-bold text-soft-charcoal mb-3 flex items-center gap-2">
            🥗 Ingredients
          </h3>
          <div className="space-y-2">
            {recipe.ingredients.map((ing, i) => {
              const status = ingredients_status.find(
                s => s.ingredient_name.toLowerCase() === ing.name.toLowerCase()
              );
              const statusInfo = statusIcons[status?.status || 'missing'];

              return (
                <div key={i} className="flex items-start gap-2">
                  <span className={statusInfo.color}>{statusInfo.icon}</span>
                  <span className={`text-sm ${status?.status === 'missing' ? 'text-soft-charcoal/50' : 'text-soft-charcoal'}`}>
                    {ing.quantity && ing.unit ? `${ing.quantity} ${ing.unit} ` : ''}
                    <span className="font-medium">{ing.name}</span>
                    {ing.preparation && <span className="text-soft-charcoal/50">, {ing.preparation}</span>}
                    {ing.optional && <span className="text-xs text-pastel-lavender ml-1">(optional)</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Instructions */}
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-bold text-soft-charcoal mb-3 flex items-center gap-2">
            📝 Instructions
          </h3>
          <ol className="space-y-3">
            {recipe.instructions.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pastel-pink text-white text-sm font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <p className="text-sm text-soft-charcoal leading-relaxed pt-0.5">{step}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Tips */}
        {recipe.tips && recipe.tips.length > 0 && (
          <div className="p-4 bg-pastel-yellow/10">
            <h3 className="font-bold text-soft-charcoal mb-2 flex items-center gap-2">
              💡 Tips
            </h3>
            <ul className="space-y-1">
              {recipe.tips.map((tip, i) => (
                <li key={i} className="text-sm text-soft-charcoal/70 flex items-start gap-2">
                  <span>•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="flex-1 py-3 rounded-full bg-white border border-pastel-lavender/30 text-pastel-lavender font-semibold shadow-soft hover:shadow-soft-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isRegenerating ? (
            <RefreshCw size={18} className="animate-spin" />
          ) : (
            <RefreshCw size={18} />
          )}
          Try Another Recipe
        </button>
      </div>

      {/* Follow-up hint */}
      <div className="text-center">
        <p className="text-xs text-soft-charcoal/40">
          Type a follow-up like "make it spicier" or "substitute for eggs"
        </p>
      </div>
    </div>
  );
}
