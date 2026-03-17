# Plan: PixiJS Pixel Art Kitchen Scene (Phase 2 — KitchenView replacement)

## Context

The current `KitchenView.tsx` is plain CSS cards — not the pixel world the user wants. This plan replaces it entirely with a PixiJS v8 pixel art scene: a top-down kitchen room where fridge, freezer, pantry shelves, and counter are rendered as pixel art furniture. Clicking an appliance zooms the PixiJS camera into it; items appear as 16×16 pixel art sprites by food category. Clicking an item sprite opens `AddItemModal`.

User choices confirmed:
- **Layout**: Full room (top-down view, appliances as furniture)
- **Click behavior**: Zoom into appliance — camera zooms in, item sprites visible inside, back arrow zooms out
- **Item sprites**: Pixel art icons per food category (drawn via PixiJS Graphics API, no image files)

---

## Files to Change

| File | Action |
|------|--------|
| `web/package.json` | Add `pixi.js@^8.0.0` |
| `web/src/components/KitchenView.tsx` | **Full rewrite** — PixiJS scene replaces CSS card layout |
| `web/src/components/KitchenScene.tsx` | **NEW** — PixiJS canvas component (lazy-loaded) |
| `web/src/components/pixel/drawAppliances.ts` | **NEW** — draws kitchen room + appliances with PixiJS Graphics |
| `web/src/components/pixel/drawItems.ts` | **NEW** — draws 16×16 pixel art food sprites per category |

No backend changes. No API changes.

---

## Architecture

```
KitchenView.tsx  (React shell — data fetching, modal state, lazy loads KitchenScene)
  └── KitchenScene.tsx  (PixiJS Application, manages camera/zoom state)
        ├── drawAppliances.ts  (room bg, walls, fridge/freezer/pantry/counter sprites)
        └── drawItems.ts       (16×16 food category pixel icons)
```

`KitchenView` stays a plain React component. It handles:
- `usePantryItems({})` data fetch
- `editingItem` + `isAddModalOpen` state
- Renders `<AddItemModal>` as before
- Lazy-loads `KitchenScene` via `React.lazy`

`KitchenScene` receives props: `items: PantryItem[]`, `onItemClick: (item: PantryItem) => void`

---

## Implementation Detail

### 1. Install PixiJS

```bash
cd web && npm install pixi.js@^8.0.0
```

PixiJS v8 is ESM-native and works with Vite out of the box. No extra vite plugin needed.

### 2. `KitchenScene.tsx` — PixiJS Application

```typescript
import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import type { PantryItem, Location } from '../types';
import { drawKitchenRoom } from './pixel/drawAppliances';
import { drawItemSprite } from './pixel/drawItems';
```

**Setup:**
- `useRef<HTMLDivElement>` for mount target
- `useEffect` — creates `Application`, mounts to div, destroys on cleanup
- Canvas: `antialias: false`, `resolution: 2` (retina), background `#FFF9F5` (cream-white)
- Scene canvas: 800×520px logical, scales to fill container width via CSS `width: 100%; image-rendering: pixelated`

**Two render states managed via PixiJS Container visibility:**
1. **Room view** (`roomContainer`): full kitchen top-down scene
2. **Zoom view** (`zoneContainer`): close-up of one appliance showing item sprites

**Room view layout (top-down, pixel art):**
```
┌─────────────────────────────────────────────┐
│  back wall (dark cream tiles)               │
│  ┌──────┐    ┌────────────┐    ┌───────┐   │
│  │fridge│    │pantry shelf│    │freezer│   │
│  │(blue)│    │ (wood tan) │    │(icy)  │   │
│  └──────┘    └────────────┘    └───────┘   │
│                                             │
│  ══════════════════ counter ══════════════  │
│  (items on counter surface as tiny sprites) │
└─────────────────────────────────────────────┘
```

Each appliance is an interactive `Container` with:
- Pixel art body drawn via `Graphics` (rectangles + detail pixels for handles, shelves etc.)
- Item count badge (small `Text`)
- `cursor = 'pointer'`, `eventMode = 'static'`
- `pointerover` → slight tint highlight
- `pointerdown` → trigger zoom

