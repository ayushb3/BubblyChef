'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { Camera, Fire, Lightbulb, Sparkle } from '@phosphor-icons/react/dist/ssr'
import type { ComponentType } from 'react'
import BubblesMascot from '@/components/ui/BubblesMascot'
import type { BubblesState } from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import { titleCase } from '@/lib/format'
import { useMotionConfig } from '@/lib/motion'
import { cookThisHref, tipChatHref } from '@/lib/chat-seed'
import { fetchDashboardDaily } from '@/lib/api/dashboard'
import type { DashboardTip, DashboardSuggestion } from '@/lib/api/dashboard'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'
import { estimatedExpirySuffix } from '@/lib/pantry-helpers'
import { useDecorations, useKitchenOffer } from '@/lib/api/kitchen'
import { useBubbles } from '@/lib/api/bubbles'
import KitchenScene from '@/components/kitchen/KitchenScene'
import UnlockOffer from '@/components/kitchen/UnlockOffer'
// --- PROTOTYPE (throwaway, issue #586/#593/#554): everything below this
// banner down to the `return` swap is scaffolding for `?variant=A|B|C` — it
// reuses every fetch/derivation above unchanged and only branches the JSX.
import PrototypeSwitcher from '@/components/prototype/PrototypeSwitcher'
import HomeVariantA from '@/components/dashboard/prototype/HomeVariantA'
import HomeVariantB from '@/components/dashboard/prototype/HomeVariantB'
import HomeVariantC from '@/components/dashboard/prototype/HomeVariantC'
import { deriveMoodAndSpeech, MOCK_MILESTONE_OPTIONS } from '@/components/dashboard/prototype/speech'
import type { QuickAction } from '@/components/dashboard/prototype/types'

