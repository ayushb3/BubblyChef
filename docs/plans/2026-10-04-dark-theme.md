# Dark theme plan, 2026-10-04

Ayush: "we need some dark themes my eyes aaaaaaah." This is a plan, not an
implementation. The tickets that carry it out are filed (section 8).

## 1. Goal

A dark mode that is easy on the eyes and keeps the kawaii, pixel identity.

- Follows the system setting by default.
- A **Light / Dark / System** toggle in Profile, working for guests.
- The preference lives in localStorage. A profile row only works after
  [PR #917](https://github.com/ayushb3/BubblyChef/pull/917) (draft, guest
  settings), so nothing here depends on it.
- No flash of light on load.

Not in scope: new kitchen themes, new art, syncing the choice across devices.

## 2. How colour works today (findings)

- **Tokens** are CSS variables in `nextjs/src/app/globals.css`, set on `:root`
  and recoloured per palette by `[data-theme="sakura|mint|lavender|yuzu|bluebell"]`.
  Per-palette tokens: `--color-bg`, `-primary`, `-accent`, `-text`, `-surface`,
  `-border`, `-muted`, `-primary-dark`, `-accent-dark`. Tailwind v4 reads them
  through `@theme inline` and `bg-[var(--color-*)]` classes.
- **Theme-invariant tokens** (same in every palette, all light-tuned): expiry
  (`fresh`, `expiring`, `expired` and their `-text`), category tints (`cat-*`,
  about 92 to 96% lightness), dish pastels, the error/success/warn/tip sets,
  `--color-on-primary` (white), `--color-coral`, `--color-ink`,
  `--color-charcoal`. Derived: `--shadow-*`, `--color-backdrop`
  (`color-mix` of text), the `chowder-panel*` white hatching.
- **An app palette system already exists.** `ThemeProvider`
  (`components/ThemeProvider.tsx`) stores the palette in localStorage key
  `bubbly-theme` and sets `data-theme`; an inline script in `app/layout.tsx`
  applies it before paint. `ThemePicker` (Profile, Appearance) edits it. No
  `dark:` variants and no `color-scheme` anywhere.
- **Kitchen themes are a different thing.** `lib/kitchen/themes.ts` has four
  unlockable looks (`pastel` 0 bubbles, `cozy_cottage` 500, `night_kitchen` 900,
  `seasonal` 1400), each with a `WallPalette` written to `--wall-*` vars
  (`wall-vars.ts`). The selection is `user_metadata.kitchen_theme`
  (`useKitchenTheme`), picked in `KitchenThemePicker`. The default `pastel` wall
  follows app tokens; the other three are literal hex. `night_kitchen` is an
  indigo night look that already exists as a reward.
