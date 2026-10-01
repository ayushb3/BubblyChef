/**
 * A place's mini sprite (issues #749, #794): a crop of the kitchen wall around the
 * fridge, freezer drawer, shelves or basket, for the storage sheet's header.
 * Drawn from the same paint list as the wall (`wall-art.ts`), so it is always
 * the place as the wall draws it, in the active kitchen theme's colours.
 *
 * What stands in the place is what the wall draws there, from the same source:
 * `kitchenStock` picks the sprites, `layoutStock` positions them and
 * `KitchenSprites` draws them (wilting items at their held, drooped pose).
 * Like the wall, the room's static stock is never drawn: an empty place is the
 * empty room, and a `stock` of `null` (the pantry is still loading) is the empty
 * room too, never a made-up fridge full of milk.
 *
 * Decorative: the sheet's title names the place.
 */
import { useMemo } from 'react'
import { WALL_PAINT, rectsToPath } from '@/lib/kitchen/wall-art'
import type { KitchenStock, PlaceKey } from '@/lib/kitchen/places'
import { layoutStock } from '@/lib/kitchen/sprite-layout'
import type { WallPalette } from '@/lib/kitchen/themes'
import { wallPaletteVars } from '@/lib/kitchen/wall-vars'
import { KitchenSprites } from '@/components/kitchen/sprites/KitchenSprites'

/**
 * The crop of the 96 x 80 wall each place is drawn in. Each holds every slot the
 * place can fill (`PLACE_SLOTS`), so every sprite the wall draws there shows.
 */
const VIEW: Record<PlaceKey, string> = {
  // The board's header thumbnail: the whole fridge with its freezer drawer.
  fridge: '4 12 20 46',
  freezer: '4 41 20 17',
  // Wide enough for all six jars on the plank.
  shelves: '26 16 44 24',
  basket: '57 31 20 17',
}

/** The room alone: the board's static stock is the wall's stand-in, not what is in the place. */
const ROOM = WALL_PAINT.filter(([, layer]) => layer === 'base').map(([fill, , rects]) => ({
  fill,
  d: rectsToPath(rects),
}))

export default function PlaceSprite({
  place,
  palette,
  stock = null,
  className = 'h-full w-full',
}: {
  place: PlaceKey
  palette: WallPalette
  /** What the wall draws in each place (`kitchenStock`); `null` while the pantry is unknown. */
  stock?: KitchenStock | null
  className?: string
}) {
  const sprites = useMemo(
    () => (stock ? layoutStock(stock).sprites.filter((s) => s.place === place) : []),
    [stock, place],
  )
  return (
    <svg
      viewBox={VIEW[place]}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      data-testid="place-sprite"
      data-place={place}
      className={`block overflow-hidden ${className}`}
      style={wallPaletteVars(palette)}
    >
      {ROOM.map((p, i) => (
        <path key={i} d={p.d} style={{ fill: p.fill }} />
      ))}
      {sprites.length > 0 && <KitchenSprites sprites={sprites} still />}
    </svg>
  )
}
