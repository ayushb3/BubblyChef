'use client'

/**
 * The kitchen wall (issue #748, Goal 2 of the signature PRD): the front-on
 * pixel cut-away that is the top of home. Board A, "Dollhouse wall", and the
 * "Shared pixel scene" board of the Kitchen Home canvas.
 *
 * Inline SVG, drawn in code on the board's 96 x 80 grid (`lib/kitchen/wall-art.ts`):
 * no image request, and the box is `aspect-[96/80]` from the first paint, so the
 * wall is at its final size while data loads and nothing shifts once it arrives.
 * `crispEdges` keeps every pixel hard at any scale.
 *
 * On top of the SVG, in HTML so they stay crisp and accessible:
 *  - one real `<button>` per storage place (fridge, freezer, shelves, basket)
 *    with its pixel-lettered label ("Fridge 23", Nunito numerals) and the
 *    accessible name "Fridge, 23 items, 3 to use soon";
 *  - the chalkboard on the door, a link to the plan-dinner chat flow;
 *  - `children`: the decoration slots (`KitchenScene`), which take no taps.
 *
 * Contract for later tickets (the hooks exist, nothing is built behind them):
 *  - `onOpenPlace(place)`: the storage sheet (issue #749) opens here. Until
 *    then `HeroHome` sends the tap to the existing pantry page.
 *  - `spritesLayer`: SVG nodes in wall units, painted over the room: the category
 *    sprites and the wilting items (issue #751, `sprites/KitchenSprites`). When
 *    it is given, the board's static stock (`wall-art.ts` layers) is not drawn;
 *    without it, a place that has items shows that static stock.
 *  - `tagsLayer`: HTML over the room for the wilting items' pixel-lettered tags
 *    (issue #751, `sprites/WiltTags`). Painted above Bubbles, below the place
 *    buttons, and it takes no taps.
 *  - `bubblesLayer`: SVG nodes in wall units (the pixel Bubbles and the stove's
 *    steam, `PixelBubbles`, issue #752). Painted in a second SVG of its own, on
 *    the same 96 x 80 grid, over the decorations (Bubbles walks in front of the
 *    table, not behind it) and under every place's tag and button, so it can
 *    never cover a label, and it takes no taps (`pointer-events-none`). Bubbles
 *    stays below row 58 and the tags end at row 55.2, so they never meet.
 *    `bubbles-spot.ts` and `kitchen-bubbles-spot.test.ts` hold the guarantee.
 *  - `PLACE_BOXES` anchors each place in wall units.
 *  - `onDoorTap` (issue #803): while a scan waits for put-away, the door spot where
 *    Bubbles stands with the shopping is a button (`DOOR_BOX`) that reopens it. It is
 *    the way back in once the Bubbles card was answered "Not now" and the sheet closed.
 *    It is not drawn at all without the callback, so a wall with nothing waiting has
 *    no extra tap target.
 *
 * Places with no data yet (`places === null`: loading, or the pantry failed to
 * load) show their name only and draw no stock; never a made-up zero.
 */
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { motion, useAnimationControls } from 'framer-motion'
import { useReactionVariants } from '@/lib/motion'
import { WALL_PAINT, rectsToPath, type WallLayer } from '@/lib/kitchen/wall-art'
import { WALL_H, WALL_W } from '@/lib/kitchen/slots'
import {
  PLACES,
  placeAccessibleName,
  type PlaceKey,
  type PlaceSummaries,
} from '@/lib/kitchen/places'
import type { WallPalette } from '@/lib/kitchen/themes'

/** x, y, w, h in wall units (the 96 x 80 grid). */
export type WallBox = readonly [x: number, y: number, w: number, h: number]

/**
 * The tap area of each place and its tag's origin, in wall units. A box is the
 * drawn object; its tag is a child of the button, so tapping the tag taps the
 * place even where the tag spills below the box (the shelves' does). Boxes are at
 * least 44 px a side at 390 px wide and never overlap each other
 * (`kitchen-slots.test.ts`). Tag origins are the board's
 * label positions (Main board A, 390 px wide: Fridge 16/78, Freezer 20/228,
 * Shelves 110/197, Basket 244/260, Plan dinner 299/180) converted to wall units.
 */
export const PLACE_BOXES: Record<
  PlaceKey | 'chalkboard',
  {
    box: WallBox
    tag: readonly [number, number]
    /** Anchor the tag by its right edge (`tag[0]`) so it can never run off a narrow wall. */
    anchorRight?: boolean
  }
