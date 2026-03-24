# Dev1 Agent Memory — BubblyChef

## Project Context
- **Stack**: FastAPI backend (port 8888) + React/TypeScript/Vite frontend (port 5173)
- **Tailwind**: v4 — config is via `@theme` in `web/src/index.css`, NOT `tailwind.config.js`
  - `tailwind.config.js` is ignored by Tailwind v4; all tokens live in index.css `@theme` block
  - `web/src/index.css` already has all design tokens (deep-*, pastel-*, night-*, shadows, border-radius)
- **Dark mode**: `[data-theme="dark"]` selector + Tailwind `dark:` prefix

## Key File Paths
- `web/src/index.css` — all Tailwind v4 tokens + skeleton CSS + hide-scrollbar utility
- `web/src/types/index.ts` — all TypeScript types (PantryItem has no `emoji` field — use categoryEmojis)
- `web/src/constants/categories.ts` — `categoryEmojis: Record<Category|string, string>`
- `web/src/api/client.ts` — all React Query hooks; pantry query key is `['pantry', params]`
- `web/src/components/ExpiryBadge.tsx` — shared ExpiryBadge (days_until_expiry: number|null)
- `web/src/components/CardSkeleton.tsx` — shared CardSkeleton for grid loading state
- Icon tiers all handled by backend `/api/icons/{name}` — DO NOT duplicate in frontend
  - Tier 0: `CUSTOM_ICONS` in `icon_map.py` → kawaii PNG from `web/public/icons/food/`
  - Tier 1: `FOOD_ICON_MAP` → Fluent Emoji PNG
  - Tier 2: category fallback PNG
  - Tier 3: JSON emoji

## Design System (Tailwind v4 tokens in index.css)
- Deep colors: `deep-pink`, `deep-mint`, `deep-lavender`, `deep-peach`, `deep-coral`
- Pastel colors: `pastel-pink`, `pastel-mint`, `pastel-lavender`, `pastel-peach`, `pastel-coral`
- Dark surfaces: `night-base` (page), `night-surface` (card), `night-raised` (elevated)
- Shadows: `shadow-soft`, `shadow-soft-lg`, `shadow-soft-xl`
- Border tokens: `border-subtle`, `border-input`
- All interactive elements: `active:scale-95`, FABs: `fixed bottom-20 right-4`

## Patterns
- `PantryItem.location` is typed as `Location = 'fridge' | 'freezer' | 'pantry' | 'counter'`
- Client-side filtering preferred (fetch all items once, filter in JS)
- `usePantryItems({})` — always pass empty object to match query cache key `['pantry', {}]`
- Fluent emoji icon: `GET /api/icons/{name}` with onError → category emoji fallback
- Mascot images: `/mascot/bubbles-{expression}.png` — always add onError hide handler

## Completed (this session)
- Task 1: Tailwind config — confirmed v4 already has all tokens in index.css
- Task 6: Created ExpiryBadge.tsx + CardSkeleton.tsx shared components
- Task 2: Pantry page full refresh — sticky header, search, filter chips, 2-col grid, FAB
