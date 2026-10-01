'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { planDinnerHref } from '@/lib/chat-seed'
import { kitchenEyebrow } from '@/lib/kitchen/eyebrow'
import {
  PLACE_KEYS,
  kitchenStock,
  placeLocation,
  type ExpiryFacet,
  summarizePlaces,
  type KitchenStock,
  type PlaceKey,
  type PlaceSummaries,
} from '@/lib/kitchen/places'
import { movePantryItems, resolvePantryItems } from '@/lib/api/pantry'
import { addPantryItemToMyGroceryList } from '@/lib/grocery-add'
import { fetchDashboardDaily } from '@/lib/api/dashboard'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'
import { useDecorations } from '@/lib/api/kitchen'
import { useBubbles } from '@/lib/api/bubbles'
import KitchenScene from '@/components/kitchen/KitchenScene'
import StorageSheet, { isStorageView, type StorageView } from '@/components/kitchen/StorageSheet'
import EditItemModal from '@/components/pantry/AddItemModal'
import PantryAddSheet, { type PantryAddTab } from '@/components/pantry/PantryAddSheet'
import PixelBubbles from '@/components/kitchen/PixelBubbles'
import { sceneLabel } from '@/lib/kitchen/bubbles-spot'
import { useBubblesSpot } from '@/hooks/useBubblesSpot'
import PutAwaySheet from '@/components/kitchen/PutAwaySheet'
import PutAwayFlight, { type PutAwayHop } from '@/components/kitchen/PutAwayFlight'
import { usePendingPutAway } from '@/hooks/usePendingPutAway'
import { incomingByPlace } from '@/lib/kitchen/pending-putaway'
import HomeCardSlot from '@/components/kitchen/HomeCardSlot'
import type { ExpiringItem } from '@/lib/kitchen/home-card'
import { DEFAULT_EXPIRY_PRIORITY, type ExpiryPriority } from '@/lib/expiry-priority'
import KitchenHeader from '@/components/kitchen/KitchenHeader'
import KitchenThemePicker from '@/components/kitchen/KitchenThemePicker'
import KitchenThemeUnlockCard from '@/components/kitchen/KitchenThemeUnlockCard'
import { useKitchenTheme } from '@/hooks/useKitchenTheme'

interface HomeData {
  totalCount: number
  /** Food that expires within three days, for the Bubbles card (#755). */
  expiring: ExpiringItem[]
  /** Today's tip from the daily-tip endpoint; `null` when it could not be reached. */
  tip: string | null
  /** True when the pantry has an expired item that hasn't been used up (issue #525). */
  hasUnusedExpired: boolean
  /** Per-place counts for the wall; `null` until the pantry loads, and if it fails to. */
  places: PlaceSummaries | null
  /** What each place draws (category sprites and up to 3 wilting items); `null` like `places`. */
  stock: KitchenStock | null
  /** Every pantry row, for the storage sheet; `null` until the pantry loads, and if it fails to. */
  items: EnrichedPantryItem[] | null
}

