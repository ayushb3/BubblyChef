'use client'

/**
 * Home-screen kitchen scene (issue #521; redrawn as the pixel wall in #748).
 *
 * The wall itself (the SVG room, the storage places and the chalkboard) is
 * `KitchenWall`. This component keeps what #521 and #523 built and carries it
 * over unchanged: the 12 fixed decoration slots (`lib/kitchen/slots.ts`) and the
 * theme. Only the drawing and the slot positions moved.
 *
 * Each slot shows the matched unlocked decoration's art, an `<img>` at
 * `Decoration.art` when the catalog entry has one, else its `emoji` (from
 * `lib/kitchen/catalog.ts`), or nothing when empty. (The dashed placeholder
 * outlines went with the old flat scene: on the wall, twelve empty boxes would
 * read as clutter. Since issue #751 every catalog entry has pixel art through
 * that `art` field, and the emoji stays as the fallback for an entry whose art
 * is removed.) The wall box always renders at its final size, loading or not,
 * so nothing shifts once data arrives. The category sprites and wilting items
 * (`stock`, issue #751) are drawn by `sprites/KitchenSprites`.
 *
 * `unlocked` rows are looked up by `id` against `CATALOG` and by `slot` against
 * `SLOTS`; a row that matches neither is dropped silently (a stale or renamed
 * catalog entry must never crash the dashboard).
 *
 * `theme` (#523) recolours the wall's palette only. Decorations render
 * identically whatever the theme, which is the point: placed decorations "stay
 * exactly where they are" when the theme changes. With the wall drawn from
 * `--wall-*` custom properties, a theme change is one repaint (no crossfade: the
 * world is stepped, and `prefers-reduced-motion` has nothing to turn off).
 *
 * The streak left the scene with the redesign (it is in the toolbar). The bubbles
 * balance left for the header in #748 and came back in #907: it is the scene's
 * HUD, the pixel counter in the wall's top-right corner (`KitchenBalance`, drawn by
 * `KitchenWall`'s `hud` slot).
 */
import Image from 'next/image'
import type { ReactNode } from 'react'
import { SLOTS } from '@/lib/kitchen/slots'
import { CATALOG, type Decoration } from '@/lib/kitchen/catalog'
import { getDefaultKitchenTheme, type KitchenTheme } from '@/lib/kitchen/themes'
import type { KitchenStock, PlaceKey, PlaceSummaries } from '@/lib/kitchen/places'
import { layoutStock } from '@/lib/kitchen/sprite-layout'
import { planDinnerHref as defaultPlanDinnerHref } from '@/lib/chat-seed'
import KitchenWall from '@/components/kitchen/KitchenWall'
import KitchenBalance from '@/components/kitchen/KitchenBalance'
import { KitchenSprites, WiltTags } from '@/components/kitchen/sprites/KitchenSprites'

export interface UnlockedDecoration {
  id: string
  slot: string
}

export interface KitchenSceneProps {
  unlocked: UnlockedDecoration[]
  loading?: boolean
  /** Defaults to `pastel` — every existing caller that predates #523 keeps rendering unchanged. */
  theme?: KitchenTheme
  /** Per-place counts; `null` while the pantry loads or failed (names only, no stock). */
  places?: PlaceSummaries | null
  /** A place was tapped. The storage sheet (issue #749) opens from here. */
  onOpenPlace: (place: PlaceKey) => void
  /** Defaults to the existing plan-dinner chat link. */
  planDinnerHref?: string
  /**
   * What each place draws (issue #751): its category sprites and up to 3 wilting
   * items, from `kitchenStock`. `null` or unset while the pantry is unknown.
   */
  stock?: KitchenStock | null
  /**
   * The bubbles balance, drawn as the HUD counter in the wall's top-right corner
   * (issue #907). `null` or unset while it is unknown (loading or failed): no
   * counter, never a made-up `0`.
   */
  balance?: number | null
  /** Hooks for issues #751 and #752; see `KitchenWall`. A given `spritesLayer` wins over `stock`. */
  spritesLayer?: ReactNode
  bubblesLayer?: ReactNode
  /** The scene's accessible label; describes where Bubbles is. See `KitchenWall`. */
  sceneLabel?: string
  /** Shopping waiting to be put away, per place: the tags read +N (issue #753). See `KitchenWall`. */
  incoming?: Record<PlaceKey, number> | null
  /** The put-away flight's landings per place: each rise bounces that tag (issue #754). See `KitchenWall`. */
  bounce?: Record<PlaceKey, number> | null
  /** A scan waits for put-away: tapping the door reopens it (issue #803). See `KitchenWall`. */
  onDoorTap?: () => void
}

