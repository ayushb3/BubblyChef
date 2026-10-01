/**
 * Keycap contrast (issue #741 review): every fill a SpringButton can take must
 * keep its text at AA (4.5:1) in every theme. Reads the real token values from
 * globals.css, so a theme or token edit that breaks a keycap fails here.
 */
import fs from 'fs'
import path from 'path'

const css = fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
  )
}

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const root = block(':root')
const themes = ['sakura', 'mint', 'lavender', 'yuzu', 'bluebell'].map(
  (t) => [t, block(`[data-theme="${t}"]`)] as const,
)

describe('keycap contrast', () => {
  it('danger: dark-red text on the expired rose passes AA', () => {
    expect(contrast(root['expired-text'], root['expired'])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(themes)('%s: ink text passes AA on the primary, surface and bg fills', (_name, t) => {
    expect(contrast(t.text, t.primary)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.text, t.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.text, t.bg)).toBeGreaterThanOrEqual(4.5)
  })
})
