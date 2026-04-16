'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import SpringButton from '@/components/ui/SpringButton'
import FadeInView from '@/components/ui/FadeInView'
import BubblesMascot from '@/components/ui/BubblesMascot'
import AddItemModal from '@/components/pantry/AddItemModal'

interface PantryItem {
  id: string
  name: string
  category: string
  location: string
  quantity: number
  unit: string
  expiry_date: string | null
}

const CATEGORY_EMOJI: Record<string, string> = {
  produce: '🥬',
  dairy: '🧈',
  meat: '🍗',
  dry_goods: '🌾',
  condiments: '🧂',
  snacks: '🍿',
  beverages: '🥤',
  frozen: '🧊',
  other: '📦',
}

const LOCATION_FILTERS = [
  { value: 'all', label: 'All Items' },
  { value: 'fridge', label: 'Fridge' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'counter', label: 'Counter' },
]

function daysUntilExpiry(date: string | null): number | null {
  if (!date) return null
  const diff = new Date(date).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function expiryBadge(days: number | null) {
  if (days === null) return null
  if (days <= 0) return { label: 'Expired', color: 'bg-red-400 text-white' }
  if (days <= 2) return { label: `${days}d left`, color: 'bg-red-300 text-white' }
  if (days <= 5) return { label: `${days}d left`, color: 'bg-yellow-300 text-yellow-900' }
  return { label: `${days}d left`, color: 'bg-green-200 text-green-800' }
}

function groupByCategory(items: PantryItem[]) {
  const groups: Record<string, PantryItem[]> = {}
  for (const item of items) {
    const cat = item.category || 'other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  }
  return groups
}

export default function PantryPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['pantry', {}],
    queryFn: () => fetch('/api/pantry').then((r) => r.json()),
  })

  const allItems: PantryItem[] = data?.items ?? []

  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<PantryItem | null>(null)

  // Client-side filtering
  const filteredItems = allItems.filter((item) => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    if (locationFilter !== 'all' && item.location !== locationFilter) return false
    return true
  })

  const grouped = groupByCategory(filteredItems)
  const categories = Object.keys(grouped).sort()

  const handleOpenAdd = () => {
    setEditItem(null)
    setModalOpen(true)
  }

  const handleOpenEdit = (item: PantryItem) => {
    setEditItem(item)
    setModalOpen(true)
  }

  const handleModalClose = () => {
    setModalOpen(false)
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="p-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BubblesMascot state="happy" size={32} animate={false} />
          <h1 className="text-2xl font-extrabold text-[var(--color-text)]">My Pantry 🧺</h1>
        </div>
        <span className="bg-[var(--color-primary)] text-white text-xs font-semibold px-3 py-1 rounded-full">
          {allItems.length} item{allItems.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search bar */}
      <div className="px-6 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items..."
          className="w-full rounded-full px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)] placeholder:text-[var(--color-muted)]"
        />
      </div>

      {/* Location filter chips */}
      <div className="px-6 mb-4 flex gap-2 overflow-x-auto">
        {LOCATION_FILTERS.map((loc) => (
          <button
            key={loc.value}
            type="button"
            onClick={() => setLocationFilter(loc.value)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              locationFilter === loc.value
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-white text-[var(--color-text)] border border-[var(--color-border)]'
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-4xl animate-bounce">🧺</span>
          <p className="text-sm text-[var(--color-muted)]">Loading pantry...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="mx-6 bg-[var(--color-surface)] rounded-3xl overflow-hidden border border-[var(--color-border)] shadow-sm">
          <div className="chowder-panel px-5 py-3">
            <p className="text-white font-semibold text-sm">Fresh & Stocked</p>
          </div>
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="mb-4">
              <BubblesMascot state="surprised" size={100} />
            </div>
            <p className="font-semibold text-[var(--color-text)] mb-1">
              {search || locationFilter !== 'all' ? 'No items match your filters' : 'Your pantry is empty!'}
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              {search || locationFilter !== 'all' ? 'Try different search terms.' : 'Scan a receipt or add items to get started.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="px-6 space-y-4">
          {categories.map((cat) => (
            <FadeInView key={cat}>
              <div className="bg-[var(--color-surface)] rounded-3xl overflow-hidden border border-[var(--color-border)] shadow-sm">
                <div className="chowder-panel px-5 py-2.5">
                  <p className="text-white font-semibold text-sm capitalize">
                    {CATEGORY_EMOJI[cat] ?? '📦'} {cat.replace('_', ' ')}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  {grouped[cat].map((item, i) => {
                    const days = daysUntilExpiry(item.expiry_date)
                    const badge = expiryBadge(days)
                    return (
                      <motion.button
                        key={item.id}
                        type="button"
                        onClick={() => handleOpenEdit(item)}
                        className="bg-white rounded-2xl p-3 border border-[var(--color-border)] text-left hover:border-[var(--color-primary)] transition-colors"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.25 }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">{CATEGORY_EMOJI[item.category] ?? '📦'}</span>
                          <span className="font-semibold text-sm text-[var(--color-text)] truncate">
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--color-muted)]">
                            {item.quantity} {item.unit}
                          </span>
                          {badge && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.color}`}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            </FadeInView>
          ))}
        </div>
      )}

      {/* FAB */}
      <div className="fixed bottom-24 right-6 z-40">
        <SpringButton
          onClick={handleOpenAdd}
          className="bg-[var(--color-primary)] text-white font-semibold py-3 px-5 rounded-full shadow-lg"
        >
          + Add Item
        </SpringButton>
      </div>

      {/* Add/Edit Modal */}
      <AddItemModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        editItem={editItem}
      />
    </div>
  )
}
