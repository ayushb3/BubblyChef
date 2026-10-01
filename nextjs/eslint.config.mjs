import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);
// Issue #747: the token guard. Plain CommonJS so Jest can load the same file
// for its own test (src/__tests__/token-guard-eslint.test.ts).
const tokenGuard = require("./eslint-rules/token-guard.cjs");

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Issue #747 token guard: no inline `fontFamily` and no raw hex colour in
  // components or routes. Faces come from the font classes (`font-sans`,
  // `font-pixel`), colours from the CSS variables in src/app/globals.css.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    plugins: { "token-guard": tokenGuard },
    rules: {
      "token-guard/no-inline-font-family": "error",
      "token-guard/no-raw-hex-colour": "error",
    },
  },
  // The guard's allowlist. Keep it short and say why each entry is here.
  {
    files: [
      // Tests and fixtures assert on literal values.
      "src/**/__tests__/**",
      "src/**/*.test.{ts,tsx}",
      // Pixel SVG sprite art: palette entries are the art, not theme colours.
      "src/components/**/sprites/**",
      "src/components/**/*Sprite*.{ts,tsx}",
      "src/components/**/*-art.{ts,tsx}",
      // Third-party brand art (the Google "G" must keep Google's colours).
      "src/components/auth/GoogleGlyph.tsx",
      // The design-token module itself (src/lib/design-tokens.ts) is outside
      // the guard's `files` above, so it needs no entry.
    ],
    rules: {
      "token-guard/no-inline-font-family": "off",
      "token-guard/no-raw-hex-colour": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
