'use client'

/**
 * "Use Soon" triage view — issue #139.
 *
 * A dedicated route rather than a filtered mode of `/pantry`: the browse view
 * groups by category in a 2-up grid with search/location chips, which is a
 * different job (find a specific item) from this one (clear everything that's
 * about to go bad, most urgent first). Bolting a flat urgency-sorted list
 * into that page would mean two mutually-exclusive render paths sharing one
 * component; a separate route keeps each page's layout single-purpose and
 * gives the dashboard's "Use Soon" card a stable, linkable destination.
 *
 * This is a client component fetching client-side via React Query — nothing
 * here awaits on the server, so the route-level fallback already provided by
 * `app/loading.tsx` covers the initial navigation frame. A segment `loading.tsx`
 * would only earn its keep if this page did server-side data fetching.
 */

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import BubblesHeader from '@/components/layout/BubblesHeader'
import EmptyState from '@/components/ui/EmptyState'
import FadeInView from '@/components/ui/FadeInView'
import ResolveActions from '@/components/pantry/ResolveActions'
import { getFoodEmoji } from '@/lib/food-emoji'
import { titleCase } from '@/lib/format'
import { cookThisHref } from '@/lib/chat-seed'
import { expiryBadge } from '@/lib/expiry-badge'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'

/** Ascending: expired (most negative days) first, then soonest-to-expire. */
function byUrgency(a: EnrichedPantryItem, b: EnrichedPantryItem): number {
  const aDays = a.days_until_expiry ?? Number.POSITIVE_INFINITY
  const bDays = b.days_until_expiry ?? Number.POSITIVE_INFINITY
  return aDays - bDays
}

export default function UseSoonPage() {
  const queryClient = useQueryClient()

  // Query key shares the `'pantry'` prefix with `/pantry`'s `['pantry', {}]`
  // so a single `invalidateQueries({ queryKey: ['pantry'] })` (partial match,
  // the default) refetches both views after a resolve, whichever one fired it.
  const { data, isLoading } = useQuery({
    queryKey: ['pantry', 'expiring'],
    queryFn: () => fetch('/api/pantry/expiring').then((r) => r.json()),
  })

  const items: EnrichedPantryItem[] = data?.items ?? []
  const sorted = [...items].sort(byUrgency)

  const handleResolved = () => {
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
  }

  return (
    <div className="min-h-screen pb-24">
      <BubblesHeader
        mascotState={sorted.length > 0 ? 'surprised' : 'happy'}
        rightSlot={
          <div className="flex items-center gap-2">
            <Link
              href="/pantry"
              className="focus-ring text-xs font-semibold text-[var(--color-muted)] px-3 py-1 rounded-full border border-[var(--color-border)]"
            >
              ← Pantry
            </Link>
            <span className="bg-[var(--color-primary)] text-white text-xs font-semibold px-3 py-1 rounded-full">
              {sorted.length} item{sorted.length !== 1 ? 's' : ''}
            </span>
          </div>
        }
      />

      <div className="px-6 pt-4">
        <h1 className="text-lg font-extrabold text-[var(--color-text)] mb-1">🔥 Use Soon</h1>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Expired and expiring items, most urgent first.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-4xl animate-bounce">⏳</span>
          <p className="text-sm text-[var(--color-muted)]">Checking your pantry...</p>
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          className="mx-6"
          headerLabel="Use Soon"
          mascotState="happy"
          headline="Nothing's about to expire — nice! ✨"
          subline="Everything in your pantry is still fresh."
        />
      ) : (
        <div className="px-6 space-y-3">
          {sorted.map((item, i) => {
            const badge = expiryBadge(item.days_until_expiry)
            return (
              <FadeInView key={item.id} delay={i * 0.03}>
                <div
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 flex flex-col gap-2 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg flex-shrink-0">
                        {getFoodEmoji(item.name, item.category)}
                      </span>
                      <span className="font-semibold text-sm text-[var(--color-text)] truncate">
                        {titleCase(item.name)}
                      </span>
                    </div>
                    {badge && (
                      <span
                        className={`flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>

                  {/* One tap into a chat seeded with this ingredient (#138) —
                      `use` carries the raw stored name, not the display copy. */}
                  <Link
                    href={cookThisHref(item.name, item.expiry_date)}
                    aria-label={`Find a recipe for ${item.name}`}
                    className="focus-ring min-h-[44px] flex items-center justify-center rounded-full text-xs font-semibold text-[var(--color-primary-dark)] border border-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors"
                  >
                    🍳 Find a recipe
                  </Link>

                  <ResolveActions
                    itemId={item.id}
                    itemName={item.name}
                    onResolved={handleResolved}
                  />
                </div>
              </FadeInView>
            )
          })}
        </div>
      )}
    </div>
  )
}
