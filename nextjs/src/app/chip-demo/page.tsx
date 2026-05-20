'use client'

import { useState } from 'react'
import Chip from '@/components/ui/Chip'
import { tagToTone } from '@/lib/tag-tone'

const ALL_TONES = ['primary', 'accent', 'fresh', 'expiring', 'expired', 'muted'] as const

const SAMPLE_TAGS = [
  'vegan', 'vegetarian', 'gluten-free', 'dairy-free',
  'spicy', 'hot', 'sweet', 'dessert',
  'breakfast', 'lunch', 'dinner', 'snack',
  'easy', 'quick', 'comfort', 'healthy',
  'italian', 'mexican', 'asian', 'japanese',
]

const META_CHIPS = [
  { emoji: '⏱️', label: '30 min', tone: 'expiring' as const },
  { emoji: '🍽️', label: '4 servings', tone: 'muted' as const },
  { emoji: '✨', label: 'Easy', tone: 'fresh' as const },
]

export default function ChipDemo() {
  const [selectedTone, setSelectedTone] = useState<string | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  return (
    <div className="min-h-screen p-8 max-w-xl mx-auto space-y-10"
         style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}>

      <div>
        <h1 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--color-text)' }}>
          Chip Component Demo
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Switch themes via the header picker to see all 5 palettes.
        </p>
      </div>

      {/* All tones — static */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          All tones (static)
        </h2>
        <div className="flex flex-wrap gap-2">
          {ALL_TONES.map(tone => (
            <Chip key={tone} tone={tone}>{tone}</Chip>
          ))}
        </div>
      </section>

      {/* All tones — with emoji */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          With emoji prefix
        </h2>
        <div className="flex flex-wrap gap-2">
          <Chip tone="primary" emoji="🍯">Sweet</Chip>
          <Chip tone="fresh" emoji="🌿">Vegan</Chip>
          <Chip tone="expired" emoji="🌶️">Spicy</Chip>
          <Chip tone="expiring" emoji="⚡">Quick</Chip>
          <Chip tone="accent" emoji="🤗">Comfort</Chip>
          <Chip tone="muted" emoji="🍽️">4 servings</Chip>
        </div>
      </section>

      {/* Sizes */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Sizes
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="primary" size="sm" emoji="🌿">sm chip</Chip>
          <Chip tone="primary" size="md" emoji="🌿">md chip</Chip>
        </div>
      </section>

      {/* Interactive — selected state */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Clickable + selected state (tap to toggle)
        </h2>
        <div className="flex flex-wrap gap-2">
          {ALL_TONES.map(tone => (
            <Chip
              key={tone}
              tone={tone}
              selected={selectedTone === tone}
              onClick={() => setSelectedTone(prev => prev === tone ? null : tone)}
            >
              {tone}
            </Chip>
          ))}
        </div>
        {selectedTone && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Selected: <strong>{selectedTone}</strong>
          </p>
        )}
      </section>

      {/* Recipe meta chips */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Recipe meta chips (replaces MetaChip)
        </h2>
        <div className="flex flex-wrap gap-2">
          {META_CHIPS.map(({ emoji, label, tone }) => (
            <Chip key={label} tone={tone} emoji={emoji}>{label}</Chip>
          ))}
        </div>
      </section>

      {/* Tag chips via tagToTone */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Recipe tag chips (via tagToTone helper)
        </h2>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_TAGS.map(tag => {
            const { tone, emoji } = tagToTone(tag)
            return (
              <Chip
                key={tag}
                tone={tone}
                emoji={emoji || undefined}
                selected={selectedTag === tag}
                onClick={() => setSelectedTag(prev => prev === tag ? null : tag)}
              >
                {tag}
              </Chip>
            )
          })}
        </div>
        {selectedTag && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Selected: <strong>{selectedTag}</strong> → tone: <strong>{tagToTone(selectedTag).tone}</strong>
          </p>
        )}
      </section>

      {/* Location filter chips (replaces pantry filter buttons) */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Filter chips (replaces pantry location buttons)
        </h2>
        <div className="flex flex-wrap gap-2">
          {(['All', 'Fridge', 'Freezer', 'Pantry', 'Other'] as const).map((loc, i) => (
            <Chip
              key={loc}
              tone={i === 0 ? 'primary' : 'muted'}
              selected={i === 0}
            >
              {loc}
            </Chip>
          ))}
        </div>
      </section>

      {/* Suggestion chips (replaces chat suggestion buttons) */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Suggestion chips (replaces chat suggestion buttons)
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { label: '🍳 What can I make tonight?', tone: 'accent' as const },
            { label: '🥗 Something healthy', tone: 'fresh' as const },
            { label: '⚡ Quick meals under 20 min', tone: 'expiring' as const },
            { label: '🌶️ Spicy recipes', tone: 'expired' as const },
          ].map(({ label, tone }) => (
            <Chip key={label} tone={tone} onClick={() => {}}>{label}</Chip>
          ))}
        </div>
      </section>

    </div>
  )
}
