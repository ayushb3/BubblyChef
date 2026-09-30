/**
 * @jest-environment node
 *
 * Issue #635. Measured in a production build: `next/font/local` generates the
 * family name `nunito` (plus a size-adjusted `nunito Fallback`), and CSS
 * family-name matching is case-insensitive, so the literal `font-family:
 * Nunito` already resolved to the loaded font. Body text was never falling
 * through to the system sans.
 *
 * Leading with the `--font-nunito` variable still buys two things: the font
 * no longer depends on that case-insensitive coincidence, and next/font's
 * size-adjusted `nunito Fallback` now applies, so there is less layout shift
 * while the font loads. The variable carries a `Nunito` var() fallback
 * because a missing variable makes the whole declaration invalid at
 * computed-value time (it would not fall through to the literal), which
 * matters if a root-replacing error page renders without the `<html>` class.
 *
 * These are static-source checks: the computed font needs a real build.
 */
import fs from 'fs'
import path from 'path'

const APP = path.join(__dirname, '..', 'app')

describe('body font leads with the next/font Nunito variable (#635)', () => {
  it('globals.css body rule leads with var(--font-nunito, Nunito)', () => {
    const css = fs.readFileSync(path.join(APP, 'globals.css'), 'utf8')
    const body = /\n\s*body\s*\{([^}]*)\}/.exec(css)
    expect(body).not.toBeNull()
    const decl = /font-family:\s*([^;]+);/.exec(body![1])
    expect(decl).not.toBeNull()
    expect(decl![1].trim()).toBe('var(--font-nunito, Nunito), Nunito, sans-serif')
  })

  it('layout.tsx <body> carries no inline fontFamily (it would override the stylesheet)', () => {
    const layout = fs.readFileSync(path.join(APP, 'layout.tsx'), 'utf8')
    const bodyTag = /<body\b[^>]*>/.exec(layout)
    expect(bodyTag).not.toBeNull()
    expect(bodyTag![0]).not.toMatch(/fontFamily/)
  })
})