- **Token guard** (PR #793, issue #747): `eslint-rules/token-guard.cjs` bans raw
  hex and inline `fontFamily` in `src/components` and `src/app`, allowlisting
  tests, `sprites/**`, `*Sprite*`, `*-art.*` and `GoogleGlyph`. It does not ban
  `bg-white`, `rgba()` or raw Tailwind palette classes, which is how those
  survived.
- **Mascot**: five PNGs in `public/mascot/` rendered by `BubblesMascot`, plus
  the in-scene `PixelBubbles` (code-drawn).
- **No charts.** No chart library is a dependency.

## 3. Inventory of colours that will not flip on their own

Counts are of non-test source under `nextjs/src`.

| Area | Count | Where | Migration |
|---|---|---|---|
| Pixel art palettes (hex) | about 280 | `lib/kitchen/wall-art.ts`, `themes.ts` (62), `bubbles-art.ts`, `sprites/category.ts`, `sprites/decorations.ts` | Ticket 3: night palette data, not per-file edits. Guard-exempt already. |
| `bg/text/border-white\|black` | 52 | `app/meals/[id]/page.tsx`, `app/login/page.tsx`, `CookModal`, `MealCookSheet`, `SavedRecipeMatches`, `SaveAccountBanner`, `PantryAddSheet`, `TourOverlay` | Ticket 2: swap to tokens (`on-primary`, `surface`, `backdrop`). |
| Raw Tailwind palette (`gray-*`, `red-*` ...) | 18 | scattered components | Ticket 2: swap to semantic tokens. |
| `rgba()` / `rgb()` literals | about 12 | `ThemePicker` swatch ring, `FoodAutocomplete`, `HeroHome` hairline, `cook-prototype`, `chowder-panel*` hatching | Ticket 2: `color-mix` on tokens. |
| Real hex in components/lib | about 20 | `lib/design-tokens.ts` mirrors (14), `GoogleGlyph` (4, stays), one in `components/kitchen` | Ticket 2: the PWA `colors` mirror stays light; `dishPastels` follows tokens. |
| Token-based usage (already flips) | about 1150 `var(--color-*)` uses, 425 token utility classes | everywhere | Free once tokens have dark values. |

Roughly 1,690 hex-looking strings turn up in a naive grep, but most are issue
numbers in comments (`#747`). The real figure is about 300, and 280 of those
are pixel art. App chrome is already close to fully tokenised, so the
migration is small and the dark palette is the main work.

## 4. Token strategy

**Dark is a second axis, not a sixth palette.** Keep `data-theme` for the five
palettes and add `data-mode="light|dark"` on `<html>`. Dark values are set per
palette as `[data-mode="dark"][data-theme="mint"]` and so on, so a mint user
gets a green-tinted dark and keeps their identity. Five dark palettes, tinted
off one neutral base, not five unrelated designs.

**Rules for the dark values**

- No pure black or white: background around `#1F1A22`, surfaces one step lighter.
  Text is a warm off-white, not `#fff`, to limit glare and halation.
- Pastel accents are tuned darker and less saturated; they stay recognisably
  pink, mint and lavender but stop glowing. `primary-dark` goes lighter, since
  in dark the "dark" accent has to be the high-contrast one.
- Surfaces separate by lightness steps and a visible border, not by shadows
  (shadows vanish on dark). Shadows become subtle darker pools.
- The expiry, category, dish, error, success, warn and tip sets all get dark
  values. Red stays bad and green stays good; do not invert meaning. Category
  tints become low-lightness tints (about 20 to 26%) so a badge on top stays legible.
- `--color-backdrop` becomes a darker scrim, `--color-on-primary` is chosen per
  fill so text on the pink button still passes.
- `color-scheme: dark` on the root so native controls, scrollbars and form
  fields match.

**Contrast targets (WCAG 2.1 AA)**

| Pair | Minimum |
|---|---|
| Body and UI text on bg / surface | 4.5:1 |
| Muted text on surface | 4.5:1 |
| Large text (18px bold or 24px) | 3:1 |
| Focus ring, input borders, icons that carry meaning | 3:1 against adjacent colour |
| Expiry / signal text on its tint | 4.5:1 |
| Decorative borders | exempt, but must stay visible (about 1.5:1 or more) |

Sample sakura-dark starting point (checked, tentative, the contrast test is the
arbiter): bg `#1F1A22`, surface `#2A2330`, text `#EFE3EA` (13.7:1 on bg, 12.2:1
on surface), muted `#B3A3AE` (6.3:1 on surface), primary-dark `#E07A99` (6.0:1
on bg), fresh text `#A7E3BC` on `#1F3A2A` (8.5:1), expired `#FFB4B4` on `#4A2328`
(8.0:1), expiring `#F2D27A` on `#40361A` (8.1:1). The border `#4A3D52` is only
1.7:1 against bg, which is fine for a decorative divider and not for an input
outline, so inputs need a stronger `--color-border-strong` token.

**Contrast is tested, not eyeballed.** A Jest test reads the token values for
every palette in dark and fails below the table above.

**Guard.** The token guard extends to `bg-white`, `text-black`, raw Tailwind
palette classes and `rgb(`/`rgba(` literals, so light-only colour cannot creep back.

## 5. Toggle, storage and no flash

- Preference `light | dark | system`, default `system`, localStorage key
  `bubbly-color-mode` (separate from `bubbly-theme`).
- `ColorModeProvider` + `useColorMode()` modelled on `ThemeProvider` (render the
  default first, then correct after hydration, to avoid a hydration mismatch).
- The control is a three-way segmented control in Profile > Appearance, beside
  the palette picker. It needs no account, so guests have it.
- **No flash:** the existing inline script in `app/layout.tsx` already runs
  before paint for `data-theme`. Extend it: read `bubbly-color-mode`, resolve
  `system` with `matchMedia('(prefers-color-scheme: dark)')`, set
  `data-mode` and `documentElement.style.colorScheme`, all inside the same
  try/catch. `suppressHydrationWarning` is already on `<html>`. The provider
  listens to the media query only while the preference is `system`.
- `<meta name="color-scheme" content="light dark">` and a `theme-color` per
  scheme (media-attributed) so the mobile browser bar matches. The PWA manifest
  `background_color` stays light (a manifest cannot switch); noted as a known gap.

## 6. The pixel kitchen in the dark

The scene is drawn from `--wall-*` variables, so a night palette is data, not
re-drawing.

- **Dark mode and kitchen themes are separate axes.** Kitchen themes are a
  reward earned with bubbles; dark mode never locks, overrides or renames them.
  Each `KitchenTheme` gains a `wallNight: WallPalette`, and `wallPaletteVars`
  writes that one when `data-mode="dark"`.
- **`night_kitchen` is the reference look** (indigo wall, deep-blue glass). When
  it is the selected theme it is used unchanged in dark. `pastel`,
  `cozy_cottage` and `seasonal` get night variants in the same lightness band
  but their own hue, so dark mode still looks like the user's kitchen. The
  default `pastel` wall follows app tokens already; only its literal floor and
  glass need night values.
- **Window at night:** deep-blue glass with 2 to 4 star pixels, optionally a moon.
- **Lamp glow:** a stepped, semi-transparent pixel light cone and a faint warm
  tint on the nearby wall and counter. Static; any flicker is disabled under
  `prefers-reduced-motion`. Pixel steps, not a blur, to keep the look.
- **Sprites:** food, wood and steel keep their colours. The check is each sprite
  outline against `--wall-base` at 3:1; add a 1px light rim only where an
  outline disappears.
- **Bubbles:** `PixelBubbles` is code-drawn and follows the wall. The five
  `BubblesMascot` PNGs need a look for a transparent background and an outline
  that survives on dark surfaces; if not, a dark-only token-coloured halo or
  drop-shadow. No regenerated art.
- The picker keeps showing each theme's daytime swatch.

## 7. Risks and open questions for Ayush

1. **Product call, recorded as decided unless you object:** dark follows the
   system by default. Rejected: default light (would not fix the complaint).
2. **Should dark be one palette or tinted per palette?** Plan says tinted per
   palette (five dark variants, one neutral base). Rejected: a single neutral
   dark, which would make the palette picker do nothing in dark. Costs about
   five blocks of tokens, not five designs.
3. **`night_kitchen` is a bubbles reward at 900.** With dark mode on, a user
   without it still sees a night variant of their own kitchen; the reward is the
   specific indigo look and the picker entry, not "darkness". Say if you would
   rather dark mode hide the night variants of the three locked looks.
4. **Risk:** the pastel identity is the brand and darkening can make it feel
   muddy. Mitigation is ticket 4's screenshot review of every screen; expect
   one tuning round on the dark values.
5. **Known gap:** PWA manifest `background_color` and the splash stay light.

## 8. Tickets, in order

Each is a vertical slice with its settled decisions in the issue body.

| # | Ticket | Blocked by |
|---|---|---|
| 1 | [Issue #919](https://github.com/ayushb3/BubblyChef/issues/919), *tokens, Light/Dark/System toggle in Profile, no flash on load* | none |
| 2 | [Issue #920](https://github.com/ayushb3/BubblyChef/issues/920), *migrate app surfaces off light-only colours* | #919 |
| 3 | [Issue #921](https://github.com/ayushb3/BubblyChef/issues/921), *night palette for the pixel kitchen scene* | #919 |
| 4 | [Issue #922](https://github.com/ayushb3/BubblyChef/issues/922), *polish and contrast audit of every main screen* | #920, #921 |

Tickets 2 and 3 can run in parallel once 1 lands; they touch different files
(app surfaces versus `lib/kitchen` and the scene).

## 9. Verification model

Every ticket proves itself with screenshots in dark and light on the affected
screens. Ticket 1 adds the first-paint test and the contrast test; ticket 2 the
extended lint rule; ticket 3 the night-palette completeness and outline-contrast
tests; ticket 4 the all-screens audit table and an axe pass.
