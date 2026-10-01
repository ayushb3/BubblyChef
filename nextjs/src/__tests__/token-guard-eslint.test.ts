/**
 * @jest-environment node
 *
 * Issue #747: the token guard. A new inline `fontFamily` or raw hex colour in a
 * component (or a route under `src/app`) must fail `eslint src`; the allowlist
 * (tests, SVG sprite art, brand art) must stay quiet.
 *
 * Two layers: the rules themselves (RuleTester), and the real
 * `eslint.config.mjs` wiring (the ESLint API on virtual files), because a rule
 * that is correct but never switched on guards nothing.
 */
import path from 'path'
import { execFileSync } from 'child_process'
import { RuleTester } from 'eslint'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require('../../eslint-rules/token-guard.cjs')

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

ruleTester.run('token-guard/no-inline-font-family', guard.rules['no-inline-font-family'], {
  valid: [
    { code: `const a = <p className="font-sans" style={{ color: 'var(--color-text)' }} />` },
    { code: `const a = <p className="font-pixel" />` },
    { code: `const fontFamilyLabel = 'a label'` },
    { code: `const a = { family: 'Nunito' }` },
  ],
  invalid: [
    {
      code: `const a = <p style={{ fontFamily: 'Nunito, sans-serif' }} />`,
      errors: [{ messageId: 'inlineFont' }],
    },
    {
      code: `const FONT = { fontFamily: 'var(--font-pixel)' }`,
      errors: [{ messageId: 'inlineFont' }],
    },
    {
      code: `const a = { 'font-family': 'Nunito' }`,
      errors: [{ messageId: 'inlineFont' }],
    },
    {
      code: `const a = <p style={{ color: 'red', fontFamily: 'a', ...x }} />`,
      errors: [{ messageId: 'inlineFont' }],
    },
  ],
})

ruleTester.run('token-guard/no-raw-hex-colour', guard.rules['no-raw-hex-colour'], {
  valid: [
    { code: `const a = <p style={{ color: 'var(--color-text)' }} />` },
    { code: `const a = <p className="text-[var(--color-coral)] bg-[var(--color-bg)]/10" />` },
    // Colour keywords and functions are not hex.
    { code: `const a = 'color-mix(in srgb, var(--color-coral) 12%, var(--color-surface))'` },
    { code: `const a = 'rgba(0,0,0,0.4)'` },
    // Issue references, entities and ids are not colours.
    { code: `const a = 'Multi-dish meal (explores #289)'` },
    { code: `const a = 'see PR #1234 for context'` },
    { code: `const a = 'it&#x27;s'` },
    { code: `const a = '/pantry#add'` },
    { code: `const a = 'fix #ff-thing'` },
    { code: "const a = `tab-#${id}`" },
  ],
  invalid: [
    { code: `const a = '#ffb5c5'`, errors: [{ messageId: 'rawHex', data: { hex: '#ffb5c5' } }] },
    { code: `const a = <p style={{ color: '#fff' }} />`, errors: [{ messageId: 'rawHex' }] },
    { code: `const a = <p className="text-[#ff9aa2] bg-[#ff9aa2]/10" />`, errors: 2 },
    { code: `const a = 'var(--color-coral, #ff9aa2)'`, errors: [{ messageId: 'rawHex' }] },
    { code: `const a = '1.5px solid #f5c0c0'`, errors: [{ messageId: 'rawHex' }] },
    { code: `const a = '#FFB7C580'`, errors: [{ messageId: 'rawHex' }] },
    { code: `const a = <svg><path fill="#4285F4" /></svg>`, errors: [{ messageId: 'rawHex' }] },
    { code: "const a = `1px solid #ddd ${x}`", errors: [{ messageId: 'rawHex' }] },
    // A bare all-digit colour is still a colour when it is the whole value.
    { code: `const a = '#444'`, errors: [{ messageId: 'rawHex' }] },
    { code: `const a = '1px solid #000000'`, errors: [{ messageId: 'rawHex' }] },
  ],
})

