/**
 * Token guard (issue #747, last ticket of Goal 3 / spec issue #739).
 *
 * Two rules that keep font faces and colours behind the design tokens in
 * `src/app/globals.css`, so a new component can't quietly re-introduce the
 * ~136 inline `fontFamily` declarations and ~40 raw hex literals the token
 * sweep removed.
 *
 *   token-guard/no-inline-font-family   `fontFamily:` in a style object
 *   token-guard/no-raw-hex-colour       '#ffb5c5', 'text-[#ff9aa2]', 'var(--x, #fff)'
 *
 * Wired in `eslint.config.mjs`, scoped to `src/components` and `src/app`, with
 * the allowlist (tests, SVG sprite and brand art) written out there.
 *
 * Plain CommonJS so both ESLint's flat config and Jest (the rule's own test)
 * can load it without a transform.
 */

const FONT_PROPERTY_NAMES = new Set(['fontFamily', 'font-family'])

// 3, 4, 6 or 8 digit hex, not glued to a word, an entity (`&#x27;`), or a path.
const HEX_COLOUR = /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g

/**
 * A 3 or 4 digit all-numeric match (`#289`, `#1234`) is far more likely an
 * issue reference in a string than the colours #289 / #123 4. Those count only
 * when the whole string is the colour.
 */
function isLikelyIssueReference(match, whole) {
  return /^#\d{3,4}$/.test(match) && whole.trim() !== match
}

function propertyName(node) {
  if (node.computed) return null
  if (node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value
  return null
}

const noInlineFontFamily = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow inline fontFamily; use the font utility classes.' },
    schema: [],
    messages: {
      inlineFont:
        'Inline fontFamily bypasses the font tokens. Drop it and use a class instead: ' +
        '`font-sans` (Nunito, the app face) or `font-pixel` (Pixelify Sans, in-world ' +
        'elements only). h1-h4 already get Quicksand from the base layer in globals.css.',
    },
  },
  create(context) {
    return {
      Property(node) {
        const name = propertyName(node)
        if (name !== null && FONT_PROPERTY_NAMES.has(name)) {
          context.report({ node, messageId: 'inlineFont' })
        }
      },
    }
  },
}

const noRawHexColour = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow raw hex colours; use the theme CSS variables.' },
    schema: [],
    messages: {
      rawHex:
        "Raw hex colour '{{hex}}'. Use a token: `var(--color-bg|surface|border|text|muted|" +
        'primary|primary-dark|accent|accent-dark|on-primary|coral)`, a signal token ' +
        '(`--color-fresh|expiring|expired|error|success|warn|tip`), or a dish token ' +
        '(`--color-dish-main|side-1|side-2`). In Tailwind write `text-[var(--color-text)]`; ' +
        'in a style prop write `color: "var(--color-text)"`. Drop any `, #hex` fallback ' +
        'inside var(). SVG sprite and brand art is allowlisted in eslint.config.mjs.',
    },
  },
  create(context) {
    function check(node, text) {
      for (const found of text.matchAll(HEX_COLOUR)) {
        if (isLikelyIssueReference(found[0], text)) continue
        context.report({ node, messageId: 'rawHex', data: { hex: found[0] } })
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw)
      },
    }
  },
}

module.exports = {
  meta: { name: 'token-guard' },
  rules: {
    'no-inline-font-family': noInlineFontFamily,
    'no-raw-hex-colour': noRawHexColour,
  },
}