interface HeroHomeProps {
  /**
   * No longer shown: the greeting went with the kitchen redesign (#748). Kept so
   * the page and its callers keep their signature.
   */
  displayName?: string
  /** `user_metadata.kitchen_theme` as read server-side (#523), or `null` if never set. */
  initialKitchenTheme?: string | null
  /**
   * `user_profiles.expiry_priority` as read server-side (#502, #755): Off skips the
   * Bubbles card's "food expires today" case. Gentle when never set.
   */
  initialExpiryPriority?: ExpiryPriority
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

export default function HeroHome({
  initialKitchenTheme = null,
  initialExpiryPriority = DEFAULT_EXPIRY_PRIORITY,
}: HeroHomeProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<HomeData>({
    totalCount: 0,
    expiring: [],
    tip: null,
    hasUnusedExpired: false,
    places: null,
    stock: null,
    items: null,
  })

  // After a successful put-away (#754) the items hop from the sheet to their
  // places. While they do, the tags read the running +N (`landed`, ticking up as
  // each lands) and the real counts are held back: they are re-read when it ends.
  const [flightHops, setFlightHops] = useState<PutAwayHop[] | null>(null)
  const [landed, setLanded] = useState<Record<PlaceKey, number> | null>(null)

  // The pantry, dashboard and expiring reads. `reload` runs it again behind an
  // open sheet (an edit or an add changed the rows): the skeletons are the first
  // load's only, so the home does not flash while the counts catch up.
  const [reloadTick, setReloadTick] = useState(0)
  // Set when the flight ends: the next read drops the running +N (see `fetchAll`).
  const settleLanded = useRef(false)
  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [pantryRes, expiringRes, dashboardDaily] = await Promise.all([
          fetch('/api/pantry'),
          fetch('/api/pantry/expiring?days=3'),
          // The daily tip (the card's quiet moment). A failure here degrades to the
          // card's own fallback tips: it must never take down the rest of home.
          fetchDashboardDaily().catch(() => null),
        ])
        const [pantryData, expiringData] = await Promise.all([
          pantryRes.ok ? pantryRes.json() : { items: [], total_count: 0 },
          expiringRes.ok ? expiringRes.json() : { items: [], count: 0 },
        ])

        const allItems: EnrichedPantryItem[] = pantryData.items ?? []
        const expiringItems: EnrichedPantryItem[] = expiringData.items ?? []

        // Days until expiry goes negative once an item is past its date, and the
        // card only speaks for food that is still good (today or tomorrow, which
        // the picker narrows to): an expired item is surfaced on /pantry with an
        // "Expired" badge and gets no cook-this-now nudge (#146).
        const expiring: ExpiringItem[] = expiringItems
          .filter((item) => item.days_until_expiry !== null && item.days_until_expiry >= 0)
          .map((item) => ({
            name: item.name,
            daysUntil: item.days_until_expiry as number,
            expiryDate: item.expiry_date ?? null,
          }))

        // #525 — Bubbles goes "worried" when there's expired food sitting
        // unused (still has quantity) rather than already used up or cleared.
        const hasUnusedExpired = allItems.some((item) => item.is_expired && item.quantity > 0)

        setData({
          totalCount: pantryData.total_count ?? allItems.length,
          expiring,
          tip: dashboardDaily?.tip?.text ?? null,
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
        // The put-away flight is over and its counts are now re-read (#754):
        // only now do the tags drop the running +N for the real counts, so they
        // never flash the old numbers in between.
        if (settleLanded.current) {
          settleLanded.current = false
          setLanded(null)
        }
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

  const eyebrow = clockReady ? kitchenEyebrow(new Date()) : ''
  const {
    totalCount,
    expiring,
    tip,
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
  // home mounts with one pending (a reload) and whenever a new scan is saved,
  // from wherever it was scanned (the add sheet saves it and closes itself, so no
  // mount point can forget the hand-off). Edits keep `savedAt`, so they never
  // reopen a sheet the user closed.
  const pending = usePendingPutAway()
  const incoming = landed ?? (pending ? incomingByPlace(pending) : null)
  const [putAwayOpen, setPutAwayOpen] = useState(false)
  const putAwayOfferedAt = useRef<string | null>(null)
  const pendingSavedAt = pending?.savedAt ?? null
  useEffect(() => {
    if (pendingSavedAt && pendingSavedAt !== putAwayOfferedAt.current) {
      putAwayOfferedAt.current = pendingSavedAt
      setPutAwayOpen(true)
    } else if (!pendingSavedAt) {
      putAwayOfferedAt.current = null
      setPutAwayOpen(false)
    }
  }, [pendingSavedAt])

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

  // Storage sheet (issue #749): tapping a place opens it on that place. The
  // `?place=fridge&view=scene|list` deep link opens it directly, on load or when
  // the URL changes under a mounted home. `&expiry=expiring,expired` starts the
  // List with the expiry filter on (#750: where the old /pantry/use-soon lands).
  // `?add=scan|type` opens the add sheet on that tab (#750: where the old
  // /pantry?add= lands).
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [sheet, setSheet] = useState<{
    place: PlaceKey
    view: StorageView
    expiry?: ExpiryFacet[]
  } | null>(null)
  const [editItem, setEditItem] = useState<EnrichedPantryItem | null>(null)
  const [addSheet, setAddSheet] = useState<{ tab: PantryAddTab; place?: PlaceKey } | null>(null)
  const linkedPlace = searchParams.get('place')
  const linkedView = searchParams.get('view')
  const linkedExpiry = searchParams.get('expiry')
  const linkedAdd = searchParams.get('add')
  useEffect(() => {
    if (!PLACE_KEYS.includes(linkedPlace as PlaceKey)) return
    // The URL is an external system being synced into React, which is what an
    // effect is for. It cannot be derived state: the user closes the sheet, and
    // once opened its visibility belongs to the component, not the param.
    setSheet({
      place: linkedPlace as PlaceKey,
      view: isStorageView(linkedView) ? linkedView : 'scene',
      expiry: (linkedExpiry ?? '')
        .split(',')
        .filter((v): v is ExpiryFacet => v === 'expiring' || v === 'expired'),
    })
  }, [linkedPlace, linkedView, linkedExpiry])
  useEffect(() => {
    if (linkedAdd !== 'scan' && linkedAdd !== 'type') return
    // Same: the address is the cause, and the sheet is closable afterwards.
    setAddSheet({ tab: linkedAdd })
  }, [linkedAdd])

  // Issue #803: with a scan pending, a tag reading +N is the shopping waiting there,
  // and tapping it reopens put-away: the way back in after the card was answered
  // "Not now" and the sheet closed. A place with nothing coming opens its storage sheet.
  const openPlace = (place: PlaceKey) => {
    if (pending && incomingByPlace(pending)[place] > 0) setPutAwayOpen(true)
    else setSheet({ place, view: 'scene' })
  }

  const closeSheet = () => {
    setSheet(null)
    // A deep-linked visit must not reopen on refresh.
    if (linkedPlace || linkedView || linkedExpiry) router.replace('/', { scroll: false })
  }
  const closeAddSheet = () => {
    setAddSheet(null)
    if (linkedAdd) router.replace('/', { scroll: false })
  }

  // The pantry changed behind the sheet: re-read the home's own copy, and mark
  // the pantry page's cache and the Bubbles balance (an add earns) stale.
  const pantryChanged = () => {
    reload()
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
    queryClient.invalidateQueries({ queryKey: ['bubbles'] })
  }

  // The List's bulk edits and per-row resolves: the existing per-item endpoints,
  // one item at a time. The rows are re-read when anything went through.
  const movePantry = async (ids: string[], place: PlaceKey) => {
    const result = await movePantryItems(ids, placeLocation(place))
    if (result.done.length > 0) pantryChanged()
    return result
  }
  const resolvePantry = async (ids: string[], outcome: 'used' | 'tossed') => {
    const result = await resolvePantryItems(ids, outcome)
    if (result.done.length > 0) pantryChanged()
    return result
  }

  const pantryStatus = loading ? 'loading' : items ? 'ready' : 'error'

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col">
      {/* Header (#748): eyebrow, title, the pixel bubbles counter. */}
      <KitchenHeader eyebrow={eyebrow} balance={balance} />

      {/* The kitchen: the pixel wall (#748) with the 12 decoration slots
          (#521) and the four storage places. Full-bleed, at the board's 96:80
          proportion from first paint, so nothing shifts once data lands. */}
      <div data-tour="hero">
      <KitchenScene
        unlocked={unlocked}
        loading={decorationsLoading}
        theme={kitchenTheme}
        places={places}
        stock={stock}
        onOpenPlace={openPlace}
        planDinnerHref={planDinnerHref()}
        bubblesLayer={<PixelBubbles spot={bubblesSpot} cooking={cooking} />}
        sceneLabel={sceneLabel(bubblesSpot, cooking)}
        incoming={incoming}
        bounce={landed}
        onDoorTap={pending ? () => setPutAwayOpen(true) : undefined}
      />
      </div>

      <PutAwaySheet
        open={putAwayOpen}
        record={pending}
        onClose={() => setPutAwayOpen(false)}
        onTryAnother={() => {
          // Not a receipt (#856): the scan is dropped; back to the scan tab for another photo.
          setPutAwayOpen(false)
          setAddSheet({ tab: 'scan' })
        }}
        onPutAway={(_count, hops) => {
          // The write succeeded: play the hop into place, then refresh the counts.
          setLanded(null)
          setFlightHops(hops)
        }}
      />
      {flightHops && (
        <PutAwayFlight
          hops={flightHops}
          onLanded={setLanded}
          onDone={() => {
            // Re-read the counts; the +N stays until they are in (see `fetchAll`).
            settleLanded.current = true
            setFlightHops(null)
            pantryChanged()
          }}
        />
      )}

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

      {/* One-time "new theme unlocked" card (#523) — shown at most once per theme
          per browser. "Try it" switches the wall to the new theme (same
          `selectTheme` the picker sheet uses) and dismisses; the plain ✕ just
          dismisses without switching. */}
      <div className="flex flex-col items-center px-4 pt-3 empty:hidden">
        <KitchenThemeUnlockCard
          theme={newlyUnlocked}
          onTryIt={() => {
            if (newlyUnlocked) selectTheme(newlyUnlocked.key)
            dismissUnlock()
          }}
          onDismiss={dismissUnlock}
        />
      </div>

      {/* The Bubbles card (#755): the one thing Bubbles has to say right now, or
          the milestone unlock offer (#522) in its place while one is pending. */}
      <HomeCardSlot
        loaded={!loading}
        pantryCount={items ? totalCount : null}
        expiring={expiring}
        expiryPriority={initialExpiryPriority}
        tip={tip}
        pending={pending}
        hasUnusedExpired={hasUnusedExpired}
        onPutAway={() => setPutAwayOpen(true)}
      />

      {/* The storage sheet (#749). It steps aside, keeping its search text, while
          the edit or add sheet is on top: two sheets cannot both hold focus. */}
      <StorageSheet
        open={sheet !== null}
        suspended={editItem !== null || addSheet !== null}
        place={sheet?.place ?? 'fridge'}
        view={sheet?.view ?? 'scene'}
        initialExpiry={sheet?.expiry}
        items={items}
        status={pantryStatus}
        palette={kitchenTheme.wall}
        onPlaceChange={(place) => setSheet((s) => (s ? { ...s, place } : s))}
        onViewChange={(view) => setSheet((s) => (s ? { ...s, view } : s))}
        onClose={closeSheet}
        onEdit={setEditItem}
        onAdd={(place) => setAddSheet({ tab: 'type', place })}
        onMove={movePantry}
        onResolve={resolvePantry}
        onAddToList={addPantryItemToMyGroceryList}
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
        isOpen={addSheet !== null}
        onClose={closeAddSheet}
        initialTab={addSheet?.tab ?? 'type'}
        place={addSheet?.place}
        onItemsAdded={pantryChanged}
      />
    </div>
  )
}
