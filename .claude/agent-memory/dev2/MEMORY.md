# Dev2 Agent Memory — BubblyChef

## Project Stack
- React 18 + TypeScript strict + Vite (port 5173)
- Tailwind CSS v4 — config in `web/src/index.css` via `@theme {}` block
- `web/tailwind.config.js` also used (both must stay in sync)
- Zustand for client state, React Query for server state
- Framer Motion available, lucide-react for icons

## Tailwind v4 Dark Mode
- v4 uses `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`
- This is added to `index.css` automatically by linter; do NOT add manually
- `darkMode: ['class', '[data-theme="dark"]']` in tailwind.config.js still needed for IDE intellisense
- Apply dark mode with `dark:` prefix in components

## Design System — v2 Refresh (2026-03-23)
- **NO opacity modifiers on color tokens** — `bg-pastel-pink/20` is BANNED
  - Use `opacity-60` class on element instead, or define a named token
  - This is enforced by design-decisions.md §1
- **Shadow = interactive** — `shadow-soft` on interactive, no shadow on static chips
- **Active feedback**: `active:scale-95` on ALL tappable elements
- **Rounded-pill** class available for buttons/chips (999px radius)

## Key Component Locations
- `web/src/components/ThemeToggle.tsx` — ThemeToggle + useThemeStore + useThemeInit
- `web/src/components/ButtonChip.tsx` — ButtonChip + ButtonDisplayChip
- `web/src/components/Skeleton.tsx` — Skeleton, CardSkeleton, ListItemSkeleton, ChatBubbleSkeleton*
- `web/src/components/ExpiryBadge.tsx` — expiry badge with dark mode
- `web/src/components/BottomNav.tsx` — 4 tabs (Dashboard/Pantry/Scan/Chat), no Kitchen
- `web/src/components/Sidebar.tsx` — desktop sidebar with mascot logo

## Query Cache Keys
- Pantry items: `['pantry', {}]` — must include the params object for cache invalidation

## Mascot Assets
- `web/public/mascot/bubbles-happy.png` — default avatar, Dashboard header, Sidebar
- `web/public/mascot/bubbles-thinking.png` — chat "AI thinking" state
- `web/public/mascot/bubbles-surprised.png` — empty states
- Always use `onError` to hide broken images, never show broken img elements

## CSS Patterns
- `.skeleton` class defined in index.css for shimmer animation
- `.hide-scrollbar` for horizontal filter chip rows
- Body bg uses CSS custom property `var(--color-page-bg)` which flips in dark mode

## Kitchen Scene
- Decision §8: Kitchen hidden from nav, code intact
- Components: DOMKitchenScene.tsx, InteriorView.tsx, KitchenItem.tsx

## Common Mistakes
- Forgetting `opacity-60` replacement for `/60` modifier
- Using `bg-pastel-pink/20` — immediately caught by design review
- Not adding `role="log" aria-live="polite"` on chat message container
- Not adding `aria-busy="true"` on skeleton loading containers
