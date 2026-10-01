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
 *  - `spritesLayer`: SVG nodes in wall units, painted over the room (category
 *    sprites and the wilting items, issue #751). Until it lands, a place that
 *    has items shows the board's static stock instead (`wall-art.ts` layers).
 *  - `bubblesLayer`: SVG nodes in wall units, painted last, over everything
 *    (the pixel Bubbles and the stove's steam, issue #752).
 *  - `PLACE_BOXES` anchors each place in wall units.
 *
 * Places with no data yet (`places === null`: loading, or the pantry failed to
 * load) show their name only and draw no stock; never a made-up zero.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
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
function WallTag({ label, count, style }: { label: string; count?: number; style: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className="font-pixel absolute border-2 border-[color:var(--color-text)] bg-[color:var(--color-surface)] px-1.5 py-0.5 text-[13px] leading-4 font-medium whitespace-nowrap text-[color:var(--color-text)] shadow-[2px_2px_0_var(--color-text)]"
    >
      {label}
      {count !== undefined && count > 0 && (
        <>
          {' '}
          <span className="font-sans font-extrabold tabular-nums">{count}</span>
        </>
      )}
    </span>
  )
}

export interface KitchenWallProps {
  palette: WallPalette
  /** `null` while the pantry is loading or failed to load: names only, no stock. */
  places: PlaceSummaries | null
  onOpenPlace: (place: PlaceKey) => void
  /** The existing plan-dinner chat link (`planDinnerHref()`). */
  planDinnerHref: string
  /** Issue #751: category sprites over the room, in wall units. */
  spritesLayer?: ReactNode
  /** Issue #752: pixel Bubbles and the stove's steam, in wall units. */
  bubblesLayer?: ReactNode
  /** The decoration slots. Absolutely positioned, in percent of the wall. */
  children?: ReactNode
}

export default function KitchenWall({
  palette,
  places,
  onOpenPlace,
  planDinnerHref,
  spritesLayer,
  bubblesLayer,
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
  // the board's empty state (A5).
  const visible = useMemo(() => {
    const on = new Set<WallLayer>(['base'])
    if (places) {
      if (places.fridge.count > 0) on.add('fridge')
      if (places.freezer.count > 0) on.add('freezer')
      if (places.shelves.count > 0) on.add('shelves')
      if (places.basket.count > 0) on.add('basket')
      if (PLACES.some((p) => places[p.key].count > 0)) on.add('herbs')
    }
    return on
  }, [places])

  return (
    <div
      className="@container relative aspect-[96/80] w-full overflow-hidden"
      style={vars}
      data-testid="kitchen-wall"
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
        {bubblesLayer}
      </svg>

      {/* Decorations sit under the places, so a tag is never covered. */}
      {children}

      {PLACES.map((p) => {
        const { box } = PLACE_BOXES[p.key]
        const summary = places ? places[p.key] : null
        return (
          <button
            key={p.key}
            type="button"
            data-place={p.key}
            aria-label={placeAccessibleName(p.label, summary)}
            onClick={() => onOpenPlace(p.key)}
            className={HIT}
            style={boxStyle(box)}
          >
            <WallTag label={p.label} count={summary?.count} style={tagStyle(box, PLACE_BOXES[p.key])} />
          </button>
        )
      })}

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
