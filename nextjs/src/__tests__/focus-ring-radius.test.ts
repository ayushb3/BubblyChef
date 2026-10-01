/**
 * @jest-environment node
 *
 * Issue #747 (focus ring found while sweeping globals.css).
 *
 * The global focus rules used to say `border-radius: inherit`. `inherit` takes
 * the PARENT's radius, and that rule is unlayered, so it beats Tailwind's
 * layered `rounded-*` utilities: a pill or keycap that received keyboard focus
 * lost its own corners (and its fill) for as long as it was focused, and its
 * outline went square. Outlines already follow the element's own border-radius
 * in every browser the app supports, so the declaration was never needed.
 *
 * A static-source check: the computed radius needs a real browser, which the
 * #747 verify run covers.
 */
import fs from 'fs'
import path from 'path'

const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('global focus rings keep the focused element\'s own corners (#747)', () => {
  it.each(['*:focus-visible', '.focus-ring-inset:focus-visible'])(
    '%s does not override border-radius',
    (selector) => {
      expect(rule(selector)).not.toMatch(/border-radius/)
    },
  )

  it('still draws the ring', () => {
    expect(rule('*:focus-visible')).toMatch(/outline:\s*2px solid var\(--color-text\)/)
    expect(rule('.focus-ring-inset:focus-visible')).toMatch(/outline-offset:\s*-3px/)
  })
})
