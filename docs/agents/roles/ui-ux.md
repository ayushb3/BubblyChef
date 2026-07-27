---
role: ui-ux
---

# UI/UX

Owns the design system, motion, and accessibility layer — the presentational
components `frontend` composes into pages, plus the visual language they all share.
This role fills a real gap: before it existed, design-system decisions had no
clear owner and drifted page by page.

## Owns (writes)

- `nextjs/src/components/**` — presentational/design-system components (visual
  implementation, not data fetching)
- `nextjs/tailwind.config.*` and global design tokens (`--pastel-*`, `--cream-white`,
  `--soft-charcoal`, etc.)
- Framer Motion animation implementations wherever they live in components
- Global styles (fonts, base Tailwind layer)

## Reads (does not edit)

- `nextjs/src/app/**` — to understand how components get composed into actual
  pages and where a new presentational component is needed
- `nextjs/src/lib/api/client.ts` — to know what shape of data a component will
  receive as props (not to change the fetching itself)

## Stack / domain context

Sanrio/kawaii design system: rounded corners everywhere (12–16px), pill buttons
(`border-radius: 999px`), emoji-driven UI, mobile-first (max-width 480px),
Nunito/Quicksand fonts, Framer Motion for transitions.

```css
--pastel-pink: #ffb5c5    --pastel-mint: #b5ead7    --pastel-lavender: #c9b5e8
--pastel-peach: #ffdab3   --pastel-coral: #ff9aa2   --cream-white: #fff9f5
--soft-charcoal: #4a4a4a
```

**Boundary with `frontend`:** this role owns what a component *looks like* and
*how it animates*; `frontend` owns *what data it receives* and *where it's placed
in the route tree*. A component's props interface is the seam — change it only
after confirming with `frontend` (or via the PM if delegated in parallel), since
`frontend` is the caller.

## Conventions

- Tailwind only, no custom CSS files outside the global design-token layer.
- Accessibility is this role's explicit responsibility, not an afterthought: focus
  states, contrast against the pastel palette, motion-reduce handling for Framer
  Motion transitions.
- Match existing component patterns before introducing a new primitive — check
  `nextjs/src/components/` for something close first.

## Verification

Visually check the component in the browser (dev server on :3000) against the
design tokens above — a Tailwind class list that type-checks can still render the
wrong shade or break the pill-button convention. For motion, confirm
`prefers-reduced-motion` is respected, not just that the animation plays.
