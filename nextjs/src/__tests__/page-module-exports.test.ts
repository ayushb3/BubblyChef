/**
 * Issue #581: Next.js 16's generated route-type check (`.next/types/app/**`)
 * rejects a `page.tsx` / `layout.tsx` that exports anything besides the known
 * route-module exports. The failure only shows up in `next build --webpack` and
 * in `tsc --noEmit` once a build has generated `.next/types` — never in Jest —
 * so a helper exported "for testing" from a page slips through until CI.
 *
 * This pins the rule where Jest can see it: helpers belong in `lib/`, not in a
 * page file.
 */

import fs from 'fs'
import path from 'path'

const APP_DIR = path.resolve(__dirname, '../app')

// The exports a page/layout module may have (Next 16 route-type `checkFields`).
const ALLOWED = new Set([
  'default',
  'config',
  'generateStaticParams',
  'metadata',
  'generateMetadata',
  'viewport',
  'generateViewport',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'experimental_ppr',
  'unstable_instant',
])

function routeModules(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...routeModules(full))
    else if (/^(page|layout)\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Names exported by a module's source, by a deliberately simple scan. */
function exportedNames(source: string): string[] {
  const names: string[] = []
  const decl = /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm
  for (const m of source.matchAll(decl)) names.push(m[1])
  const list = /^export\s*\{([^}]*)\}/gm
  for (const m of source.matchAll(list)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) names.push(name)
    }
  }
  return names
}

describe('page and layout modules', () => {
  const files = routeModules(APP_DIR)

  it('finds the route modules it is meant to police', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files.map((f) => [path.relative(APP_DIR, f).replace(/\\/g, '/'), f]))(
    '%s exports only what Next allows',
    (_label, file) => {
      const extra = exportedNames(fs.readFileSync(file, 'utf8')).filter((n) => !ALLOWED.has(n))
      expect(extra).toEqual([])
    },
  )
})