// ---------------------------------------------------------------------------
// The real config: which files the guard covers, and the allowlist.
//
// Jest can't `import()` the .mjs config in-process (no --experimental-vm-modules),
// so one child node process lints every probe with the real eslint.config.mjs
// and hands back the token-guard rule ids per file.
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..')
// Plain objects, not JSX, so the same source parses as .ts and .tsx.
const BAD_FONT = `export const FONT = { fontFamily: 'Nunito, sans-serif' }\n`
const BAD_HEX = `export const COLOUR = { color: '#ff9aa2' }\n`

const PROBES: Record<string, string> = {
  'src/components/ui/Probe.tsx': BAD_FONT,
  'src/components/ui/ProbeHex.tsx': BAD_HEX,
  'src/app/probe/page.tsx': BAD_FONT + BAD_HEX,
  'src/__tests__/probe.test.tsx': BAD_FONT + BAD_HEX,
  'src/components/ui/Probe.test.tsx': BAD_FONT + BAD_HEX,
  'src/components/kitchen/sprites/Pan.tsx': BAD_FONT + BAD_HEX,
  'src/components/kitchen/PanSprite.tsx': BAD_FONT + BAD_HEX,
  'src/components/auth/GoogleGlyph.tsx': BAD_FONT + BAD_HEX,
  'src/lib/design-tokens.ts': BAD_FONT + BAD_HEX,
}

const RUNNER = `
import { ESLint } from 'eslint'
const probes = JSON.parse(process.env.PROBES)
const eslint = new ESLint({ cwd: process.cwd() })
const out = {}
for (const [file, code] of Object.entries(probes)) {
  const [r] = await eslint.lintText(code, { filePath: file })
  out[file] = r.messages.filter((m) => m.ruleId?.startsWith('token-guard/'))
    .map((m) => ({ ruleId: m.ruleId, message: m.message }))
}
console.log(JSON.stringify(out))
`

type Hit = { ruleId: string; message: string }
let results: Record<string, Hit[]>

beforeAll(() => {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: ROOT,
    env: { ...process.env, PROBES: JSON.stringify(PROBES) },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  results = JSON.parse(stdout.trim().split('\n').pop()!)
}, 120_000)

const ids = (file: string) => results[file].map((h) => h.ruleId)

describe('eslint.config.mjs wires the token guard (#747)', () => {
  it('fails an inline fontFamily in a component', () => {
    expect(ids('src/components/ui/Probe.tsx')).toEqual(['token-guard/no-inline-font-family'])
  })

  it('fails a raw hex colour in a component', () => {
    expect(ids('src/components/ui/ProbeHex.tsx')).toEqual(['token-guard/no-raw-hex-colour'])
  })

  it('covers routes and pages under src/app too', () => {
    expect(ids('src/app/probe/page.tsx').sort()).toEqual([
      'token-guard/no-inline-font-family',
      'token-guard/no-raw-hex-colour',
    ])
  })

  it('tells the author what to use instead', () => {
    const hex = results['src/components/ui/ProbeHex.tsx'][0].message
    expect(hex).toMatch(/var\(--color-/)
    expect(hex).toMatch(/text-\[var\(--color-text\)\]/)
    const font = results['src/components/ui/Probe.tsx'][0].message
    expect(font).toMatch(/font-sans/)
    expect(font).toMatch(/font-pixel/)
  })

  it.each([
    ['a test file', 'src/__tests__/probe.test.tsx'],
    ['a colocated component test', 'src/components/ui/Probe.test.tsx'],
    ['sprite art', 'src/components/kitchen/sprites/Pan.tsx'],
    ['a sprite component', 'src/components/kitchen/PanSprite.tsx'],
    ['brand art', 'src/components/auth/GoogleGlyph.tsx'],
    ['the design-token module', 'src/lib/design-tokens.ts'],
  ])('leaves %s alone', (_label, file) => {
    expect(ids(file)).toEqual([])
  })
})
