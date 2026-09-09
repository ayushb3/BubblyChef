'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import { titleCase } from '@/lib/format'
import { cookThisHref, tipChatHref } from '@/lib/chat-seed'
import { fetchDashboardDaily } from '@/lib/api/dashboard'
import type { DashboardTip, DashboardSuggestion } from '@/lib/api/dashboard'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'
import { estimatedExpirySuffix } from '@/lib/pantry-helpers'

interface HomeData {
  totalCount: number
  expiringCount: number
  urgentItem: EnrichedPantryItem | null
  tip: DashboardTip | null
  suggestion: DashboardSuggestion | null
}

// Client-side fallback only — used when `GET /v1/dashboard/daily` (#225, #168)
// can't be reached at all (network error, proxy 401, etc). The backend has
// its own, separately-maintained fallback list for when *it* can't reach an
// AI provider (see `ai-service/bubbly_chef/services/dashboard_service.py`);
// this list exists purely so the dashboard never shows a blank tip or an
// error when the client can't even complete the request.
const FALLBACK_TIPS = [
  'Season your pan, not just your food!',
  'Let meat rest after cooking — way more tender.',
  'Freeze herbs in olive oil ice cubes!',
  'Toast spices in a dry pan for 30 seconds.',
  'Pasta water makes sauces silky.',
  'Green onions regrow in a glass of water.',
  'Taste as you cook — adjust seasoning throughout.',
]

/**
 * True when `copy` already states `minutes` as a time figure (e.g. "ready in
 * 25 min" or "...in 25 minutes"). Used to avoid appending "Only N min!" onto
 * copy that already says the number — see #225 spec-review finding 2.
 */
function copyMentionsMinutes(copy: string, minutes: number): boolean {
  return new RegExp(`\\b${minutes}\\b\\s*min`, 'i').test(copy)
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  if (hour >= 18 && hour < 22) return 'Good evening'
  return 'Late night snack?'
}

function getGreetingEmoji(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return '☀️'
  if (hour >= 12 && hour < 18) return '🌤️'
  return '🌙'
}

interface HeroHomeProps {
  displayName: string
}

/**
 * Shared skeleton idiom — same pulse + `var(--color-border)` fill used by the
 * route-level fallback in `app/loading.tsx`, so there's only one loading look.
 * Rendered as a `<span className="block">` so it stays valid inside `<p>`.
 */
function Skeleton({
  className,
  onColor = false,
}: {
  className?: string
  /** Sitting on top of a gradient card, where `--color-border` would disappear. */
  onColor?: boolean
}) {
  return (
    <span
      className={`block rounded animate-pulse motion-reduce:animate-none ${className ?? ''}`}
      style={{ background: onColor ? 'rgb(255 255 255 / 0.45)' : 'var(--color-border)' }}
      aria-hidden="true"
    />
  )
}

