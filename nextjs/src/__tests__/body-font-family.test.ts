/**
 * @jest-environment node
 *
 * Issue #635: `next/font/local` exposes Nunito under a generated family name
 * (e.g. `__nunito_a1b2c3`) via the `--font-nunito` variable. A literal
 * `font-family: Nunito` never matches that generated name, so body text fell
 * through to the system sans-serif fallback. Both places that set the body
 * font (the global stylesheet and the inline style on <body> in the root
 * layout, which wins over the stylesheet) must lead with the variable.
 */
import fs from 'fs'
import path from 'path'

const APP = path.join(__dirname, '..', 'app')

describe('body font resolves to the next/font Nunito family (#635)', () => {
  it('globals.css body rule leads with var(--font-nunito)', () => {
    const css = fs.readFileSync(path.join(APP, 'globals.css'), 'utf8')
    const body = /\n\s*body\s*\{([^}]*)\}/.exec(css)
    expect(body).not.toBeNull()
    const decl = /font-family:\s*([^;]+);/.exec(body![1])
    expect(decl).not.toBeNull()
    expect(decl![1].trim()).toMatch(/^var\(--font-nunito\)/)
  })

  it('layout.tsx does not override the body with a literal Nunito family', () => {
    const layout = fs.readFileSync(path.join(APP, 'layout.tsx'), 'utf8')
    const bodyTag = /<body\b[^>]*>/.exec(layout)
    expect(bodyTag).not.toBeNull()
    const inline = /fontFamily:\s*(['"`])([^'"`]*)\1/.exec(bodyTag![0])
    if (inline) {
      expect(inline[2].trim()).toMatch(/^var\(--font-nunito\)/)
    }
  })
})
