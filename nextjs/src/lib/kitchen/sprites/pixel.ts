/**
 * Pixel-art plumbing for the kitchen sprites (issue #751).
 *
 * A sprite is a grid of strings, one char per pixel, `.` for transparent and any
 * other char a key into a palette. Drawn in code, on the same 16 px grid as the
 * wall (1 cell = 1 wall unit), so there is no image request and a sprite stays
 * hard-edged at any scale. The category sprites render as SVG paths inside the
 * wall; the decoration sprites render as a standalone SVG image through the
 * catalog's `art` field (`spriteDataUri`).
 */
export type PixelRows = readonly string[]
export type PixelPalette = Readonly<Record<string, string>>

/** Width and height of a grid, in pixels. */
export function rowsSize(rows: PixelRows): { w: number; h: number } {
  return { w: rows[0]?.length ?? 0, h: rows.length }
}

/**
 * One path per colour: every horizontal run of that colour becomes a 1-high
 * rect. Colours come out in order of first appearance, so overlapping paints
 * (there are none within one sprite) would still be deterministic.
 */
export function rowsToPaths(rows: PixelRows, palette: PixelPalette): { fill: string; d: string }[] {
  const byChar = new Map<string, string>()
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.') {
        x += 1
        continue
      }
      let end = x
      while (end < row.length && row[end] === ch) end += 1
      byChar.set(ch, (byChar.get(ch) ?? '') + `M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  })
  return [...byChar].map(([ch, d]) => ({ fill: palette[ch], d }))
}

/** `#rrggbb` mixed `amount` (0-1) of the way from `from` to `to`. */
function mixHex(from: string, to: readonly [number, number, number], amount: number): string {
  const n = parseInt(from.slice(1), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (
    '#' +
    channels
      .map((c, i) => Math.round(c + (to[i] - c) * amount))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  )
}

/** The dull olive-khaki that wilting food drains toward. */
const WILT_TINT: readonly [number, number, number] = [196, 184, 128]
const HEX = /^#[0-9a-f]{6}$/i

/**
 * The same palette, drained: hex colours move halfway to a dull khaki (the board's
 * wilting romaine, bread and bananas are all this shade), while CSS variables (the
 * outline ink, the themed lid) stay put so the sprite still reads against any wall.
 */
export function wiltPalette(palette: PixelPalette, keep: ReadonlySet<string> = new Set()): PixelPalette {
  return Object.fromEntries(
    Object.entries(palette).map(([ch, colour]) => [
      ch,
      HEX.test(colour) && !keep.has(ch) ? mixHex(colour, WILT_TINT, 0.5) : colour,
    ]),
  )
}

/**
 * The drooped pose: one row shorter, so the sprite slumps down onto whatever it
 * stands on. The row dropped is a duplicate near the middle where there is one
 * (so no detail is lost), else the middle row. A very short sprite (3-4 rows) is
 * already low and keeps its shape.
 */
export function droopRows(rows: PixelRows): PixelRows {
  const h = rows.length
  if (h <= 4) return rows
  const middle = (h - 1) / 2
  const candidates = Array.from({ length: h - 2 }, (_, i) => i + 1).sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle),
  )
  const duplicate = candidates.find((i) => rows[i] === rows[i + 1])
  const drop = duplicate ?? candidates[0]
  return rows.filter((_, i) => i !== drop)
}

/**
 * A grid as a standalone SVG image, as a `data:` URI: what a catalog entry's `art`
 * field holds. The palette must be plain hex (an image cannot read the page's CSS
 * variables). Swapping in a bought PNG or SVG later is just a different `art`
 * string; nothing about the layout depends on how it was made.
 */
export function spriteDataUri(rows: PixelRows, palette: PixelPalette): string {
  const { w, h } = rowsSize(rows)
  const paths = rowsToPaths(rows, palette)
    .map((p) => `<path fill="${p.fill}" d="${p.d}"/>`)
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${w}" height="${h}" shape-rendering="crispEdges">${paths}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
