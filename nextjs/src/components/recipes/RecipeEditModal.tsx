'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { type Recipe, type Ingredient } from './RecipePage'

const toIngStr = (i: string | Ingredient): string =>
  typeof i === 'string' ? i : [i.quantity, i.unit, i.name].filter(Boolean).join(' ')

const toStepStr = (s: string | { text?: string; step?: string }): string =>
  typeof s === 'string' ? s : (s.text ?? s.step ?? '')

interface RecipeEditModalProps {
  recipe: Recipe
  onSave: (updates: Partial<Recipe>) => Promise<void>
  onClose: () => void
}

export default function RecipeEditModal({ recipe, onSave, onClose }: RecipeEditModalProps) {
  const [title, setTitle] = useState(recipe.title)
  const [description, setDescription] = useState(recipe.description ?? '')
  const [tags, setTags] = useState((recipe.tags ?? []).join(', '))
  const [ingredients, setIngredients] = useState<string[]>(
    (recipe.ingredients ?? []).map(toIngStr)
  )
  const [instructions, setInstructions] = useState<string[]>(
    (recipe.instructions ?? []).map(toStepStr)
  )
  const [saving, setSaving] = useState(false)

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

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        title,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        ingredients: ingredients.filter(Boolean),
        instructions: instructions.filter(Boolean),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <>
        {/* Backdrop */}
        <motion.div
          key="edit-backdrop"
          className="fixed inset-0 z-50"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        />

        {/* Modal panel */}
        <motion.div
          key="edit-panel"
          className="fixed inset-x-4 top-1/2 z-50 rounded-2xl overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            maxWidth: '440px',
            marginInline: 'auto',
            transform: 'translateY(-50%)',
          }}
          initial={{ y: 'calc(-50% + 20px)', opacity: 0 }}
          animate={{ y: '-50%', opacity: 1 }}
          exit={{ y: 'calc(-50% + 20px)', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h2
              className="text-base font-extrabold"
              style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
            >
              Edit Recipe
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70 active:scale-95"
              style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
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
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none border focus:border-[var(--color-primary)]"
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
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none resize-none border focus:border-[var(--color-primary)]"
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
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none border focus:border-[var(--color-primary)]"
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
                {ingredients.map((item, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={item}
                      onChange={(e) => updateItem(setIngredients, i, e.target.value)}
                      className="flex-1 rounded-xl px-3 py-2 text-sm outline-none border focus:border-[var(--color-primary)]"
                      style={{
                        background: 'var(--color-bg)',
                        border: '1.5px solid var(--color-border)',
                        color: 'var(--color-text)',
                        fontFamily: 'Nunito, sans-serif',
                      }}
                    />
                    <button
                      onClick={() => removeItem(setIngredients, i)}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs hover:opacity-70 flex-shrink-0"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1.5px solid var(--color-border)' }}
                      aria-label="Remove ingredient"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addItem(setIngredients)}
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
                      className="flex-1 rounded-xl px-3 py-2 text-sm outline-none resize-none border focus:border-[var(--color-primary)]"
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

          {/* Footer actions */}
          <div
            className="flex gap-3 px-5 py-4 border-t"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex-1 py-2.5 rounded-full text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-transform"
              style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={onClose}
              disabled={saving}
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
        </motion.div>
      </>
    </AnimatePresence>
  )
}
