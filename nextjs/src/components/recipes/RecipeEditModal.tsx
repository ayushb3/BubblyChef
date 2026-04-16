'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { type Recipe } from './RecipePage'

interface RecipeEditModalProps {
  recipe: Recipe
  onSave: (updates: Partial<Recipe>) => Promise<void>
  onClose: () => void
}

export default function RecipeEditModal({ recipe, onSave, onClose }: RecipeEditModalProps) {
  const [title, setTitle] = useState(recipe.title)
  const [description, setDescription] = useState(recipe.description ?? '')
  const [tags, setTags] = useState((recipe.tags ?? []).join(', '))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        title,
        description,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
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
          <div className="px-5 py-4 space-y-4">
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
