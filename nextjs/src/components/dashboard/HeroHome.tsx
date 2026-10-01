'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Lightbulb } from '@phosphor-icons/react/dist/ssr'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import { titleCase } from '@/lib/format'
import { useMotionConfig } from '@/lib/motion'
import { cookThisHref, planDinnerHref, tipChatHref } from '@/lib/chat-seed'
import { kitchenEyebrow } from '@/lib/kitchen/eyebrow'
import {
  PLACE_KEYS,
  kitchenStock,
  summarizePlaces,
  type KitchenStock,
  type PlaceKey,
  type PlaceSummaries,
} from '@/lib/kitchen/places'
import { fetchDashboardDaily } from '@/lib/api/dashboard'
import type { DashboardTip, DashboardSuggestion } from '@/lib/api/dashboard'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'
import { estimatedExpirySuffix } from '@/lib/pantry-helpers'
import { useDecorations } from '@/lib/api/kitchen'
import { useBubbles } from '@/lib/api/bubbles'
import KitchenScene from '@/components/kitchen/KitchenScene'
import StorageSheet, { isStorageView, type StorageView } from '@/components/kitchen/StorageSheet'
import EditItemModal from '@/components/pantry/AddItemModal'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import PixelBubbles from '@/components/kitchen/PixelBubbles'
import { sceneLabel } from '@/lib/kitchen/bubbles-spot'
import { useBubblesSpot } from '@/hooks/useBubblesSpot'
import PutAwaySheet from '@/components/kitchen/PutAwaySheet'
import SpringButton from '@/components/ui/SpringButton'
import { usePendingPutAway } from '@/hooks/usePendingPutAway'
import { incomingByPlace, pendingLineCount } from '@/lib/kitchen/pending-putaway'
import KitchenHeader from '@/components/kitchen/KitchenHeader'
import UnlockOffer from '@/components/kitchen/UnlockOffer'
import KitchenThemePicker from '@/components/kitchen/KitchenThemePicker'
import KitchenThemeUnlockCard from '@/components/kitchen/KitchenThemeUnlockCard'
import { useKitchenTheme } from '@/hooks/useKitchenTheme'

interface HomeData {
  totalCount: number
  expiringCount: number
  urgentItem: EnrichedPantryItem | null
  tip: DashboardTip | null
  suggestion: DashboardSuggestion | null
  /** True when the pantry has an expired item that hasn't been used up (issue #525). */
  hasUnusedExpired: boolean
  /** Per-place counts for the wall; `null` until the pantry loads, and if it fails to. */
  places: PlaceSummaries | null
  /** What each place draws (category sprites and up to 3 wilting items); `null` like `places`. */
  stock: KitchenStock | null
  /** Every pantry row, for the storage sheet; `null` until the pantry loads, and if it fails to. */
  items: EnrichedPantryItem[] | null
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

interface HeroHomeProps {
  /**
   * No longer shown: the greeting went with the kitchen redesign (#748). Kept so
   * the page and its callers keep their signature; the Bubbles card (#755) may
   * address the user by name.
   */
  displayName?: string
  /** `user_metadata.kitchen_theme` as read server-side (#523), or `null` if never set. */
  initialKitchenTheme?: string | null
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

export default function HeroHome({ initialKitchenTheme = null }: HeroHomeProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<HomeData>({
    totalCount: 0,
    expiringCount: 0,
    urgentItem: null,
    tip: null,
    suggestion: null,
    hasUnusedExpired: false,
    places: null,
    stock: null,
    items: null,
  })

  // The pantry, dashboard and expiring reads. `reload` runs it again behind an
  // open sheet (an edit or an add changed the rows): the skeletons are the first
  // load's only, so the home does not flash while the counts catch up.
  const [reloadTick, setReloadTick] = useState(0)
  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

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

        setData({
          totalCount: pantryData.total_count ?? allItems.length,
          expiringCount,
          urgentItem,
          tip: dashboardDaily?.tip ?? null,
          suggestion: dashboardDaily?.suggestion ?? null,
          hasUnusedExpired,
          // A failed pantry fetch is "unknown", not "empty": the wall then shows
          // names only rather than claiming four empty places.
          places: pantryRes.ok ? summarizePlaces(allItems) : null,
          stock: pantryRes.ok ? kitchenStock(allItems) : null,
          items: pantryRes.ok ? allItems : null,
        })
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [reloadTick])

