# Kitchen Art Generation Guide

## Overview

This guide helps you generate the pixel art PNG images needed for the BubblyChef kitchen scene. The DOM-based kitchen scene uses layered PNG images positioned with CSS — each image is a separate "sprite" that gets composed together.

You don't need all images at once. The code has CSS fallback backgrounds (colored rectangles matching the current palette), so you can drop in PNGs progressively as you generate them.

---

## Priority Order

Generate in this order (highest impact first):

1. **Room background** — immediately transforms the scene
2. **4 appliance sprites** — fridge, freezer, pantry shelf, counter
3. **4 interior backgrounds** — fridge inside, freezer inside, pantry inside, counter surface
4. **12 food category sprites** — small icons for items on shelves
5. **Decorative overlays** (future) — unlockable decorations

---

## Image Specifications

### Room Background (`room/background.png`)

| Property | Value |
|----------|-------|
| **Size** | 800 × 520 pixels |
| **Content** | Kitchen room: cream/pink wall with subtle pattern, checkerboard floor (cream/peach), window with pink curtains and blue sky, wall clock, potted plant, baseboard, crown molding, tile backsplash behind counter area |
| **Style** | Pixel art, 16-bit/32-bit retro game style, Stardew Valley / Animal Crossing aesthetic |
| **Palette** | Pastel: cream white (#FFF9F5), soft pink (#FFB5C5), peach (#FFDAB3), mint (#B5EAD7), light blue (#B5D8EB) |
| **Note** | Leave the appliance areas EMPTY (just wall/floor visible there) — appliances are separate overlays |
| **Format** | PNG with transparency NOT needed (fully opaque background) |

**AI Prompt:**
> "Pixel art kitchen room background, 800x520 pixels, front-facing view. Cream/pastel pink walls with subtle diamond wallpaper pattern, wainscoting on lower half. Checkerboard floor tiles in cream and peach tones. Small window on left-center wall with pink curtains, blue sky with white clouds. Small round wall clock on the right. Tile backsplash above counter area. Potted green plant on the floor. Crown molding at ceiling, baseboard at floor line. Cozy, kawaii, Stardew Valley style. Warm ambient lighting. No appliances or furniture — just the empty room shell. Pastel color palette: #FFF9F5, #FFB5C5, #FFDAB3, #B5EAD7."

---

### Appliance Sprites (4 images)

Each appliance is a separate PNG with **transparent background** so it layers over the room.

#### Fridge (`appliances/fridge.png`)

| Property | Value |
|----------|-------|
| **Size** | 240 × 350 pixels (renders at ~120×175 in the scene) |
| **Content** | Front-facing retro/kawaii fridge. Top freezer compartment + bottom fridge door. Chrome handles. Door magnets, small photo/note. Slight 3D depth (visible side panel). Pastel blue (#B5D8EB) body. |
| **Format** | PNG with transparent background |

**AI Prompt:**
> "Pixel art fridge sprite, 240x350 pixels, transparent background. Front view with slight 3D side panel visible. Pastel baby blue (#B5D8EB) body. Top freezer compartment with snowflake icon, bottom main door. Chrome/silver handles with highlight. Cute magnets on door (red heart, green circle, orange square). Small white note pinned to door. Visible rubber door seals. Small feet at bottom. Kawaii, Stardew Valley pixel art style. Clean edges suitable for layering."

#### Freezer (`appliances/freezer.png`)

| Property | Value |
|----------|-------|
| **Size** | 216 × 330 pixels (renders at ~108×165) |
| **Content** | Upright freezer, pastel lavender (#C9B5E8). Frost buildup on edges, ice crystals. Green LED temperature display. Chrome handle. Snowflake decoration. 3D side panel. |
| **Format** | PNG with transparent background |

**AI Prompt:**
> "Pixel art upright freezer sprite, 216x330 pixels, transparent background. Front view with 3D side panel. Pastel lavender/purple (#C9B5E8) body. Frosted edges with white ice crystal details. Small green LED temperature display showing '-18'. Chrome handle with highlight. Snowflake icon on door. Slight frost mist at bottom. Kawaii pixel art style, clean edges for layering."

#### Pantry Shelf (`appliances/pantry-shelf.png`)

| Property | Value |
|----------|-------|
| **Size** | 360 × 290 pixels (renders at ~180×145) |
| **Content** | Open wooden shelving unit, warm brown (#B87A4A frame). 4 shelves with depth. Decorative silhouettes of jars/cans/boxes on shelves. Wooden grain texture. |
| **Format** | PNG with transparent background |

**AI Prompt:**
> "Pixel art open wooden pantry shelf, 360x290 pixels, transparent background. Front view. Warm brown wooden frame (#B87A4A) with lighter shelf surfaces (#D4996A). 4 horizontal shelves with visible depth/front faces. Semi-transparent silhouettes of jars, bottles, boxes, and cans on the shelves (just decorative outlines, not specific items). Wood grain detail on frame. Bracket supports on sides. Decorative top cap. Kawaii, cozy kitchen style."

#### Counter (`appliances/counter.png`)

| Property | Value |
|----------|-------|
| **Size** | 1400 × 170 pixels (renders at ~700×85) |
| **Content** | Wide kitchen counter with cabinet doors below. Wood grain countertop (#D4C4A8). 5 cabinet doors with round knobs. Cutting board and fruit bowl on top as decoration. |
| **Format** | PNG with transparent background |

**AI Prompt:**
> "Pixel art kitchen counter with cabinets, 1400x170 pixels, transparent background. Front view. Wood grain countertop (#D4C4A8) with slight edge detail. 5 cabinet doors below in slightly darker wood (#C0B090) with round knobs. Each door has an inset panel detail. Small cutting board on the right end of counter. Small fruit bowl (red apple, green pear, yellow lemon) on the left side. Kawaii pixel art style."

---

### Interior Backgrounds (4 images)

These are the "zoomed in" views when you click an appliance. They fill the entire 800×520 area.

#### Fridge Interior (`interiors/fridge-interior.png`)

| Property | Value |
|----------|-------|
| **Size** | 800 × 520 pixels |
| **Content** | Inside of an open fridge, front-facing. Light blue-white back wall (#E8F4FA). Yellow fridge light at top center. 4 glass shelves with support brackets. Door shelves on right side (for condiments). Rubber seal border. Temperature display in bottom-right corner. Condensation water drops. |
| **Format** | PNG, opaque |

**AI Prompt:**
> "Pixel art open fridge interior, 800x520 pixels, front-facing view looking inside. Cool light blue-white background (#E8F4FA) with warm yellow fridge light glowing at top center. 4 horizontal glass shelves with chrome bracket supports on sides. Right side has vertical door shelves (4 shallow shelves for condiments). Rubber door seal visible as border/frame. Small green LED temperature display in bottom-right corner reading '4°C'. Tiny condensation water drops on walls. Empty — no food items (those are overlaid programmatically). Clean, detailed pixel art."

#### Freezer Interior (`interiors/freezer-interior.png`)

| Property | Value |
|----------|-------|
| **Size** | 800 × 520 pixels |
| **Content** | Inside of freezer. Icy blue background (#D8E8F5). Top open shelf area. 3 pull-out drawers with handles. Frost buildup on edges. Ice crystals. Fog/mist effect at bottom. Green LED indicator. |
| **Format** | PNG, opaque |

**AI Prompt:**
> "Pixel art open freezer interior, 800x520 pixels, front-facing. Icy blue background (#D8E8F5) getting colder/darker at bottom. Top open shelf area, then 3 large pull-out drawer compartments with horizontal chrome handles. Heavy white frost buildup on edges and corners. Small ice crystal formations (cross-shaped). Misty fog effect rising from bottom. Green LED indicator dot in top-right. Frost-covered frame/seal border. Empty — no food items. Detailed pixel art, cold atmosphere."

#### Pantry Interior (`interiors/pantry-interior.png`)

| Property | Value |
|----------|-------|
| **Size** | 800 × 520 pixels |
| **Content** | Inside of wooden pantry cabinet. Warm cream/peach back wall (#FFF5E8). 5 wooden shelves with visible depth. Wooden side frames. Wood grain detail. Section dividers. Bracket supports. |
| **Format** | PNG, opaque |

**AI Prompt:**
> "Pixel art open pantry interior, 800x520 pixels, front-facing. Warm cream/peach background (#FFF5E8). 5 horizontal wooden shelves in warm brown (#D4996A) with visible front face depth and shadow underneath. Sturdy wooden side frames (#B87A4A) with lighter highlights. Wood grain texture on shelves. Small bracket supports where shelves meet frame. Subtle vertical section dividers on back wall. Top decorative cap. Empty — no food items. Cozy, warm pixel art kitchen aesthetic."

#### Counter Interior (`interiors/counter-interior.png`)

| Property | Value |
|----------|-------|
| **Size** | 800 × 520 pixels |
| **Content** | Top-down/slight angle view of counter surface. Wood grain (#E8DCC8) across surface. Cutting board area in top-right with knife. Shadow at bottom edge for depth. |
| **Format** | PNG, opaque |

**AI Prompt:**
> "Pixel art kitchen counter surface, 800x520 pixels, slight top-down perspective. Light wood grain surface (#E8DCC8) with subtle grain lines. Wooden cutting board area in top-right (#E0C88C) with a small knife on it (silver blade, brown handle). Counter edge highlight at top. Shadow gradient at bottom edge. Clean, organized surface ready for food items to be placed on. Warm, cozy pixel art style."

---

### Food Category Sprites (12 images)

Small icons representing each food category. Used inside interior views on shelves.

| Property | Value |
|----------|-------|
| **Size** | 32 × 32 pixels each |
| **Format** | PNG with transparent background |
| **Style** | Cute, recognizable, pastel-tinted pixel art |

Generate these as individual images or as a **spritesheet** (384 × 32 = 12 across):

| Category | Sprite Description | AI Prompt Fragment |
|----------|-------------------|--------------------|
| `produce` | Red apple with green leaf | "cute red apple with small green leaf" |
| `dairy` | White milk bottle/carton | "white milk bottle with blue cap" |
| `meat` | Chicken drumstick | "golden-brown chicken drumstick" |
| `seafood` | Blue/pink fish | "cute pastel blue fish" |
| `frozen` | Blue ice cube / popsicle | "blue ice cube with sparkle" |
| `canned` | Silver/grey can | "silver tin can with label" |
| `dry_goods` | Brown box/bag | "small brown paper bag or box" |
| `condiments` | Red/yellow bottle | "small ketchup or mustard bottle" |
| `beverages` | Glass/cup | "clear glass or tea cup" |
| `snacks` | Popcorn bag / chip bag | "cute popcorn box or chip bag" |
| `bakery` | Bread loaf | "small golden bread loaf" |
| `other` | Question mark / mystery box | "small pastel pink mystery box with ?" |

**Combined AI Prompt for spritesheet:**
> "Pixel art food item spritesheet, 12 icons at 32x32 pixels each, arranged in a single row (384x32 total). Transparent background. From left to right: red apple, milk bottle, chicken drumstick, blue fish, ice cube, tin can, brown bag, ketchup bottle, glass cup, popcorn box, bread loaf, pink mystery box with question mark. Cute kawaii style, pastel colors, clean pixel art. Each icon should be recognizable at small size."

---

## Recommended Tools

### Option A: AI Image Generation (Fastest)

1. **ChatGPT / DALL-E 3** (your OpenAI subscription)
   - Best for: Room backgrounds, interior scenes, appliances
   - Tip: Generate at 1024×1024 then crop/resize to exact dimensions
   - Tip: Ask for "pixel art" explicitly, and specify "clean edges" for sprites with transparency

2. **Midjourney** (if you have access)
   - Add `--style raw --ar 800:520` for backgrounds
   - Add `--no background` for transparent sprites (may need post-processing)

3. **Stable Diffusion** (local, free)
   - Use a pixel art LoRA/checkpoint
   - Models to look for: "pixel-art-xl", "pixelart-style"

### Option B: Pixel Art Editors (Most Control)

1. **Piskel** (free, browser-based) — https://www.piskelapp.com/
   - Best for: Small sprites (32×32 food items), touch-up AI output
   - Export as PNG with transparency

2. **Pixilart** (free, browser-based) — https://www.pixilart.com/
   - Good for both small sprites and larger scenes

3. **Aseprite** ($20, desktop) — https://www.aseprite.org/
   - Best pixel art editor available. Worth it if you plan to iterate on sprites
   - Has animation support (for future idle animations)
   - Export spritesheet feature

### Option C: Hybrid (Recommended)

1. Use **DALL-E 3 / ChatGPT** to generate the large backgrounds (room, interiors) — these are hard to pixel-art by hand
2. Use **Piskel** to clean up edges, fix transparency, and create the small 32×32 food sprites
3. Use **Aseprite** for any future animation work

---

## Tips for AI Generation

1. **Always specify exact pixel dimensions** in your prompt
2. **"Pixel art" is key** — without it, AI tends to generate smooth/realistic art
3. **Color palette control:** Include hex codes in the prompt for consistent palette
4. **Transparency:** DALL-E 3 doesn't support transparent backgrounds natively. Generate on a solid color (like bright green #00FF00) then remove the background in an editor or with https://remove.bg
5. **Post-processing:** AI output often needs:
   - Resize to exact dimensions (use nearest-neighbor scaling to preserve pixel crispness)
   - Remove background for sprites
   - Color correction to match palette
   - Edge cleanup
6. **Consistency:** Generate all appliances in the same prompt session so they share a consistent style
7. **Scale 2x then downscale:** Generate at 2× the target size (e.g., 1600×1040 for the room), then downscale with nearest-neighbor — this gives AI more "resolution budget" for detail

---

## Delivery Checklist

Place all generated PNGs in the project at `web/public/kitchen/`:

```
web/public/kitchen/
├── room/
│   └── background.png          ← 800×520, room shell (PRIORITY 1)
├── appliances/
│   ├── fridge.png              ← 240×350, transparent bg (PRIORITY 2)
│   ├── freezer.png             ← 216×330, transparent bg (PRIORITY 2)
│   ├── pantry-shelf.png        ← 360×290, transparent bg (PRIORITY 2)
│   └── counter.png             ← 1400×170, transparent bg (PRIORITY 2)
├── interiors/
│   ├── fridge-interior.png     ← 800×520, opaque (PRIORITY 3)
│   ├── freezer-interior.png    ← 800×520, opaque (PRIORITY 3)
│   ├── pantry-interior.png     ← 800×520, opaque (PRIORITY 3)
│   └── counter-interior.png    ← 800×520, opaque (PRIORITY 3)
└── items/
    ├── produce.png             ← 32×32, transparent (PRIORITY 4)
    ├── dairy.png               ← 32×32, transparent (PRIORITY 4)
    ├── meat.png                ← 32×32, transparent (PRIORITY 4)
    ├── seafood.png             ← 32×32, transparent (PRIORITY 4)
    ├── frozen.png              ← 32×32, transparent (PRIORITY 4)
    ├── canned.png              ← 32×32, transparent (PRIORITY 4)
    ├── dry_goods.png           ← 32×32, transparent (PRIORITY 4)
    ├── condiments.png          ← 32×32, transparent (PRIORITY 4)
    ├── beverages.png           ← 32×32, transparent (PRIORITY 4)
    ├── snacks.png              ← 32×32, transparent (PRIORITY 4)
    ├── bakery.png              ← 32×32, transparent (PRIORITY 4)
    └── other.png               ← 32×32, transparent (PRIORITY 4)
```

**Total: 21 PNG files** (4 priority levels, start with Priority 1)

The code will work without any PNGs — CSS fallback backgrounds fill in. Drop PNGs in as you generate them and they'll appear immediately on next page load.
