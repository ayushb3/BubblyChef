/**
 * One pixel sprite, drawn as SVG paths inside the kitchen wall (issue #751).
 *
 * `x` and `y` are the sprite's top-left in wall units; one grid cell is one wall
 * unit, and the wall's `shape-rendering: crispEdges` keeps every pixel hard.
 * Fills go through `style` because that is where a `var(--wall-ink)` works.
 */
import { memo, useMemo } from 'react'
import { rowsToPaths, type PixelPalette, type PixelRows } from '@/lib/kitchen/sprites/pixel'

interface PixelSpriteProps {
  rows: PixelRows
  palette: PixelPalette
  x: number
  y: number
}

function PixelSprite({ rows, palette, x, y }: PixelSpriteProps) {
  const paths = useMemo(() => rowsToPaths(rows, palette), [rows, palette])
  return (
    <g transform={`translate(${x} ${y})`}>
      {paths.map((p) => (
        <path key={p.fill} d={p.d} style={{ fill: p.fill }} />
      ))}
    </g>
  )
}

export default memo(PixelSprite)