interface HomeData {
  totalCount: number
  expiringCount: number
  urgentItem: EnrichedPantryItem | null
  tip: DashboardTip | null
  suggestion: DashboardSuggestion | null
  /** True when the pantry has an expired item that hasn't been used up (issue #525). */
  hasUnusedExpired: boolean
  // PROTOTYPE (#593): the #525 boolean alone can't name the item in the
  // "worried" speech-bubble copy — these two are additive, derived from the
  // same already-fetched `allItems`, and unused by the default (non-variant)
  // render below.
  expiredItem: EnrichedPantryItem | null
  expiredCount: number
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
 * Same shape `BottomNav` uses for its Phosphor tabs. The action cards share
 * the nav's icon set (Phosphor, `weight="fill"`) so the home screen reads as
 * one system instead of three platform-dependent emoji next to line icons
 * (#391).
 */
interface IconProps {
  size?: number
  weight?: 'fill' | 'regular'
  className?: string
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

// PROTOTYPE (#586/#593/#554): `useSearchParams` requires a Suspense boundary
// around its consumer. Wrapping here (rather than in `app/page.tsx`) keeps
// the route file untouched, per this prototype's "sub-shape A" brief.
export default function HeroHome(props: HeroHomeProps) {
  return (
    <Suspense fallback={null}>
      <HeroHomeInner {...props} />
    </Suspense>
  )
}

function HeroHomeInner({ displayName }: HeroHomeProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<HomeData>({
    totalCount: 0,
    expiringCount: 0,
    urgentItem: null,
    tip: null,
    suggestion: null,
    hasUnusedExpired: false,
    expiredItem: null,
    expiredCount: 0,
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

        // #525 — Bubbles goes "worried" when there's expired food sitting
        // unused (still has quantity) rather than already used up or cleared.
        const hasUnusedExpired = allItems.some((item) => item.is_expired && item.quantity > 0)
        // PROTOTYPE (#593): same predicate as hasUnusedExpired, kept so the
        // "worried" speech bubble can name the actual item.
        const unusedExpiredItems = allItems.filter((item) => item.is_expired && item.quantity > 0)

        setData({
          totalCount: pantryData.total_count ?? allItems.length,
          expiringCount,
          urgentItem,
          tip: dashboardDaily?.tip ?? null,
          suggestion: dashboardDaily?.suggestion ?? null,
          hasUnusedExpired,
          expiredItem: unusedExpiredItems[0] ?? null,
          expiredCount: unusedExpiredItems.length,
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

  const { springs } = useMotionConfig()

  // Tip expand/collapse (#391). The card used to `line-clamp-2` the tip with
  // no way to read the rest: sighted users silently lost the end of the
  // sentence while screen-reader users got the full text via the link's
  // aria-label. `tipOverflows` is measured, not assumed, so a short tip that
  // fits in two lines never grows a pointless "Read more" control.
  const [tipExpanded, setTipExpanded] = useState(false)
  const [tipOverflows, setTipOverflows] = useState(false)
  const tipTextRef = useRef<HTMLParagraphElement>(null)

  const greeting = clockReady ? getGreeting() : 'Hello'
  const emoji = clockReady ? getGreetingEmoji() : '👋'
  const { totalCount, expiringCount, urgentItem, tip: dashboardTip, suggestion, hasUnusedExpired } = data

  // Kitchen scene (#521): `decorations` rows use `name`/`decoration_type`;
  // KitchenScene expects `id`/`slot`. The balance is `null` until `/api/bubbles`
  // answers, so the scene hides its pill rather than flashing a `0`.
  const { data: decorationsData, isLoading: decorationsLoading } = useDecorations()
  const { data: bubblesData } = useBubbles()
  const balance = bubblesData?.balance ?? null
  const unlocked = (decorationsData?.decorations ?? []).map((row) => ({
    id: row.name,
    slot: row.decoration_type,
  }))

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

  // --- PROTOTYPE (#586/#593/#554) -------------------------------------
  // Everything in this block is additive: it reuses `data` above unchanged
  // and only decides whether to render a variant instead of the default JSX
  // further down. `?variant=` absent (or unrecognised) => `variant` stays
  // null and the component falls through to the exact original return.
  const searchParams = useSearchParams()
  const variantParam = searchParams?.get('variant')
  const variant: 'A' | 'B' | 'C' | null =
    variantParam === 'A' || variantParam === 'B' || variantParam === 'C' ? variantParam : null

  const moodParam = searchParams?.get('mood')
  const moodOverride: BubblesState | null =
    moodParam === 'happy' || moodParam === 'surprised' || moodParam === 'worried' || moodParam === 'celebrate'
      ? moodParam
      : null

  const milestoneForced = searchParams?.get('milestone') === '1'

  // `hasUnusedExpired`, `expiredItem`.. already destructured further below;
  // pull them here too since this block runs ahead of that destructure.
  const { hasUnusedExpired: protoHasUnusedExpired, expiredItem, expiredCount } = data

  const speech = variant
    ? deriveMoodAndSpeech({
        totalCount,
        hasUnusedExpired: protoHasUnusedExpired,
        expiredItem,
        expiredCount,
        urgentItem,
        expiringCount,
        suggestion,
        moodOverride,
      })
    : null

  const { data: kitchenOfferData } = useKitchenOffer()
  const realMilestoneOptions = kitchenOfferData?.options ?? []
  const showMilestone = variant
    ? milestoneForced || realMilestoneOptions.length > 0
    : false
  const milestoneOptions =
    realMilestoneOptions.length > 0
      ? realMilestoneOptions
      : milestoneForced
        ? MOCK_MILESTONE_OPTIONS
        : []
  const milestoneThreshold = kitchenOfferData?.threshold ?? (milestoneForced ? 500 : null)

  const quickActions: QuickAction[] = [
    {
      icon: Fire,
      label: 'Use Soon',
      detail: expiringCount > 0 ? `${expiringCount} item${expiringCount > 1 ? 's' : ''}` : 'All fresh!',
      pending: loading,
      href: '/pantry',
      gradient: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
    },
    {
      icon: Camera,
      label: 'Scan',
      detail: 'Receipt',
      pending: false,
      href: '/pantry?add=scan',
      gradient: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)',
    },
    {
      icon: Sparkle,
      label: 'Ask',
      detail: 'Bubbles',
      pending: false,
      href: '/chat',
      gradient: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-accent-dark) 100%)',
    },
  ]

  // PROTOTYPE: this effect must run on every render regardless of `variant`
  // (rules of hooks — the branch below returns early), so it's hoisted above
  // that branch. It's a no-op whenever `tipTextRef` isn't mounted (i.e. any
  // variant is active), same as it always was a no-op before `loading` flips.
  useEffect(() => {
    if (loading || tipExpanded) return
    const el = tipTextRef.current
    if (!el) return
    const measure = () => setTipOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [loading, tipExpanded, tip])

  if (variant && speech) {
    const variantProps = {
      displayName,
      greeting,
      emoji,
      loading,
      totalCount,
      expiringCount,
      tip,
      tipHref: tipChatHref(tip),
      mood: speech.mood,
      speechMessage: speech.message,
      speechButton: speech.button,
      kitchen: { unlocked, balance, loading: decorationsLoading },
      showMilestone,
      milestoneOptions,
      milestoneThreshold,
      quickActions,
    }
    return (
      <>
        {variant === 'A' && <HomeVariantA {...variantProps} />}
        {variant === 'B' && <HomeVariantB {...variantProps} />}
        {variant === 'C' && (
          <HomeVariantC {...variantProps} forceExpanded={searchParams?.get('sheet') === 'expanded'} />
        )}
        <PrototypeSwitcher />
      </>
    )
  }
  // --- END PROTOTYPE branch — everything below is the untouched original.

  return (
    <div className="flex flex-col items-center">
      {/* Kitchen scene — 12 fixed decoration slots + Bubbles balance (#521).
          KitchenScene's root has only absolutely-positioned children, so it
          contributes no intrinsic (max-content) width of its own — a `%`
          width doesn't count towards that either. Every ancestor down to
          here sits inside a `flex flex-col items-center` container, whose
          `items-center` override makes flex items shrink-wrap to their
          max-content width instead of stretching to the container's width.
          With zero max-content contribution at the bottom of that chain, the
          whole chain (including this `FadeInView`, itself a flex item)
          collapsed to ~2px — text-bearing siblings below don't hit this
          because their text gives them a non-zero max-content width. Passing
          `className` all the way down to `FadeInView` (a plain prop it
          forwards onto its own `motion.div`) breaks the shrink-wrap by
          giving every link in the chain an explicit width instead of an
          inferred one. `max-w-[480px]` (not `max-w-sm`'s 384px) matches
          KitchenScene's own cap so the scene can actually reach the full
          480px column issue #521 asks for. */}
      <FadeInView delay={0} className="w-full max-w-[480px] mb-4">
        <KitchenScene
          unlocked={unlocked}
          balance={balance}
          loading={decorationsLoading}
        />
      </FadeInView>

      {/* Milestone unlock offer (#522) — mounted directly under the kitchen
          scene per the issue's placement instruction. Renders nothing when
          there's no pending offer. */}
      <UnlockOffer />

      {/* Greeting */}
      <FadeInView delay={0}>
        <p className="text-sm text-[var(--color-muted)] font-medium mb-1">
          {greeting}, <span style={{ color: 'var(--color-primary)' }}>{displayName}</span> {emoji}
        </p>
      </FadeInView>

      {/* Hero Bubbles */}
      <FadeInView delay={0.1}>
        <div className="flex flex-col items-center mt-2 mb-4">
          <BubblesMascot
            state={
              hasUnusedExpired ? 'worried' : !suggestion && urgentItem ? 'surprised' : 'happy'
            }
            size={120}
          />
        </div>
      </FadeInView>

      {/* Speech bubble */}
      <FadeInView delay={0.25}>
        <div className="relative max-w-sm w-full mx-auto mb-6" data-tour="hero">
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
      <div className="grid grid-cols-3 gap-3 w-full max-w-sm mb-6" data-tour="quick-actions">
        {([
          {
            icon: Fire,
            label: 'Use Soon',
            detail: expiringCount > 0 ? `${expiringCount} item${expiringCount > 1 ? 's' : ''}` : 'All fresh!',
            // Only this card's detail depends on fetched data.
            pending: loading,
            href: '/pantry',
            gradient: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          },
          {
            icon: Camera,
            label: 'Scan',
            detail: 'Receipt',
            pending: false,
            href: '/pantry?add=scan',
            gradient: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-dark) 100%)',
          },
          {
            icon: Sparkle,
            label: 'Ask',
            detail: 'Bubbles',
            pending: false,
            href: '/chat',
            gradient: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-accent-dark) 100%)',
          },
        ] satisfies Array<{
          icon: ComponentType<IconProps>
          label: string
          detail: string
          pending: boolean
          href: string
          gradient: string
        }>).map((card, i) => {
          const Icon = card.icon
          return (
          <FadeInView key={card.href} delay={0.35 + i * 0.08}>
            <Link href={card.href}>
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="flex flex-col items-center rounded-2xl p-4 shadow-sm border border-white/30 text-white text-center"
                style={{ background: card.gradient }}
              >
                {/* Decorative: the card's label is the accessible name. */}
                <Icon size={28} weight="fill" className="mb-1" aria-hidden="true" />
                <span className="text-sm font-bold">{card.label}</span>
                {card.pending ? (
                  <Skeleton onColor className="w-10 h-2 mt-1.5 mb-0.5" />
                ) : (
                  <span className="text-[10px] opacity-80 mt-0.5">{card.detail}</span>
                )}
              </motion.div>
            </Link>
          </FadeInView>
          )
        })}
      </div>

      {/* Tip of the day — compact. Gated on `loading` like its three siblings
          above: without this, the fallback tip renders on first paint and gets
          swapped for the AI tip once the fetch lands, reflowing the clamped
          card and changing `tipChatHref` out from under a fast click. */}
      <FadeInView delay={0.6}>
        {loading ? (
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-[var(--color-border)] max-w-sm w-full"
            style={{ background: 'var(--color-surface)' }}
            aria-busy="true"
          >
            <Lightbulb size={20} weight="fill" className="flex-shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
            <div className="flex-1 flex flex-col gap-1.5">
              <Skeleton className="w-11/12 h-2.5" />
              <Skeleton className="w-2/3 h-2.5" />
            </div>
          </div>
        ) : (
          /* Two distinct affordances rather than one overloaded tap (#391):
             the card body expands/collapses the clamped tip, and a separate
             "Ask Bubbles" pill carries the seeded-chat deep link that used to
             be the whole card. The full tip text is always in the DOM — the
             clamp is purely visual — so the screen-reader path is unchanged. */
          <motion.div
            layout
            transition={springs.soft}
            className="rounded-2xl px-4 py-3 border border-[var(--color-border)] max-w-sm w-full"
            style={{ background: 'var(--color-surface)' }}
          >
            <div className="flex items-start gap-3">
              <Lightbulb
                size={20}
                weight="fill"
                className="flex-shrink-0 mt-0.5 text-[var(--color-primary)]"
                aria-hidden="true"
              />
              <p
                id="home-tip-text"
                ref={tipTextRef}
                className={`flex-1 text-xs text-[var(--color-muted)] leading-snug ${tipExpanded ? '' : 'line-clamp-2'}`}
              >
                <strong className="text-[var(--color-text)] font-semibold">Tip: </strong>
                {tip}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 mt-2">
              {(tipOverflows || tipExpanded) && (
                <button
                  type="button"
                  onClick={() => setTipExpanded((e) => !e)}
                  aria-expanded={tipExpanded}
                  aria-controls="home-tip-text"
                  className="text-xs font-semibold px-3 py-2 rounded-full text-[var(--color-text)] border border-[var(--color-border)] active:scale-95 transition-transform motion-reduce:transition-none"
                  style={{ background: 'var(--color-bg)' }}
                >
                  {tipExpanded ? 'Show less' : 'Read more'}
                </button>
              )}
              {/* href is derived from the same `tip` the card renders, so the
                  post-hydration correction moves both together (#143). Without
                  an explicit label the accessible name would be just "Ask
                  Bubbles", which gives no hint of what the chat is seeded with. */}
              <Link
                href={tipChatHref(tip)}
                aria-label={`Ask Bubbles about today's tip: ${tip}`}
                className="text-xs font-semibold px-3 py-2 rounded-full text-white active:scale-95 transition-transform motion-reduce:transition-none"
                style={{ background: 'var(--color-primary)' }}
              >
                Ask Bubbles
              </Link>
            </div>
          </motion.div>
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
