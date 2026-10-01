/**
 * A place's mini sprite (issue #749): a crop of the kitchen wall around the
 * fridge, freezer drawer, shelves or basket, for the storage sheet's header.
 * Drawn from the same paint list as the wall (`wall-art.ts`), so it is always
 * the place as the wall draws it, in the active kitchen theme's colours.
 *
 * Decorative: the sheet's title names the place.
 */
import { WALL_PAINT, rectsToPath, type WallLayer } from '@/lib/kitchen/wall-art'
import type { PlaceKey } from '@/lib/kitchen/places'
import type { WallPalette } from '@/lib/kitchen/themes'
import { wallPaletteVars } from '@/lib/kitchen/wall-vars'

/** The crop of the 96 x 80 wall, and the stock layers drawn in it (the room is always drawn). */
const CROP: Record<PlaceKey, { view: string; layers: readonly WallLayer[] }> = {
  // The board's header thumbnail: the whole fridge with its freezer drawer.
  fridge: { view: '4 12 20 46', layers: ['fridge', 'freezer'] },
  freezer: { view: '4 41 20 17', layers: ['freezer'] },
  shelves: { view: '30 16 34 24', layers: ['shelves'] },
  basket: { view: '57 31 20 17', layers: ['basket'] },
}

const PATHS = Object.fromEntries(
  (Object.keys(CROP) as PlaceKey[]).map((key) => {
    const on = new Set<WallLayer>(['base', ...CROP[key].layers])
    return [
      key,
      WALL_PAINT.filter(([, layer]) => on.has(layer)).map(([fill, , rects]) => ({
        fill,
        d: rectsToPath(rects),
      })),
    ]
  }),
) as Record<PlaceKey, { fill: string; d: string }[]>

export default function PlaceSprite({
  place,
  palette,
  className = 'h-full w-full',
}: {
  place: PlaceKey
  palette: WallPalette
  className?: string
}) {
  return (
    <svg
      viewBox={CROP[place].view}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      data-testid="place-sprite"
      data-place={place}
      className={`block overflow-hidden ${className}`}
      style={wallPaletteVars(palette)}
    >
      {PATHS[place].map((p, i) => (
        <path key={i} d={p.d} style={{ fill: p.fill }} />
      ))}
    </svg>
  )
}