**Zoom view (when appliance clicked):**
- Animated via PixiJS `Ticker` — smooth scale + position tween (0.3s ease-out)
- Shows appliance interior with item sprites arranged in a grid
- Each item sprite: 16×16 pixel art icon (category-based) + item name label below
- Expiry dot: colored 4×4 pixel square in corner (green/yellow/red)
- Back button: pixel art arrow in top-left, click returns to room view

**Camera tween:**
```typescript
// On zone click: tween roomContainer scale from 1 → 2.5, pivot to zone center
// On back: tween back to scale 1
```

### 3. `drawAppliances.ts` — Pixel Art Kitchen Room

Draws with PixiJS `Graphics` API only — zero image files.

**Color palette (Sweetie 16 + BubblyChef pastels):**
```typescript
const COLORS = {
  wall:    0xFFF9F5,  // cream white
  floor:   0xF5EDD9,  // warm beige
  fridge:  0xB5D8EB,  // pastel blue
  freezer: 0xC9B5E8,  // pastel lavender
  pantry:  0xFFDAB3,  // pastel peach (wood/warm)
  counter: 0xD4C4A8,  // tan
  shadow:  0x4A4A4A,  // soft charcoal (at low alpha)
  handle:  0x8FA8B8,  // grey-blue
  outline: 0x4A4A4A,  // soft charcoal
};
```

**Fridge sprite:**
- Tall rectangle, pastel blue fill, charcoal outline
- Two door panels separated by horizontal line
- Small silver handle rectangle on right edge
- Snowflake detail (4 pixels) in upper door

**Pantry shelf sprite:**
- Wide rectangle, warm peach fill
- 3 horizontal shelf lines inside
- Small items silhouetted on shelves (2px dots)

**Freezer sprite:**
- Narrow rectangle, lavender fill
- Frost pattern (diagonal pixel lines at low alpha)
- Padlock icon (3×4 pixels)

**Counter:**
- Full-width rectangle along bottom, tan fill
- Wood grain lines (horizontal, 1px, low alpha)
- Counter items (from `counter` location) rendered directly as small sprites

### 4. `drawItems.ts` — 16×16 Pixel Art Food Icons

Each category gets a unique hand-drawn pixel shape using `Graphics.rect()` calls:

```typescript
export function drawItemSprite(g: Graphics, category: Category, x: number, y: number): void
```

| Category | Shape | Colors |
|----------|-------|--------|
| `produce` | Rounded apple — red circle, green leaf pixel | `0xFF6B6B`, `0x4CAF50` |
| `dairy` | Milk bottle — white rectangle, blue cap | `0xEEEEEE`, `0x5B9BD5` |
| `meat` | Drumstick — brown oval + bone pixel | `0xC67C4E`, `0xF5DEB3` |
| `seafood` | Fish shape — blue-grey pixels | `0x7BB3D3` |
| `frozen` | Ice cube — light blue square + shine | `0xB5D8EB`, `0xFFFFFF` |
| `canned` | Cylinder — grey with label stripe | `0x9E9E9E`, `0xFF9AA2` |
| `dry_goods` | Box/bag — brown square, fold lines | `0xD4A96A` |
| `condiments` | Bottle — narrow rectangle, red cap | `0xD4D4D4`, `0xE74C3C` |
| `beverages` | Cup — wide at top, narrow base | `0x7EC8E3` |
| `snacks` | Popcorn bag — striped triangle | `0xFFF1B5`, `0xFF6B6B` |
| `bakery` | Bread loaf — rounded top, tan | `0xD4A96A`, `0xC8956C` |
| `other` | Box with question mark pixels | `0xCCCCCC` |

### 5. `KitchenView.tsx` — React Shell (rewrite)

