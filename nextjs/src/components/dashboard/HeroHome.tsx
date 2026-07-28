'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import { cookThisHref, tipChatHref } from '@/lib/chat-seed'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'

interface Recipe {
  id: string
  title: string
  total_time_minutes: number | null
}

interface HomeData {
  totalCount: number
  expiringCount: number
  urgentItem: EnrichedPantryItem | null
  recipe: Recipe | null
}

const tips = [
  'Season your pan, not just your food!',
  'Let meat rest after cooking — way more tender.',
  'Freeze herbs in olive oil ice cubes!',
  'Toast spices in a dry pan for 30 seconds.',
  'Pasta water makes sauces silky.',
  'Green onions regrow in a glass of water.',
  'Taste as you cook — adjust seasoning throughout.',
]

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
    recipe: null,
  })

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [pantryRes, expiringRes, recipesRes] = await Promise.all([
          fetch('/api/pantry'),
          fetch('/api/pantry/expiring?days=3'),
          fetch('/api/recipes?limit=5'),
        ])
        const [pantryData, expiringData, recipesData] = await Promise.all([
          pantryRes.ok ? pantryRes.json() : { items: [], total_count: 0 },
          expiringRes.ok ? expiringRes.json() : { items: [], count: 0 },
          recipesRes.ok ? recipesRes.json() : { recipes: [], total_count: 0 },
        ])

        const allItems: EnrichedPantryItem[] = pantryData.items ?? []
        const expiringItems: EnrichedPantryItem[] = expiringData.items ?? []
        const recipes: Recipe[] = recipesData.recipes ?? []

        const urgentItem =
          expiringItems.find(
            (item) => item.days_until_expiry !== null && item.days_until_expiry <= 1
          ) ?? null

        const expiringCount = allItems.filter(
          (item) =>
            item.is_expiring_soon ||
            (item.days_until_expiry !== null && item.days_until_expiry <= 7)
        ).length

        setData({
          totalCount: pantryData.total_count ?? allItems.length,
          expiringCount,
          urgentItem,
          recipe:
            recipes.length > 0
              ? recipes[Math.floor(Math.random() * recipes.length)]
              : null,
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
  const tip = tips[(clockReady ? new Date().getDay() : 0) % tips.length]
  const { totalCount, expiringCount, urgentItem, recipe } = data

  // Compute the single hero message (most important)
  const heroMessage = urgentItem
    ? `Your ${urgentItem.name} expires ${urgentItem.days_until_expiry === 0 ? 'today' : 'tomorrow'}! Let's cook it up.`
    : totalCount === 0
      ? "Your pantry is empty — let's stock up!"
      : recipe
        ? `How about ${recipe.title} tonight?${recipe.total_time_minutes ? ` Only ${recipe.total_time_minutes} min!` : ''}`
        : expiringCount > 0
          ? `${expiringCount} item${expiringCount > 1 ? 's' : ''} expiring soon — time to cook!`
          : 'Your kitchen is looking great!'

  // The urgent-item CTA deep-links into a chat seeded with that ingredient
  // (#138), so one tap lands on a recipe that actually uses it.
  const heroAction = urgentItem
    ? { label: 'Find a recipe', href: cookThisHref(urgentItem.name, urgentItem.expiry_date) }
    : totalCount === 0
      ? { label: 'Scan receipt', href: '/pantry?add=scan' }
      : recipe
        ? { label: 'Open recipe', href: '/recipes' }
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
          <BubblesMascot state={urgentItem ? 'surprised' : 'happy'} size={120} />
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

      {/* Tip of the day — compact */}
      <FadeInView delay={0.6}>
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
                {expiringCount > 0 && (
                  <span> · <span style={{ color: 'var(--color-primary)' }}>{expiringCount} expiring</span></span>
                )}
              </p>
            )}
          </div>
        </FadeInView>
      )}
    </div>
  )
}
