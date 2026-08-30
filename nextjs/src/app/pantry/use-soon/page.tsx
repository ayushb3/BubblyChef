'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import BubblesHeader from '@/components/layout/BubblesHeader'
import FadeInView from '@/components/ui/FadeInView'
import EmptyState from '@/components/ui/EmptyState'
import ThemePicker from '@/components/ui/ThemePicker'
import ResolveActions from '@/components/pantry/ResolveActions'
import { getFoodEmoji } from '@/lib/food-emoji'
import { titleCase } from '@/lib/format'
import { cookThisHref } from '@/lib/chat-seed'
import { daysUntilExpiry } from '@/lib/pantry-helpers'
import { resolvePantryItem, type ResolveOutcome } from '@/lib/api/pantry'
import type { PantryItem } from '@/types/pantry'

/**
 * Everything that needs attention, most urgent first (#139).
 *
 * Deliberately built on the `['pantry']` query rather than `/api/pantry/expiring`.
 * That endpoint excludes already-expired stock on purpose (#239) — it existed to
 * answer "what should I cook soon", and expired food was noise there. This view
 * is the opposite case: expired items are exactly what needs clearing, and now
 * that #140 gives them a remedy they belong at the top of the list. Filtering
 * here keeps that endpoint's contract intact for its other callers and reuses a
 * cache the pantry page has usually already warmed.
 */

/** Expired first (most negative), then soonest to expire. */
export function urgencySort(a: PantryItem, b: PantryItem): number {
  const da = daysUntilExpiry(a.expiry_date)
  const db = daysUntilExpiry(b.expiry_date)
  if (da === null) return 1
  if (db === null) return -1
  return da - db
}

export function needsAttention(item: PantryItem): boolean {
  const days = daysUntilExpiry(item.expiry_date)
  return days !== null && days <= 3
}

export function urgencyTier(days: number | null) {
  if (days === null) return null
  if (days < 0) {
    const ago = Math.abs(days)
    return {
      label: ago === 1 ? 'Expired yesterday' : `Expired ${ago}d ago`,
      color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]',
    }
  }
  if (days === 0)
    return {
      label: 'Today',
      color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]',
    }
  if (days === 1)
    return {
      label: 'Tomorrow',
      color: 'bg-[var(--color-expired)] text-[var(--color-expired-text)]',
    }
  return {
    label: `${days} days left`,
    color: 'bg-[var(--color-expiring)] text-[var(--color-expiring-text)]',
  }
}

export default function UseSoonPage() {
  const queryClient = useQueryClient()
  const prefersReduced = useReducedMotion()

  const { data, isLoading } = useQuery({
    queryKey: ['pantry', {}],
    queryFn: () => fetch('/api/pantry').then((r) => r.json()),
  })

  const items: PantryItem[] = (data?.items ?? []).filter(needsAttention).sort(urgencySort)

  const resolveMutation = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: ResolveOutcome }) =>
      resolvePantryItem(id, outcome),
    onSuccess: () => {
      // The row disappears from this list because the server no longer returns
      // it — the list is derived from the refetch, never patched locally.
      queryClient.invalidateQueries({ queryKey: ['pantry'] })
    },
  })

  const resolvingId = resolveMutation.isPending ? resolveMutation.variables?.id : undefined

  return (
    <div className="min-h-screen pb-24">
      <BubblesHeader
        rightSlot={
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <span className="bg-[var(--color-primary)] text-white text-xs font-semibold px-3 py-1 rounded-full">
                {items.length} to clear
              </span>
            )}
            <ThemePicker />
          </div>
        }
      />

      <div className="px-6 pt-2 pb-4">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Use Soon</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Most urgent first — cook it, or tell me what happened to it.
        </p>
      </div>

      {isLoading ? (
        <div className="px-6 space-y-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          className="mx-6"
          mascotState="happy"
          headerLabel="All clear"
          headline="Nothing's about to expire — nice! ✨"
          subline="Everything in your pantry has time left. Check back in a few days."
        />
      ) : (
        <div className="px-6 space-y-2">
          {items.map((item, i) => {
            const days = daysUntilExpiry(item.expiry_date)
            const tier = urgencyTier(days)
            const pending = resolvingId === item.id

            return (
              <FadeInView key={item.id}>
                <motion.div
                  className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden"
                  initial={prefersReduced ? undefined : { opacity: 0, y: 8 }}
                  animate={prefersReduced ? undefined : { opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25 }}
                >
                  <div className="p-3 flex items-center gap-3">
                    <span className="text-2xl" aria-hidden>
                      {getFoodEmoji(item.name, item.category)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[var(--color-text)] truncate">
                        {titleCase(item.name)}
                      </p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {item.quantity} {item.unit}
                      </p>
                    </div>
                    {tier && (
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${tier.color}`}
                      >
                        {tier.label}
                      </span>
                    )}
                  </div>

                  <Link
                    href={cookThisHref(item.name, item.expiry_date)}
                    aria-label={`Find a recipe using ${item.name}`}
                    className="border-t border-[var(--color-border)] px-3 min-h-[44px] flex items-center justify-center text-xs font-semibold text-[var(--color-primary-dark)] hover:bg-[var(--color-border)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]"
                  >
                    🍳 Find a recipe
                  </Link>

                  {/* Always the button affordance here, never the swipe: every
                      row on this page is urgent by construction, which is the
                      case #140 says earns a visible control. */}
                  <ResolveActions
                    itemName={item.name}
                    pending={pending}
                    onResolve={(outcome) => resolveMutation.mutate({ id: item.id, outcome })}
                  />
                </motion.div>
              </FadeInView>
            )
          })}
        </div>
      )}
    </div>
  )
}