  // The header's weekday / part-of-day eyebrow and the fallback tip are derived
  // from the *client's* clock, which can disagree with the server's. We follow
  // the ThemeProvider convention: render a neutral value on both passes, then
  // correct it in an effect after hydration, so there is no hydration mismatch.
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

  const eyebrow = clockReady ? kitchenEyebrow(new Date()) : ''
  const {
    totalCount,
    expiringCount,
    urgentItem,
    tip: dashboardTip,
    suggestion,
    hasUnusedExpired,
    places,
    stock,
    items,
  } = data

  // Kitchen scene (#521): `decorations` rows use `name`/`decoration_type`;
  // KitchenScene expects `id`/`slot`. The balance is `null` until `/api/bubbles`
  // answers, so the header hides its counter rather than flashing a `0`.
  // Put-away (#753): a parsed scan waits in local storage until it is put away
  // or discarded. While one does, shopping is headed to the places (their +N
  // badges) and Bubbles stands at the door. The sheet opens over the scene when
  // home mounts with one pending (a hand-off from a scan, or a reload).
  const pending = usePendingPutAway()
  const incoming = pending ? incomingByPlace(pending) : null
  const [putAwayOpen, setPutAwayOpen] = useState(false)
  const putAwayOffered = useRef(false)
  useEffect(() => {
    if (pending && !putAwayOffered.current) {
      putAwayOffered.current = true
      setPutAwayOpen(true)
    } else if (!pending) {
      putAwayOffered.current = false
      setPutAwayOpen(false)
    }
  }, [pending])

  // The pixel Bubbles (#752): the door while a scan or put-away is open, the
  // stove while a cook is on record in storage, the fridge when food is going
  // off, else the stove.
  const { spot: bubblesSpot, cooking } = useBubblesSpot({ places, scanOpen: pending !== null })
  const { data: decorationsData, isLoading: decorationsLoading } = useDecorations()
  const { data: bubblesData } = useBubbles()
  const balance = bubblesData?.balance ?? null
  // Rescue streak (#524): null until /api/bubbles answers, same convention
  // as balance — the toolbar hides the "🔥 N" indicator at null or 0.
  const streakWeeks = bubblesData?.streak_weeks ?? null
  const unlocked = (decorationsData?.decorations ?? []).map((row) => ({
    id: row.name,
    slot: row.decoration_type,
  }))

  // Kitchen theme (#523): the balance also drives which themes are
  // unlocked, so this stays gated on the same `balance` value derived above.
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const {
    theme: kitchenTheme,
    unlocked: unlockedThemes,
    saving: themeSaving,
    selectTheme,
    newlyUnlocked,
    dismissUnlock,
    error: themeError,
    clearError: clearThemeError,
  } = useKitchenTheme(initialKitchenTheme, balance)
  const unlockedThemeKeys = new Set(unlockedThemes.map((t) => t.key))

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
          ? 'Some items need using soon: tap the fridge or shelves to check.'
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

