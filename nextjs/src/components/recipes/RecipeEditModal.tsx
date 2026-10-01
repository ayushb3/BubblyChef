'use client'

import { useState } from 'react'
import { type Recipe } from './RecipePage'
import { ingredientLabel, ingredientRowsToPayload, type IngredientRow } from '@/lib/recipe-helpers'
import PixelSheet from '@/components/ui/PixelSheet'

const toStepStr = (s: string | { text?: string; step?: string }): string =>
  typeof s === 'string' ? s : (s.text ?? s.step ?? '')

interface RecipeEditModalProps {
  recipe: Recipe
  onSave: (updates: Partial<Recipe>) => Promise<void>
  onClose: () => void
  /** When true, the close/cancel buttons are blocked (parent mutation in-flight) */
  disabled?: boolean
}

export default function RecipeEditModal({ recipe, onSave, onClose, disabled = false }: RecipeEditModalProps) {
  const [title, setTitle] = useState(recipe.title)
  const [description, setDescription] = useState(recipe.description ?? '')
  const [tags, setTags] = useState((recipe.tags ?? []).join(', '))
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>(
    (recipe.ingredients ?? []).map((original) => ({ original, text: ingredientLabel(original) }))
  )
  const [instructions, setInstructions] = useState<string[]>(
    (recipe.instructions ?? []).map(toStepStr)
  )
  const [saving, setSaving] = useState(false)
  // Close is blocked while saving/disabled. PixelSheet routes Escape, the
  // scrim, the header X and drag-dismiss through this one guarded close.
  const closeBlocked = saving || disabled
  const handleClose = () => {
    if (!closeBlocked) onClose()
  }

  const updateItem = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string
  ) => setter(prev => prev.map((v, i) => (i === index ? value : v)))

  const removeItem = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number
  ) => setter(prev => prev.filter((_, i) => i !== index))

  const addItem = (setter: React.Dispatch<React.SetStateAction<string[]>>) =>
    setter(prev => [...prev, ''])

  const updateIngredient = (index: number, value: string) =>
    setIngredientRows(prev => prev.map((row, i) => (i === index ? { ...row, text: value } : row)))

  const removeIngredient = (index: number) =>
    setIngredientRows(prev => prev.filter((_, i) => i !== index))

  const addIngredient = () =>
    setIngredientRows(prev => [...prev, { original: null, text: '' }])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        title,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        ingredients: ingredientRowsToPayload(ingredientRows),
        instructions: instructions.filter(Boolean),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <PixelSheet
      open
      onClose={handleClose}
      title="Edit Recipe"
      titleId="recipe-edit-modal-title"
      closeDisabled={closeBlocked}
      footer={
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving || disabled || !title.trim()}
            className="flex-1 py-2.5 rounded-full text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-transform"
            style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleClose}
            disabled={saving || disabled}
            className="flex-1 py-2.5 rounded-full text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform"
            style={{
              background: 'var(--color-bg)',
              border: '1.5px solid var(--color-border)',
              color: 'var(--color-muted)',
              fontFamily: 'Nunito, sans-serif',
            }}
          >
            Cancel
          </button>
        </div>
      }
    >
      {/* Body */}
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label
            className="text-xs font-semibold block mb-1"
            style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
          >
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl px-4 py-2.5 text-sm border focus:border-[var(--color-primary)]"
            style={{
              background: 'var(--color-bg)',
              border: '1.5px solid var(--color-border)',
              color: 'var(--color-text)',
              fontFamily: 'Nunito, sans-serif',
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label
            className="text-xs font-semibold block mb-1"
            style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
          >
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-xl px-4 py-2.5 text-sm resize-none border focus:border-[var(--color-primary)]"
            style={{
              background: 'var(--color-bg)',
              border: '1.5px solid var(--color-border)',
              color: 'var(--color-text)',
              fontFamily: 'Nunito, sans-serif',
            }}
          />
        </div>

        {/* Tags */}
        <div>
          <label
            className="text-xs font-semibold block mb-1"
            style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
          >
            Tags
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma-separated"
            className="w-full rounded-xl px-4 py-2.5 text-sm border focus:border-[var(--color-primary)]"
            style={{
              background: 'var(--color-bg)',
              border: '1.5px solid var(--color-border)',
              color: 'var(--color-text)',
              fontFamily: 'Nunito, sans-serif',
            }}
          />
        </div>

        {/* Ingredients */}
        <div>
          <label
            className="text-xs font-semibold block mb-1"
            style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
          >
            Ingredients
          </label>
          <div className="space-y-1.5">
            {ingredientRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={row.text}
                  onChange={(e) => updateIngredient(i, e.target.value)}
                  className="flex-1 rounded-xl px-3 py-2 text-sm border focus:border-[var(--color-primary)]"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1.5px solid var(--color-border)',
                    color: 'var(--color-text)',
                    fontFamily: 'Nunito, sans-serif',
                  }}
                />
                <button
                  onClick={() => removeIngredient(i)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs hover:opacity-70 flex-shrink-0"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1.5px solid var(--color-border)' }}
                  aria-label="Remove ingredient"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addIngredient}
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={{ color: 'var(--color-primary)', background: 'var(--color-bg)', border: '1.5px solid var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
            >
              + Add ingredient
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div>
          <label
            className="text-xs font-semibold block mb-1"
            style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
          >
            Instructions
          </label>
          <div className="space-y-1.5">
            {instructions.map((step, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-2"
                  style={{ background: 'var(--color-primary)', color: '#fff', fontFamily: 'Nunito, sans-serif' }}
                >
                  {i + 1}
                </span>
                <textarea
                  value={step}
                  onChange={(e) => updateItem(setInstructions, i, e.target.value)}
                  rows={2}
                  className="flex-1 rounded-xl px-3 py-2 text-sm resize-none border focus:border-[var(--color-primary)]"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1.5px solid var(--color-border)',
                    color: 'var(--color-text)',
                    fontFamily: 'Nunito, sans-serif',
                  }}
                />
                <button
                  onClick={() => removeItem(setInstructions, i)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs hover:opacity-70 flex-shrink-0 mt-1"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1.5px solid var(--color-border)' }}
                  aria-label="Remove step"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => addItem(setInstructions)}
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={{ color: 'var(--color-primary)', background: 'var(--color-bg)', border: '1.5px solid var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
            >
              + Add step
            </button>
          </div>
        </div>
      </div>
    </PixelSheet>
  )
}