```typescript
import React, { Suspense, useState } from 'react';
import { usePantryItems } from '../api/client';
import { AddItemModal } from './AddItemModal';
import type { PantryItem } from '../types';

const KitchenScene = React.lazy(() => import('./KitchenScene'));

export function KitchenView() {
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { data, isLoading } = usePantryItems({});

  const handleItemClick = (item: PantryItem) => {
    setEditingItem(item);
    setIsAddModalOpen(true);
  };

  if (isLoading) return <div className="...">Loading your kitchen...</div>;

  return (
    <div className="relative w-full">
      <Suspense fallback={<div className="...">Rendering kitchen...</div>}>
        <KitchenScene
          items={data?.items ?? []}
          onItemClick={handleItemClick}
        />
      </Suspense>
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={() => { setIsAddModalOpen(false); setEditingItem(null); }}
        editItem={editingItem}
      />
    </div>
  );
}
```

---

## Mobile Handling

On screens < 768px:
- Canvas renders at 480×360px logical (still pixel art)
- Room view shows same layout but at smaller scale
- Zoom view fills the canvas (still functional)
- PixiJS `pointer` events unify mouse + touch — no separate mobile code path needed

---

## TypeScript Notes

- All PixiJS objects typed via `pixi.js` package types (included with the package)
- `KitchenScene` props interface exported for strict typing
- No `any` — `Graphics`, `Container`, `Application`, `Ticker` all have full types in v8

---

## Clarification: "AddItemModal" is actually Add/Edit Modal

`AddItemModal` handles both flows:
- `editItem={null}` → **Add** new item from scratch
- `editItem={someItem}` → **Edit** existing item (pre-fills all fields)

Clicking an item sprite in the kitchen scene calls `onItemClick(item)` which sets `editItem = item`, opening the modal in **edit mode**. The user sees the item's current name, quantity, expiry, etc. and can update them.

---

## Testing Plan

### Automated
- `npx tsc --noEmit` — zero TypeScript errors (strict mode, no `any`)
- `npm run build` — Vite production build passes with no warnings

### Manual Browser Checklist
1. Toggle kitchen icon in Pantry header → pixel art scene renders (no blank canvas, no console errors)
2. Room view shows all 4 zones: fridge (blue, left), pantry shelf (peach, center), freezer (lavender, right), counter (tan, bottom)
3. Each appliance shows an item count badge matching real pantry data
4. Hover over appliance → subtle highlight tint
5. Click fridge → camera zooms in smoothly (animated, ~0.3s)
6. Zoom view shows item sprites (16×16 pixel icons) for each fridge item
7. Each item sprite has expiry dot (green/yellow/red) and name label
8. Click an item sprite → `AddItemModal` opens in **edit mode** with correct item data pre-filled
9. Click back arrow → camera zooms back out to room view smoothly
10. Counter items appear as mini sprites directly on counter surface in room view
11. Resize to 375px width → scene renders at smaller scale, still interactive (touch works)
12. Toggle back to grid view → normal card grid renders correctly (scene destroyed/unmounted)
13. viewMode persists after page refresh (localStorage)
14. Empty zones show a friendly empty-state inside the appliance (not blank)

---

## Definition of Success

The feature is complete when:
1. **Visual** — the kitchen looks like a real pixel art top-down room, not CSS boxes. Fridge, pantry, freezer are recognizable furniture sprites. Counter runs along the bottom.
2. **Interactive** — clicking any appliance triggers a visible zoom animation into that zone.
3. **Data-connected** — item count badges and item sprites reflect actual pantry data (not mocked).
4. **Editable** — clicking an item in zoom view opens the existing edit modal with that item's real data.
5. **TypeScript clean** — `tsc --noEmit` passes with zero errors.
6. **Build passes** — `npm run build` succeeds.
7. **Mobile works** — scene is usable at 375px width via touch.

---

## Conformance Checks

| Check | Command |
|-------|---------|
| PixiJS installed | `cat web/package.json \| grep pixi` |
| TS compiles clean | `cd web && npx tsc --noEmit` |
| Build passes | `cd web && npm run build` |

---

## Verification

```bash
cd web && npm install pixi.js@^8.0.0
npx tsc --noEmit
npm run build
npm run dev
# Navigate to http://localhost:5173/pantry
# Click kitchen toggle icon in header
# Verify all 14 manual checklist items above
```