  // Measure whether the clamped tip actually overflows. Runs once the tip has
  // rendered (after `loading` flips) and again on resize, since a tip that fits
  // at 480px can wrap to three lines on a narrower phone. Only meaningful while
  // collapsed — an expanded paragraph never overflows its own box.
  useEffect(() => {
    if (loading || tipExpanded) return
    const el = tipTextRef.current
    if (!el) return
    const measure = () => setTipOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [loading, tipExpanded, tip])

  // Storage sheet (issue #749): tapping a place opens it on that place. The
  // `?place=fridge&view=scene|list` deep link opens it directly, on load or when
  // the URL changes under a mounted home.
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [sheet, setSheet] = useState<{ place: PlaceKey; view: StorageView } | null>(null)
  const [editItem, setEditItem] = useState<EnrichedPantryItem | null>(null)
  const [addPlace, setAddPlace] = useState<PlaceKey | null>(null)
  const linkedPlace = searchParams.get('place')
  const linkedView = searchParams.get('view')
  useEffect(() => {
    if (!PLACE_KEYS.includes(linkedPlace as PlaceKey)) return
    // The URL is an external system being synced into React, which is what an
    // effect is for. It cannot be derived state: the user closes the sheet, and
    // once opened its visibility belongs to the component, not the param.
    setSheet({
      place: linkedPlace as PlaceKey,
      view: isStorageView(linkedView) ? linkedView : 'scene',
    })
  }, [linkedPlace, linkedView])

  const closeSheet = () => {
    setSheet(null)
    // A deep-linked visit must not reopen on refresh.
    if (linkedPlace || linkedView) router.replace('/', { scroll: false })
  }

  // The pantry changed behind the sheet: re-read the home's own copy, and mark
  // the pantry page's cache and the Bubbles balance (an add earns) stale.
  const pantryChanged = () => {
    reload()
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
    queryClient.invalidateQueries({ queryKey: ['bubbles'] })
  }

  const pantryStatus = loading ? 'loading' : items ? 'ready' : 'error'

  const mascotState = hasUnusedExpired ? 'worried' : !suggestion && urgentItem ? 'surprised' : 'happy'

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col">
      {/* Header (#748): eyebrow, title, the pixel bubbles counter. */}
      <KitchenHeader eyebrow={eyebrow} balance={balance} />

      {/* The kitchen: the pixel wall (#748) with the 12 decoration slots
          (#521) and the four storage places. Full-bleed, at the board's 96:80
          proportion from first paint, so nothing shifts once data lands. */}
      <KitchenScene
        unlocked={unlocked}
        loading={decorationsLoading}
        theme={kitchenTheme}
        places={places}
        stock={stock}
        onOpenPlace={(place) => setSheet({ place, view: 'scene' })}
        planDinnerHref={planDinnerHref()}
        bubblesLayer={<PixelBubbles spot={bubblesSpot} cooking={cooking} />}
        sceneLabel={sceneLabel(bubblesSpot, cooking)}
        incoming={incoming}
      />

      {/* A scan waiting to be put away, with its sheet closed: the way back in
          until the Bubbles card (#755) offers it. */}
      {pending && !putAwayOpen && (
        <div
          className="flex min-h-11 items-center justify-between gap-3 px-4 pt-3"
          data-testid="put-away-waiting"
        >
          <p className="min-w-0 text-sm font-bold text-[color:var(--color-text)] tabular-nums">
            Shopping is waiting at the door
            <span className="block text-xs">
              {pendingLineCount(pending)} {pendingLineCount(pending) === 1 ? 'item' : 'items'}
            </span>
          </p>
          <SpringButton size="sm" onClick={() => setPutAwayOpen(true)}>
            Put it away
          </SpringButton>
        </div>
      )}

      <PutAwaySheet
        open={putAwayOpen}
        record={pending}
        onClose={() => setPutAwayOpen(false)}
        onPutAway={pantryChanged}
      />

      {/* Under the wall: the pantry count on the left, the streak (#524) and the
          theme picker trigger (#523) on the right. */}
      <div className="flex min-h-11 items-center justify-between gap-2 px-4 pt-2">
        <div className="min-w-0">
          {/* Data-dependent, so it skeletons until the fetches land. */}
          {loading ? (
            <Skeleton className="h-3 w-28" />
          ) : (
            totalCount > 0 && (
              <p className="text-xs text-[var(--color-muted)]">
                🧺 {totalCount} item{totalCount !== 1 ? 's' : ''} in pantry
              </p>
            )
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The rescue streak (#524) sits beside the theme trigger — same surface
              treatment as before, its own testid. Hidden at 0/null: nothing to
              celebrate yet, and it must never claim a streak before one exists. */}
          {streakWeeks !== null && streakWeeks > 0 && (
            <div
              className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-bold text-[var(--color-text)] shadow-sm"
              style={{ background: 'var(--color-surface)' }}
              data-testid="kitchen-streak"
            >
              🔥 {streakWeeks}
            </div>
          )}
          {/* Theme picker (#523): the trigger is a 44px circle in this row; the
              sheet it opens is unchanged. */}
          <KitchenThemePicker
            isOpen={themePickerOpen}
            onOpen={() => setThemePickerOpen(true)}
            onClose={() => setThemePickerOpen(false)}
            currentThemeKey={kitchenTheme.key}
            unlockedKeys={unlockedThemeKeys}
            balance={balance}
            onSelect={selectTheme}
            saving={themeSaving}
            error={themeError}
            clearError={clearThemeError}
            triggerClassName="relative h-11 w-11"
          />
        </div>
      </div>

      <div className="flex flex-col items-center px-4 pt-3">
        {/* One-time "new theme unlocked" card (#523) — shown at most once per
            theme per browser. "Try it" switches the wall to the new theme
            (same `selectTheme` the picker sheet uses) and dismisses; the
            plain ✕ just dismisses without switching. */}
        <KitchenThemeUnlockCard
          theme={newlyUnlocked}
          onTryIt={() => {
            if (newlyUnlocked) selectTheme(newlyUnlocked.key)
            dismissUnlock()
          }}
          onDismiss={dismissUnlock}
        />

        {/* Milestone unlock offer (#522) — mounted directly under the kitchen
            wall per the issue's placement instruction. Renders nothing when
            there's no pending offer. */}
        <UnlockOffer />

        {/* The Bubbles speech bubble stays for now; the Bubbles card (issue
            #755) replaces it. The illustrated Bubbles (#592) sits beside the
            copy, as on the board's card; the 120px hero above it went with the
            redesign. Its mood is still the #525 priority (worried, surprised,
            happy). */}
        <FadeInView delay={0.1} className="mb-6 w-full max-w-sm">
          <div
            className="relative flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-4 shadow-sm"
            style={{ background: 'var(--color-surface)' }}
            aria-busy={loading}
            data-tour="hero"
          >
            <BubblesMascot state={mascotState} size={56} />
            <div className="min-w-0 flex-1">
              {loading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-11/12" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="mt-2 h-7 w-28 rounded-full" />
                </div>
              ) : (
                <>
                  <p className="text-sm leading-relaxed font-medium text-[var(--color-text)]">
                    {heroMessage}
                  </p>
                  <Link
                    href={heroAction.href}
                    className="mt-3 inline-block rounded-full px-5 py-2 text-xs font-semibold text-white"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {heroAction.label}
                  </Link>
                </>
              )}
            </div>
          </div>
        </FadeInView>

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

      </div>

      {/* The storage sheet (#749). It steps aside, keeping its search text, while
          the edit or add sheet is on top: two sheets cannot both hold focus. */}
      <StorageSheet
        open={sheet !== null}
        suspended={editItem !== null || addPlace !== null}
        place={sheet?.place ?? 'fridge'}
        view={sheet?.view ?? 'scene'}
        items={items}
        status={pantryStatus}
        palette={kitchenTheme.wall}
        onPlaceChange={(place) => setSheet((s) => (s ? { ...s, place } : s))}
        onViewChange={(view) => setSheet((s) => (s ? { ...s, view } : s))}
        onClose={closeSheet}
        onEdit={setEditItem}
        onAdd={setAddPlace}
        onRetry={reload}
      />
      <EditItemModal
        isOpen={editItem !== null}
        onClose={() => {
          setEditItem(null)
          pantryChanged()
        }}
        editItem={editItem}
      />
      <PantryAddSheet
        isOpen={addPlace !== null}
        onClose={() => setAddPlace(null)}
        initialTab="type"
        place={addPlace ?? undefined}
        onItemsAdded={pantryChanged}
      />
    </div>
  )
}
