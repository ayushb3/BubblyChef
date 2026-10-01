/**
 * A wall palette as the CSS custom properties the pixel scene is drawn with
 * (`--wall-*`, see `wall-art.ts`). `KitchenWall` sets them on the wall; anything
 * that draws a piece of the wall outside it (the storage sheet's place thumbnail,
 * issue #749) sets the same ones on its own element.
 */
import type { CSSProperties } from 'react'
import type { WallPalette } from '@/lib/kitchen/themes'

export function wallPaletteVars(palette: WallPalette): CSSProperties {
  return {
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
}
