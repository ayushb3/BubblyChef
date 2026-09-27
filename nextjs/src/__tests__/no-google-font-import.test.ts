/**
 * @jest-environment node
 *
 * Issue #633 / PR #634 review round 1: `next/font/google` fetches font
 * files from Google at build time, and that fetch flaked intermittently on
 * Vercel (PR #629, PR #632), blocking the required check until someone
 * clicked Redeploy by hand. #633 replaced it with `next/font/local` in
 * `app/layout.tsx`, self-hosting the woff2 files under `app/fonts/`.
 *
 * The whole value of that fix is "the build never imports
 * `next/font/google`" — a single import line away from silently coming
 * back, with no type error and no lint failure by default. This is the
 * regression guard the PR #634 review asked for: it statically scans every
 * source file under `src/` and fails loudly (not just a random future
 * PR's Vercel deploy) if that import reappears anywhere.
 */
import fs from 'fs'
import path from 'path'

const SRC_ROOT = path.join(__dirname, '..')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
// Matches the module specifier in quotes, regardless of import style — a
// named import (`from '...'`), a bare side-effect import (`import '...'`),
// a dynamic `import('...')`, or `require('...')` (with or without a space
// before the paren). Deliberately only ' and " — never a backtick — because
// TS/JS import specifiers can't be template literals, so this can't match a
// backtick-quoted mention of the package name in a comment (as above, and
// in this file's own docblock).
const GOOGLE_FONT_IMPORT = /['"]next\/font\/google['"]/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

describe('next/font/google is never imported', () => {
  it('no file under src/ imports next/font/google', () => {
    const offenders = walk(SRC_ROOT)
      .filter((file) => GOOGLE_FONT_IMPORT.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC_ROOT, file))

    expect(offenders).toEqual([])
  })
})