> = {
  fridge: { box: [3.9, 4.4, 20.1, 36.6], tag: [3.94, 4.43] },
  freezer: { box: [4, 41, 20, 17], tag: [4.92, 41.36] },
  // Ends at y 33, where the basket's box starts; its tag below still taps the shelves.
  shelves: { box: [27, 21, 42, 12], tag: [27.08, 32.8] },
  // Ends at x 73.6, where the chalkboard's box begins: two tap targets never overlap.
  basket: { box: [59, 33, 14.6, 21.5], tag: [60.06, 49.2] },
  // "Plan dinner" is the widest tag and sits at the wall's right edge, so it is
  // anchored by its right edge (the board's 94.5): on a phone narrower than the
  // board it grows leftwards over the door instead of being clipped.
  chalkboard: { box: [73.6, 13, 21.4, 22.5], tag: [94.5, 29.54], anchorRight: true },
}

/**
 * The door spot's tap area (issue #803), in wall units: where the pixel Bubbles
 * stands at the door (`SPOT_X.door`, `BUBBLES_Y`, 16 x 18) with a margin round it, on
 * the floor (from row 56) so it starts below every place's box and tag (the lowest
 * ends at row 55.2). 77 x 85 px at 390 px wide, past the 44 px minimum.
 * `kitchen-pending-reentry.test.tsx` holds all of that.
 */
export const DOOR_BOX: WallBox = [76, 57, 19, 21]

/**
 * What each place draws, in wall units: the objects a decoration must never
 * cover (the fridge body, the freezer drawer and its frozen bags, the jars on
 * the shelf, the basket's fruit, the door's chalkboard). Tags are separate: see
 * `PLACE_BOXES` and `TAG_UNITS`. `kitchen-slots.test.ts` checks every decoration
 * slot against both.
 */
export const PLACE_CONTENT: Record<PlaceKey | 'chalkboard', WallBox> = {
  fridge: [4, 12, 20, 29],
  freezer: [4, 41, 20, 17],
  shelves: [27, 22, 42, 11],
  basket: [59, 33, 14, 12],
  chalkboard: [76, 13, 19, 22],
}

/** A tag is 24px tall at 13px type (5.9 units); widths are measured off board A at 390px, rounded up. */
export const TAG_UNITS = {
  h: 6,
  w: { fridge: 19, freezer: 19, shelves: 16, basket: 19, chalkboard: 22 },
} as const

const PAINT = WALL_PAINT.map(([fill, layer, rects]) => ({ fill, layer, d: rectsToPath(rects) }))

const PCT = (n: number, of: number) => `${Math.round((n / of) * 10000) / 100}%`

function boxStyle([x, y, w, h]: WallBox): CSSProperties {
  return {
    left: PCT(x, WALL_W),
    top: PCT(y, WALL_H),
    width: PCT(w, WALL_W),
    height: PCT(h, WALL_H),
  }
}

/** Where a tag sits inside its box, as a percentage of the box. */
function tagStyle(
  box: WallBox,
  { tag, anchorRight }: { tag: readonly [number, number]; anchorRight?: boolean },
): CSSProperties {
  const top = PCT(tag[1] - box[1], box[3])
  return anchorRight
    ? { right: PCT(box[0] + box[2] - tag[0], box[2]), top }
    : { left: PCT(tag[0] - box[0], box[2]), top }
}

// Focus uses the app's global `:focus-visible` ring (ink, 2px, offset 2px). The
// hover and pressed tints are the stepped feedback: no motion to turn off.
const HIT = 'absolute block cursor-pointer active:bg-white/25 hover:bg-white/15'