const CATALOG_BY_ID = new Map(CATALOG.map((d) => [d.id, d]))
const VALID_SLOT_KEYS = new Set(SLOTS.map((s) => s.key))

// 1 wall unit = 1/96 of the wall's width = (100/96) cqw (the wall is a
// container). An emoji is sized to ~90% of its slot's shorter side, so a small
// slot gets a small emoji instead of overflowing onto a neighbour.
const CQW_PER_PCT_W = 1
const CQW_PER_PCT_H = 80 / 96

export default function KitchenScene({
  unlocked,
  loading = false,
  theme = getDefaultKitchenTheme(),
  places = null,
  onOpenPlace,
  planDinnerHref = defaultPlanDinnerHref(),
  stock = null,
  balance = null,
  spritesLayer,
  bubblesLayer,
  sceneLabel,
  incoming = null,
  bounce = null,
  onDoorTap,
}: KitchenSceneProps) {
  // The sprites and the wilting tags, positioned on the wall (#751). `null`
  // stock (loading, or the pantry failed) draws none: never a made-up empty.
  const placed = stock ? layoutStock(stock) : null
  // Build slot -> decoration lookup from the rows that actually resolve. A row
  // whose id isn't in the catalog, or whose slot isn't one of SLOTS', is
  // dropped here rather than thrown on — the source data (a decorations
  // table row) can drift ahead of the frontend's catalog.
  const decorationBySlot = new Map<string, Decoration>()
  if (!loading) {
    for (const row of unlocked) {
      if (!VALID_SLOT_KEYS.has(row.slot)) continue
      const decoration = CATALOG_BY_ID.get(row.id)
      if (!decoration) continue
      if (decoration.slot !== row.slot) continue
      decorationBySlot.set(row.slot, decoration)
    }
  }

  return (
    <div
      className="w-full max-w-[480px] border-y-[3px] border-[color:var(--color-text)]"
      data-testid="kitchen-scene"
      data-kitchen-theme={theme.key}
    >
      <KitchenWall
        palette={theme.wall}
        places={places}
        onOpenPlace={onOpenPlace}
        planDinnerHref={planDinnerHref}
        spritesLayer={spritesLayer ?? (placed ? <KitchenSprites sprites={placed.sprites} /> : undefined)}
        tagsLayer={placed ? <WiltTags tags={placed.tags} /> : undefined}
        bubblesLayer={bubblesLayer}
        sceneLabel={sceneLabel}
        incoming={incoming}
        bounce={bounce}
        onDoorTap={onDoorTap}
        hud={balance !== null ? <KitchenBalance value={balance} /> : undefined}
      >
        {SLOTS.map((slot) => {
          const decoration = decorationBySlot.get(slot.key)
          if (!decoration) {
            // Empty slots are not drawn: nothing for a screen reader to
            // announce and nothing to see. The marker keeps the 12 slots
            // addressable (tests, and the sprite ticket's anchors).
            return (
              <div
                key={slot.key}
                data-testid={`kitchen-slot-${slot.key}`}
                data-filled="false"
                aria-hidden="true"
                className="pointer-events-none absolute"
                style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
              />
            )
          }
          const fontSize = `${
            Math.round(Math.min(slot.w * CQW_PER_PCT_W, slot.h * CQW_PER_PCT_H) * 90) / 100
          }cqw`
          return (
            <div
              key={slot.key}
              data-testid={`kitchen-slot-${slot.key}`}
              data-filled="true"
              // The accessible name lives on the content node below (the
              // <img>'s alt or the emoji's role="img"), under the
              // decoration's own name, not the slot's. Decorations take no
              // taps, so a place under one stays tappable.
              className="pointer-events-none absolute flex items-center justify-center"
              style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
            >
              {decoration.art ? (
                <Image
                  src={decoration.art}
                  alt={decoration.name}
                  fill
                  sizes="120px"
                  // Pixel art stays hard-edged at any size, bought raster art included.
                  className="object-contain [image-rendering:pixelated]"
                />
              ) : (
                <span className="leading-none" style={{ fontSize }} role="img" aria-label={decoration.name}>
                  {decoration.emoji}
                </span>
              )}
            </div>
          )
        })}
      </KitchenWall>
    </div>
  )
}
