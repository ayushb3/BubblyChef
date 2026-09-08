'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import SpringButton from '@/components/ui/SpringButton'
import FadeInView from '@/components/ui/FadeInView'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import AddItemModal from '@/components/pantry/AddItemModal'
import ThemePicker from '@/components/ui/ThemePicker'
import PantryAddSheet, { type PantryAddTab } from '@/components/pantry/PantryAddSheet'
import ResolveActions from '@/components/pantry/ResolveActions'
import SwipeToResolve from '@/components/pantry/SwipeToResolve'
import { resolvePantryItem, type ResolveOutcome } from '@/lib/api/pantry'
import type { PantryItem } from '@/types/pantry'
import { getFoodEmoji } from '@/lib/food-emoji'
import { titleCase } from '@/lib/format'
import { cookThisHref } from '@/lib/chat-seed'
import { daysUntilExpiry, isExpiringSoon, isExpired, itemMatchesFacets } from '@/lib/pantry-helpers'
import type { PantryFacetSelection } from '@/lib/pantry-helpers'
import FacetDropdown from '@/components/ui/FacetDropdown'
import { LOCATIONS } from '@/components/pantry/AddItemModal'

// Category card tints — dedicated --color-cat-* tokens (globals.css). These must
// never reference expiry/status tokens (fresh/expiring/expired): status signals
// urgency, category signals food group. Reusing them made produce look "fresh".
const CATEGORY_BG: Record<string, string> = {
  produce: 'var(--color-cat-produce)',
  dairy: 'var(--color-cat-dairy)',
  frozen: 'var(--color-cat-frozen)',
  meat: 'var(--color-cat-meat)',
  seafood: 'var(--color-cat-seafood)',
  beverages: 'var(--color-cat-beverages)',
  condiments: 'var(--color-cat-condiments)',
  pantry: 'var(--color-cat-dry-goods)',
  dry_goods: 'var(--color-cat-dry-goods)',
  canned: 'var(--color-cat-dry-goods)',
  snacks: 'var(--color-cat-snacks)',
  other: 'var(--color-cat-other)',
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

// Location facet options: reuses `AddItemModal`'s `LOCATIONS` list rather than
// carrying a second, parallel one (#228). "All Items" isn't an option anymore —
// an empty selection means "no location constraint", handled by
// `itemMatchesFacets`.
const LOCATION_OPTIONS = LOCATIONS

// Category facet options: reuses the exact same emoji/label source the display
// grouping below uses for its section headers (`CATEGORY_EMOJI`), so the facet
// list and the grouped headings can never drift apart (#228).
const CATEGORY_OPTIONS = Object.keys(CATEGORY_EMOJI).map((value) => ({
  value,
  label: value.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  emoji: CATEGORY_EMOJI[value],
}))

const EXPIRY_OPTIONS = [
  { value: 'expiring', label: 'Expiring soon', emoji: '⏳' },
  { value: 'expired', label: 'Expired', emoji: '⚠️' },
]

// `daysUntilExpiry`/`isExpiringSoon`/`isExpired` live in `lib/pantry-helpers` —
// this file used to carry its own copy of the expiry maths that subtracted
// `Date.now()` instead of local midnight, which made the badge disagree with
// the server-computed flags after ~18:00 (#244). `isUrgent` below is kept as a
// thin alias so the "Cook this" deep link and card styling read the same as
// before; it delegates to the shared `isExpiringSoon` predicate rather than
// redefining the 0–3 day window, so the expiry facet (#228) can never drift
// from the card badges.
function isUrgent(days: number | null): boolean {
  return isExpiringSoon(days)
}

function expiryBadge(days: number | null) {
  if (days === null) return null
  if (days < 0) return { label: 'Expired', color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days === 0) return { label: 'Today', color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days <= 2) return { label: `${days}d left`, color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]' }
  if (days <= 5) return { label: `${days}d left`, color: 'bg-[var(--color-expiring)] text-[var(--color-expiring-text)]' }
  return { label: `${days}d left`, color: 'bg-[var(--color-fresh)] text-[var(--color-fresh-text)]' }
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
  return (
    <Suspense>
      <PantryPageInner />
    </Suspense>
  )
}

function PantryPageInner() {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  // A gesture whose only feedback is movement isn't usable without motion, so
  // reduced-motion users get the button affordance on every card (#140).
  const prefersReduced = useReducedMotion()

  const { data, isLoading } = useQuery({
    queryKey: ['pantry', {}],
    queryFn: () => fetch('/api/pantry').then((r) => r.json()),
  })

  const allItems: PantryItem[] = data?.items ?? []

  const [search, setSearch] = useState('')
  const [locationFacet, setLocationFacet] = useState<string[]>([])
  const [categoryFacet, setCategoryFacet] = useState<string[]>([])
  const [expiryFacet, setExpiryFacet] = useState<string[]>([])

  // Edit modal (single item)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<PantryItem | null>(null)

  // Add sheet (bulk add: scan + type)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [addSheetTab, setAddSheetTab] = useState<PantryAddTab>('scan')

  // Handle ?add=scan or ?add=type URL params
  useEffect(() => {
    const addParam = searchParams.get('add')
    if (addParam === 'scan' || addParam === 'type') {
      /* The URL is an external system being synced into React, which is exactly
         what an effect is for. This cannot be derived state: the user must be able
         to close the sheet again, so once opened its visibility belongs to the
         component, not the param. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAddSheetTab(addParam)
      setAddSheetOpen(true)
    }
  }, [searchParams])

  // Client-side filtering: text search ANDs with the facet selection.
  // `itemMatchesFacets` (lib/pantry-helpers) encodes OR-within/AND-across-facet
  // semantics — an empty facet selection imposes no constraint (#228).
  const facets: PantryFacetSelection = {
    locations: locationFacet,
    categories: categoryFacet,
    expiryStatuses: expiryFacet as PantryFacetSelection['expiryStatuses'],
  }
  const hasActiveFacets = locationFacet.length > 0 || categoryFacet.length > 0 || expiryFacet.length > 0
  const filteredItems = allItems.filter((item) => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    const days = daysUntilExpiry(item.expiry_date)
    return itemMatchesFacets(item, days, facets)
  })

  const grouped = groupByCategory(filteredItems)
  const categories = Object.keys(grouped).sort()

  const handleOpenAdd = () => {
    setAddSheetTab('scan')
    setAddSheetOpen(true)
  }

  const handleOpenEdit = (item: PantryItem) => {
    setEditItem(item)
    setEditModalOpen(true)
  }

  const handleEditModalClose = () => {
    setEditModalOpen(false)
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
  }

  const handleAddSheetClose = () => {
    setAddSheetOpen(false)
    // Clear ?add param from URL without navigation
    const url = new URL(window.location.href)
    url.searchParams.delete('add')
    router.replace(url.pathname + url.search, { scroll: false })
  }

  const handleItemsAdded = () => {
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
  }

  // Resolving deletes the pantry row and writes an append-only event, so the
  // list is refetched rather than patched: the server is the authority on what
  // is left, and an optimistic removal would have to be un-removed on failure.
  const resolveMutation = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: ResolveOutcome }) =>
      resolvePantryItem(id, outcome),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] })
    },
  })

  const resolvingId = resolveMutation.isPending
    ? resolveMutation.variables?.id
    : undefined

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <BubblesHeader
        rightSlot={
          <div className="flex items-center gap-2">
            <span className="bg-[var(--color-primary)] text-white text-xs font-semibold px-3 py-1 rounded-full">
              {allItems.length} item{allItems.length !== 1 ? 's' : ''}
            </span>
            <ThemePicker />
          </div>
        }
      />

      {/* Search bar */}
      <div className="px-6 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items..."
          className="w-full rounded-full px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)] placeholder:text-[var(--color-muted)]"
        />
      </div>

      {/* Filter facets — location (compact icon), category, expiry status.
          Each is independently multi-select; see `itemMatchesFacets` for the
          OR-within/AND-across-facet combination semantics (#228). */}
      <div className="px-6 mb-4 flex gap-2 overflow-x-auto">
        <FacetDropdown
          iconOnly
          triggerEmoji="📍"
          ariaLabel={`Filter by location${locationFacet.length > 0 ? `, ${locationFacet.length} selected` : ''}`}
          options={LOCATION_OPTIONS}
          selected={locationFacet}
          onChange={setLocationFacet}
        />
        <FacetDropdown
          triggerEmoji="🗂️"
          triggerLabel="Category"
          ariaLabel={`Filter by category${categoryFacet.length > 0 ? `, ${categoryFacet.length} selected` : ''}`}
          options={CATEGORY_OPTIONS}
          selected={categoryFacet}
          onChange={setCategoryFacet}
        />
        <FacetDropdown
          triggerEmoji="⏳"
          triggerLabel="Expiry"
          ariaLabel={`Filter by expiry status${expiryFacet.length > 0 ? `, ${expiryFacet.length} selected` : ''}`}
          options={EXPIRY_OPTIONS}
          selected={expiryFacet}
          onChange={setExpiryFacet}
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-4xl animate-bounce">🧺</span>
          <p className="text-sm text-[var(--color-muted)]">Loading pantry...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="mx-6 bg-[var(--color-surface)] rounded-3xl overflow-hidden border border-[var(--color-border)] shadow-sm">
          <div className="chowder-panel px-5 py-3">
            <p className="text-white font-semibold text-sm">Fresh &amp; Stocked</p>
          </div>
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="mb-4">
              <BubblesMascot state="surprised" size={100} />
            </div>
            <p className="font-semibold text-[var(--color-text)] mb-1">
              {search || hasActiveFacets ? 'No items match your filters' : 'Your pantry is empty!'}
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              {search || hasActiveFacets ? 'Try different search terms.' : 'Scan a receipt or add items to get started.'}
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
                    // Expired or expiring gets the visible buttons; everything
                    // else resolves by swipe, so normal cards stay clean (#140).
                    const urgent = isUrgent(days) || isExpired(days)
                    const showButtons = urgent || prefersReduced
                    const pending = resolvingId === item.id
                    const card = (
                      // Wrapper is a div, not a button: an urgent item nests a
                      // "Cook this" link, and a link inside a button is invalid.
                      <motion.div
                        key={item.id}
                        className="rounded-2xl border border-[var(--color-border)] overflow-hidden hover:border-[var(--color-primary)] transition-colors flex flex-col"
                        style={{ background: CATEGORY_BG[item.category?.toLowerCase() ?? ''] ?? 'var(--color-surface)' }}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.25 }}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          // Inset focus outline: the card wrapper is
                          // `overflow-hidden`, so an outward ring/offset would be
                          // clipped and invisible to keyboard users.
                          className="p-3 text-left w-full flex-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg">{getFoodEmoji(item.name, item.category)}</span>
                            <span className="font-semibold text-sm text-[var(--color-text)] truncate">
                              {titleCase(item.name)}
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
                        </button>

                        {/* One tap from an expiring item to a recipe that uses it */}
                        {isUrgent(days) && (
                          <Link
                            href={cookThisHref(item.name, item.expiry_date)}
                            aria-label={`Cook this ${item.name}`}
                            // WCAG 2.5.5: the label stays `text-xs` so the card
                            // grid doesn't reflow, but the box around it is a
                            // full 44px tap target — same trick ThemePicker uses
                            // (24px swatch inside a 44×44 button).
                            className="border-t border-[var(--color-border)] px-3 min-h-[44px] flex items-center justify-center text-xs font-semibold text-[var(--color-primary-dark)] text-center hover:bg-[var(--color-border)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]"
                          >
                            🍳 Cook this
                          </Link>
                        )}

                        {showButtons && (
                          <ResolveActions
                            itemName={item.name}
                            pending={pending}
                            onResolve={(outcome) =>
                              resolveMutation.mutate({ id: item.id, outcome })
                            }
                          />
                        )}
                      </motion.div>
                    )

                    if (showButtons) return card

                    return (
                      <SwipeToResolve
                        key={item.id}
                        itemName={item.name}
                        pending={pending}
                        onResolve={(outcome) =>
                          resolveMutation.mutate({ id: item.id, outcome })
                        }
                      >
                        {card}
                      </SwipeToResolve>
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

      {/* Bulk Add Sheet (scan + type) */}
      <PantryAddSheet
        isOpen={addSheetOpen}
        onClose={handleAddSheetClose}
        initialTab={addSheetTab}
        onItemsAdded={handleItemsAdded}
      />

      {/* Single Item Edit Modal */}
      <AddItemModal
        isOpen={editModalOpen}
        onClose={handleEditModalClose}
        editItem={editItem}
      />
    </div>
  )
}