/** The pixel-lettered tag: the world's own type (Pixelify), Nunito numerals. */
function WallTag({
  label,
  count,
  incoming,
  bounce = 0,
  style,
}: {
  label: string
  count?: number
  /** Shopping waiting to be put away here (issue #753): reads "+N" in place of the count. */
  incoming?: number
  /**
   * Issue #754: how many items have landed here. Each rise plays the landing
   * bounce (the world's `bounce` reaction: a 2 px hop in 3 stepped frames; under
   * reduced motion it holds still and only the number changes).
   */
  bounce?: number
  style: CSSProperties
}) {
  const coming = incoming !== undefined && incoming > 0
  const { bounce: bounceVariants } = useReactionVariants()
  const controls = useAnimationControls()
  useEffect(() => {
    if (bounce > 0) void controls.start('play')
  }, [bounce, controls])
  return (
    <motion.span
      aria-hidden="true"
      data-bounces={bounce}
      variants={bounceVariants}
      initial="idle"
      animate={controls}
      style={style}
      className="font-pixel absolute border-2 border-[color:var(--color-text)] bg-[color:var(--color-surface)] px-1.5 py-0.5 text-[13px] leading-4 font-medium whitespace-nowrap text-[color:var(--color-text)] shadow-[2px_2px_0_var(--color-text)]"
    >
      {label}
      {coming ? (
        <>
          {' '}
          <span className="font-sans font-extrabold tabular-nums">+{incoming}</span>
        </>
      ) : (
        count !== undefined &&
        count > 0 && (
          <>
            {' '}
            <span className="font-sans font-extrabold tabular-nums">{count}</span>
          </>
        )
      )}
    </motion.span>
  )
}

/**
 * Where a place's sparkle pair sits while shopping is headed to it (issue #753),
 * as the centres of its two plus marks, in wall units: the board A3's marks,
 * converted from its 390 px render (4.0625 px a unit). The first is ink, the
 * second the pink accent.
 */
const SPARKLES: Record<PlaceKey, readonly [readonly [number, number], readonly [number, number]]> = {
  fridge: [[21.2, 12.3], [26.1, 13.8]],
  freezer: [[21.7, 44.3], [26.6, 45.8]],
  shelves: [[56.1, 19.7], [61, 21.2]],
  basket: [[64.5, 31.5], [69.4, 33]],
}

/** A 5 x 5 pixel plus mark centred on (cx, cy), cells of half a unit. */
function plusRects(cx: number, cy: number): string {
  return `${cx - 0.25},${cy - 1.25},0.5,2.5 ${cx - 1.25},${cy - 0.25},2.5,0.5`
}

export interface KitchenWallProps {
  palette: WallPalette
  /** `null` while the pantry is loading or failed to load: names only, no stock. */
  places: PlaceSummaries | null
  onOpenPlace: (place: PlaceKey) => void
  /** The existing plan-dinner chat link (`planDinnerHref()`). */
  planDinnerHref: string
  /** Issue #751: category sprites over the room, in wall units. Replaces the static stock. */
  spritesLayer?: ReactNode
  /** Issue #751: the wilting items' tags, HTML in percent of the wall. Takes no taps. */
  tagsLayer?: ReactNode
  /** Issue #752: pixel Bubbles and the stove's steam, in wall units, over the decorations. */
  bubblesLayer?: ReactNode
  /**
   * What the scene looks like, for assistive tech (issue #752: where Bubbles is,
   * since the sprite is decorative). Makes the wall a labelled group around its
   * buttons, which stay individually named and reachable.
   */
  sceneLabel?: string
  /**
   * Shopping waiting to be put away, per place (issue #753, board A3): a place
   * with N > 0 reads "<Place> +N" on its tag, with a sparkle pair beside it.
   * `null` / `undefined`: nothing waiting, the tags show their counts.
   */
  incoming?: Record<PlaceKey, number> | null
  /**
   * The put-away flight's landings (issue #754): items landed so far per place.
   * Each rise plays that place's tag bounce. Pass the same record as `incoming`
   * while the flight runs, so the tag ticks up (+1, +2, ...) as each lands.
   */
  bounce?: Record<PlaceKey, number> | null
  /**
   * Issue #803: a scan is waiting to be put away, and tapping the door spot (where
   * Bubbles stands with the shopping) reopens it. Without it there is no door
   * button at all.
   */
  onDoorTap?: () => void
  /** The decoration slots. Absolutely positioned, in percent of the wall. */
  children?: ReactNode
}