export default function HeroHome({ displayName }: HeroHomeProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<HomeData>({
    totalCount: 0,
    expiringCount: 0,
    urgentItem: null,
    tip: null,
    suggestion: null,
  })

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [pantryRes, expiringRes, dashboardDaily] = await Promise.all([
          fetch('/api/pantry'),
          fetch('/api/pantry/expiring?days=3'),
          // Failure here degrades to the static FALLBACK_TIPS list and no
          // suggestion card — it must never take down the rest of the hero.
          fetchDashboardDaily().catch(() => null),
        ])
        const [pantryData, expiringData] = await Promise.all([
          pantryRes.ok ? pantryRes.json() : { items: [], total_count: 0 },
          expiringRes.ok ? expiringRes.json() : { items: [], count: 0 },
        ])

        const allItems: EnrichedPantryItem[] = pantryData.items ?? []
        const expiringItems: EnrichedPantryItem[] = expiringData.items ?? []

        // Both windows need a lower bound. days_until_expiry goes negative once an
        // item is past its date, so an unbounded `<= n` also matches food that
        // expired weeks ago — which made the hero announce a long-expired item as
        // "expires tomorrow" and inflated the "expiring" count with dead stock.
        // Expired items are deliberately excluded here rather than relabelled:
        // they are still surfaced on /pantry with an "Expired" badge, and #146
        // already established that they should not get a cook-this-now CTA.
        const urgentItem =
          expiringItems.find(
            (item) =>
              item.days_until_expiry !== null &&
              item.days_until_expiry >= 0 &&
              item.days_until_expiry <= 1
          ) ?? null

        const expiringCount = allItems.filter(
          (item) =>
            item.is_expiring_soon ||
            (item.days_until_expiry !== null &&
              item.days_until_expiry >= 0 &&
              item.days_until_expiry <= 7)
        ).length

        setData({
          totalCount: pantryData.total_count ?? allItems.length,
          expiringCount,
          urgentItem,
          tip: dashboardDaily?.tip ?? null,
          suggestion: dashboardDaily?.suggestion ?? null,
        })
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  // The greeting/tip are derived from the *client's* clock, which can disagree with
  // the server's. Now that this block renders on the first pass (rather than behind
  // the old all-or-nothing `loading` gate), we follow the ThemeProvider convention:
  // render a neutral value on both passes, then correct it in an effect after
  // hydration. That keeps the greeting instant without a hydration mismatch.
  const [clockReady, setClockReady] = useState(false)
  useEffect(() => {
    setClockReady(true)
  }, [])

  const greeting = clockReady ? getGreeting() : 'Hello'
  const emoji = clockReady ? getGreetingEmoji() : '👋'
  const { totalCount, expiringCount, urgentItem, tip: dashboardTip, suggestion } = data

  // Tip text now comes from `GET /v1/dashboard/daily` (#225) — per-user,
  // grounded in that user's own pantry. FALLBACK_TIPS only renders when the
  // request itself failed (dashboardTip stays null), or before it resolves.
  // Weekday indexing into the static list is gone; it's just a fallback pick
  // now, so any stable index is fine — clockReady gates it purely to avoid an
  // SSR/client hydration mismatch, same as the greeting above.
  const tip = dashboardTip?.text ?? FALLBACK_TIPS[(clockReady ? new Date().getDay() : 0) % FALLBACK_TIPS.length]

  // Compute the single hero message (most important). `suggestion.copy` is
  // AI-written (or templated by the backend's own fallback) and already
  // grounded in why this recipe won (#168) — the frontend no longer composes
  // its own "Feel like trying X?" sentence. The design doc's "Only N min!"
  // note means don't change the number's correctness, not keep concatenating
  // it onto a sentence that already states it: the backend's own fallback
  // copy template ends with "... ready in {N} min.", so appending
  // unconditionally always duplicated the figure on that path. Only append
  // when `copy` doesn't already mention the minute count (see
  // `copyMentionsMinutes` and dashboard-recipe-suggestion.test.tsx).
  //
  // Priority order (#347): the AI-ranked suggestion leads whenever it exists —
  // expiry urgency is a signal, not the headline. Urgent-expiry copy surfaces
  // only when there is no suggestion to show.
  const heroMessage = totalCount === 0
    ? "Your pantry is empty — let's stock up!"
    : suggestion
      ? `${suggestion.copy}${
          suggestion.total_time_minutes && !copyMentionsMinutes(suggestion.copy, suggestion.total_time_minutes)
            ? ` Only ${suggestion.total_time_minutes} min!`
            : ''
        }`
      : urgentItem
        ? `Your ${titleCase(urgentItem.name)} expires ${urgentItem.days_until_expiry === 0 ? 'today' : 'tomorrow'}${estimatedExpirySuffix(urgentItem.estimated_expiry)}! Let's cook it up.`
        : expiringCount > 0
          ? "Check the 'Use Soon' tile — some items need your attention!"
          : 'Your kitchen is looking great!'

  // The urgent-item CTA deep-links into a chat seeded with that ingredient
  // (#138), so one tap lands on a recipe that actually uses it.
  const heroAction = totalCount === 0
    ? { label: 'Scan receipt', href: '/pantry?add=scan' }
    : suggestion
      ? { label: 'Open recipe', href: `/recipes/${suggestion.recipe_id}` }
      : urgentItem
        ? { label: 'Find a recipe', href: cookThisHref(urgentItem.name, urgentItem.expiry_date) }
        : expiringCount > 0
          ? { label: 'View pantry', href: '/pantry' }
          : { label: 'Ask Bubbles', href: '/chat' }

  return (
    <div className="flex flex-col items-center">
      {/* Greeting */}
      <FadeInView delay={0}>
        <p className="text-sm text-[var(--color-muted)] font-medium mb-1">
          {greeting}, <span style={{ color: 'var(--color-primary)' }}>{displayName}</span> {emoji}
        </p>
      </FadeInView>

      {/* Hero Bubbles */}
      <FadeInView delay={0.1}>
        <div className="flex flex-col items-center mt-2 mb-4">
          <BubblesMascot state={!suggestion && urgentItem ? 'surprised' : 'happy'} size={120} />
        </div>
      </FadeInView>

      {/* Speech bubble */}
      <FadeInView delay={0.25}>
        <div className="relative max-w-sm w-full mx-auto mb-6">
          {/* Triangle pointer */}
          <div
            className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-l border-t border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
          />
          <div
            className="relative rounded-2xl p-4 text-center shadow-sm border border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
            aria-busy={loading}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-2">
                <Skeleton className="w-11/12 h-3" />
                <Skeleton className="w-2/3 h-3" />
                <Skeleton className="w-28 h-7 rounded-full mt-2" />
              </div>
            ) : (
              <>
                <p className="text-[var(--color-text)] font-medium text-sm leading-relaxed">
                  {heroMessage}
                </p>
                <Link
                  href={heroAction.href}
                  className="inline-block mt-3 text-xs font-semibold px-5 py-2 rounded-full text-white"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {heroAction.label}
                </Link>
              </>
            )}
          </div>
        </div>
      </FadeInView>

      {/* 3 Action Cards */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-6">
        {[
          {
            emoji: '🔥',
            label: 'Use Soon',
            detail: expiringCount > 0 ? `${expiringCount} item${expiringCount > 1 ? 's' : ''}` : 'All fresh!',
            // Only this card's detail depends on fetched data.
            pending: loading,
            href: '/pantry',
            gradient: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          },
          {
            emoji: '📷',
            label: 'Scan',
            detail: 'Receipt',
            pending: false,
            href: '/pantry?add=scan',
            gradient: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)',
          },
          {
            emoji: '✨',
            label: 'Ask',
            detail: 'Bubbles',
            pending: false,
            href: '/chat',
            gradient: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-accent-dark) 100%)',
          },
        ].map((card, i) => (
          <FadeInView key={card.href} delay={0.35 + i * 0.08}>
            <Link href={card.href}>
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="flex flex-col items-center rounded-2xl p-4 shadow-sm border border-white/30 text-white text-center"
                style={{ background: card.gradient }}
              >
                <span className="text-2xl mb-1">{card.emoji}</span>
                <span className="text-sm font-bold">{card.label}</span>
                {card.pending ? (
                  <Skeleton onColor className="w-10 h-2 mt-1.5 mb-0.5" />
                ) : (
                  <span className="text-[10px] opacity-80 mt-0.5">{card.detail}</span>
                )}
              </motion.div>
            </Link>
          </FadeInView>
        ))}
      </div>

      {/* Tip of the day — compact. Gated on `loading` like its three siblings
          above: without this, the fallback tip renders on first paint and gets
          swapped for the AI tip once the fetch lands, reflowing the
          `line-clamp-2` card and changing `tipChatHref` out from under a fast
          click. */}
      <FadeInView delay={0.6}>
        {loading ? (
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-[var(--color-border)] max-w-sm w-full"
            style={{ background: 'var(--color-surface)' }}
            aria-busy="true"
          >
            <span className="text-lg flex-shrink-0">💡</span>
            <div className="flex-1 flex flex-col gap-1.5">
              <Skeleton className="w-11/12 h-2.5" />
              <Skeleton className="w-2/3 h-2.5" />
            </div>
          </div>
        ) : (
          <>
            {/* href is derived from the same `tip` the card renders, so the
                post-hydration correction moves both together (#143). */}
            {/* Without an explicit label the accessible name is just the raw tip
                text, which gives no hint that activating it opens a chat. */}
            <Link
              href={tipChatHref(tip)}
              aria-label={`Ask Bubbles about today's tip: ${tip}`}
              className="block max-w-sm w-full"
            >
              <div
                className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-[var(--color-border)]"
                style={{ background: 'var(--color-surface)' }}
              >
                <span className="text-lg flex-shrink-0">💡</span>
                <p className="text-xs text-[var(--color-muted)] leading-snug line-clamp-2">
                  <strong className="text-[var(--color-text)] font-semibold">Tip: </strong>
                  {tip}
                </p>
              </div>
            </Link>
          </>
        )}
      </FadeInView>

      {/* Pantry status bar — data-dependent, so it skeletons until the fetches land */}
      {(loading || totalCount > 0) && (
        <FadeInView delay={0.7}>
          <div className="mt-4 flex justify-center text-center">
            {loading ? (
              <Skeleton className="w-36 h-3" />
            ) : (
              <p className="text-xs text-[var(--color-muted)]">
                🧺 {totalCount} item{totalCount !== 1 ? 's' : ''} in pantry
              </p>
            )}
          </div>
        </FadeInView>
      )}
    </div>
  )
}