export default function KitchenWall({
  palette,
  places,
  onOpenPlace,
  planDinnerHref,
  spritesLayer,
  tagsLayer,
  bubblesLayer,
  sceneLabel,
  incoming = null,
  bounce = null,
  onDoorTap,
  children,
}: KitchenWallProps) {
  const vars = {
    '--wall-base': palette.base,
    '--wall-stripe': palette.stripe,
    '--wall-trim': palette.trim,
    '--wall-ink': palette.ink,
    '--wall-soft': palette.soft,
    '--wall-appliance': palette.appliance,
    '--wall-appliance-dark': palette.applianceDark,
    '--wall-floor': palette.floor,
    '--wall-floor-tile': palette.floorTile,
    '--wall-glass': palette.glass,
  } as CSSProperties

  // A place's stock is drawn only when it has items; the herb pot (a plant
  // on the sill) comes with the first item, so an empty first-visit kitchen is
  // the board's empty state (A5). The board's static stock (milk and cheese, the
  // jars, the apples) only stands in until the real sprites are supplied (#751).
  const drawsOwnStock = spritesLayer != null
  const visible = useMemo(() => {
    const on = new Set<WallLayer>(['base'])
    if (places) {
      if (!drawsOwnStock) {
        if (places.fridge.count > 0) on.add('fridge')
        if (places.freezer.count > 0) on.add('freezer')
        if (places.shelves.count > 0) on.add('shelves')
        if (places.basket.count > 0) on.add('basket')
      }
      if (PLACES.some((p) => places[p.key].count > 0)) on.add('herbs')
    }
    return on
  }, [places, drawsOwnStock])

  return (
    <div
      className="@container relative aspect-[96/80] w-full overflow-hidden"
      style={vars}
      data-testid="kitchen-wall"
      role={sceneLabel ? 'group' : undefined}
      aria-label={sceneLabel}
    >
      <svg
        viewBox={`0 0 ${WALL_W} ${WALL_H}`}
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0 block h-full w-full"
      >
        {PAINT.map((p, i) =>
          visible.has(p.layer) ? <path key={i} d={p.d} style={{ fill: p.fill }} /> : null,
        )}
        {spritesLayer}
        {/* Shopping on its way (#753): a sparkle pair by each place it is headed to. */}
        {incoming &&
          PLACES.filter((p) => incoming[p.key] > 0).map((p) => (
            <g key={p.key} data-testid="incoming-sparkles" data-place={p.key}>
              <path d={rectsToPath(plusRects(...SPARKLES[p.key][0]))} style={{ fill: 'var(--color-text)' }} />
              <path
                d={rectsToPath(plusRects(...SPARKLES[p.key][1]))}
                style={{ fill: 'var(--color-primary-dark)' }}
              />
            </g>
          ))}
      </svg>

      {/* Decorations sit under the places, so a tag is never covered. */}
      {children}

      {/* Bubbles (#752): over the decorations, under the places. */}
      {bubblesLayer && (
        <svg
          viewBox={`0 0 ${WALL_W} ${WALL_H}`}
          preserveAspectRatio="xMidYMid slice"
          shapeRendering="crispEdges"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute inset-0 block h-full w-full"
        >
          {bubblesLayer}
        </svg>
      )}

      {/* The wilting tags (#751): over Bubbles, so a tag is never covered. */}
      {tagsLayer}

      {PLACES.map((p) => {
        const { box } = PLACE_BOXES[p.key]
        const summary = places ? places[p.key] : null
        const coming = incoming?.[p.key] ?? 0
        const name = placeAccessibleName(p.label, summary)
        return (
          <button
            key={p.key}
            type="button"
            data-place={p.key}
            // The onboarding tour's pantry step points at the fridge (#750).
            data-tour={p.key === 'fridge' ? 'fridge' : undefined}
            aria-label={coming > 0 ? `${name}, ${coming} coming in` : name}
            onClick={() => onOpenPlace(p.key)}
            className={HIT}
            style={boxStyle(box)}
          >
            <WallTag
              label={p.label}
              count={summary?.count}
              incoming={coming}
              bounce={bounce?.[p.key] ?? 0}
              style={tagStyle(box, PLACE_BOXES[p.key])}
            />
          </button>
        )
      })}

      {onDoorTap && (
        <button
          type="button"
          data-testid="kitchen-door"
          aria-label="Put the shopping away"
          onClick={onDoorTap}
          className={HIT}
          style={boxStyle(DOOR_BOX)}
        />
      )}

      <Link
        href={planDinnerHref}
        aria-label="Plan dinner"
        data-testid="kitchen-chalkboard"
        className={HIT}
        style={boxStyle(PLACE_BOXES.chalkboard.box)}
      >
        <WallTag
          label="Plan dinner"
          style={tagStyle(PLACE_BOXES.chalkboard.box, PLACE_BOXES.chalkboard)}
        />
      </Link>
    </div>
  )
}
