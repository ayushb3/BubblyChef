# Kitchen scene: Nano Banana prompt pack (v1)

**Goal:** every image the home-screen kitchen loads, in the same style as Bubbles, so
the scene looks like one world. That means 4 backgrounds, 24 decorations and 1 optional
pill icon. The list, with sizes and file names, is [`MANIFEST.md`](MANIFEST.md), which is
generated from the app code. This pack follows `art/PROMPTS.md` (Bubbles) and reuses
what worked there:

- **Guides, not descriptions.** Image models can't place or rotate things reliably from
  words, but they trace a guide well. Every prompt here is drawn over a guide image that
  `scripts/art/kitchen.py guides` generates from the slot map: a dashed box for each
  sticker, and a colour blockout of the room for the backgrounds.
- **Variants are EDITS of an approved base.** The three extra themes are edits of the
  approved pastel kitchen. The body of the room is never redrawn.
- **One asset per new chat.** Context from earlier generations makes the model drift.
- **Magenta for green subjects**, green for everything else. The manifest says which.
- **Subject alone.** No shelf, counter or floor under a sticker. The background has
  those, and a drawn-in shelf can't be cut out.
- **One shared frame per slot.** Every candidate for a slot is cut to the same box, so
  they all sit at the same scale and on the same line (like `art/bubbles/expressions/FRAME.txt`).

---

## How Ayush runs this

### 0. One-time setup (2 minutes)

```bash
python scripts/art/kitchen.py guides      # writes art/guides/kitchen/*.png
python scripts/art/kitchen.py manifest    # prints the asset list (same as MANIFEST.md)
```

The script only needs Pillow and numpy (the same as `scripts/art/cutout.py`). It reads
the kitchen code from `origin/main` when it isn't in your checkout, so `git fetch` first.

### 1. Order of work

| Step | What | Chats | Why this order |
|---|---|---|---|
| 1 | `style_anchor` | 1 | Every later prompt attaches it |
| 2 | `pastel` background, then cut it and preview with `--boxes` | 1 | The layout must line up before anything is placed on it |
| 3 | `cozy_cottage`, `night_kitchen`, `seasonal` | 3 | Edits of the approved `pastel` |
| 4 | Decorations, slot by slot, the two candidates for a slot back to back | 24 | Doing a slot's pair together keeps their scale matched |
| 5 | `bubbles_balance_icon` (optional) | 1 | The 🫧 emoji already works |
| 6 | Cut everything, preview, refresh the manifest, commit | 0 | |

### 2. Every sticker (decoration or icon) chat, step by step

1. Open a **new chat** in the Gemini app with the image model (Nano Banana).
2. Attach, in this order:
   1. `art/kitchen/style-anchor.png`
   2. the guide named in the asset's section, from `art/guides/kitchen/`. The file name
      says the background colour, for example `slot-window_sill-magenta.png`.
   3. *(second candidate for a slot only)* the first candidate's approved source from
      `art/kitchen/source/`, and add this line after the prompt: `Image 3 is another
      sticker for the same spot: match its size in the box and its line weight.`
3. Paste the **Sticker style block** (below), then the asset's prompt block.
4. Generate 2–4. One or two follow-up tweaks in the same chat are fine. If it's still
   off after that, start a new chat. Never edit an edited result.
5. Download the best one **at full size** and save it as
   `art/kitchen/source/<asset_id>.png`, using the asset ID exactly as written (a `.jpg`
   download is fine, just keep its extension).
6. Cut it straight away and read any warnings (table below):
   ```bash
   python scripts/art/kitchen.py cut <asset_id>
   ```

### 3. Backgrounds

- **`pastel`:** new chat. Attach `art/kitchen/style-anchor.png`,
  `art/kitchen/backdrop-style-test.jpg` (the approved backdrop style) and
  `art/guides/kitchen/scene-layout.png`, in that order. Paste its prompt. Save it as
  `art/kitchen/source/pastel.png`, then run:
  ```bash
  python scripts/art/kitchen.py cut pastel
  python scripts/art/kitchen.py preview --theme pastel --boxes
  ```
  Open `art/kitchen/preview/pastel.png`. The pink boxes are the slots. The shelf,
  sill and worktop must meet the **bottom** of their boxes, the rail and the hook must
  meet the **top** of theirs, and the top-right corner must be plain. If they're more
  than a few pixels off, re-roll (or ask for "move the shelf down to …").
- **The other three:** one new chat each. Attach **only** `art/kitchen/source/pastel.png`,
  paste the Background edit block and then that theme's line. Save as
  `art/kitchen/source/<theme>.png`, cut, and preview.

### 4. Cutting, previewing and finishing

```bash
python scripts/art/kitchen.py cut                    # every asset that has a source
python scripts/art/kitchen.py cut sill_herbs         # one asset
python scripts/art/kitchen.py cut plant_ivy --fit    # the model ignored the box: trim + fit + anchor instead
python scripts/art/kitchen.py cut sill_herbs --src ~/Downloads/Gemini_Image.png   # straight from a download
python scripts/art/kitchen.py preview --theme night_kitchen --pick shelf_cookbooks art_clock
python scripts/art/kitchen.py manifest --write --status   # Status column: todo / raw / cut
python scripts/art/kitchen.py check                  # every asset has a prompt; manifest is current
```

- **Input:** `art/kitchen/source/<asset_id>.{png,jpg,jpeg,webp}`, the raw download.
- **Output:** `art/kitchen/export/{themes,decorations,ui}/<asset_id>.png`. Stickers are
  transparent PNGs at exactly the manifest's pixel size. Backgrounds are cropped to 4:3
  and sized to 1125x844.
- **Preview:** `art/kitchen/preview/<theme>.png`, the whole scene with one decoration
  per slot (the first one that's been cut, or whichever you `--pick`), plus the 🫧 pill.
  This folder is git-ignored.
- Commit `art/kitchen/source/`, `art/kitchen/export/` and the refreshed `MANIFEST.md`
  on the art branch. Issue #527 copies the exports into the app (see the swap-in notes
  at the end).

What the cut warnings mean:

| Message | What happened | Fix |
|---|---|---|
| `corners are still opaque: the background isn't magenta` | Generated on the wrong colour | Re-roll with the colour the manifest gives |
| `N% of the subject is outside the frame` | It spilled past the dashed box, so the spill gets clipped | Follow up with "keep everything inside the dashed box", or `cut <id> --fit` |
| `a line runs along the frame's … edge: guide line left in?` | The model kept part of the guide | Follow up with "remove the dashed box and every guide line" |
| `subject fills only 40% x 35% of the frame` | Drawn too small, so it will look small in the slot | Follow up with "make it bigger, filling the dashed box" |
| `source is 1024x1536, not square` | Output aspect didn't follow the guide, so it used `--fit` | Usually fine, check the preview |

---

## Sticker style block (paste before every decoration and icon prompt)

```
Image 1 is the style reference for my app's kitchen stickers. Image 2 is a GUIDE: a
dashed box on a flat background colour.

Draw ONE object (described below) as a kawaii sticker in EXACTLY the style of image 1:
- Thick, smooth, uniform outline in soft charcoal-brown #4a3a33, the same line weight
  as image 1, with rounded line ends.
- Flat pastel fills with at most one soft shading tone and one small glossy highlight
  at the upper left. No gradients, no textures, no realistic lighting, no glow, no drop
  shadows.
- Palette: pastel pink #ffb5c5, mint #b5ead7, lavender #c9b5e8, peach #ffdab3,
  coral #ff9aa2, cream #fff9f5, sky blue #a8d8f0, honey wood #e8a87c.
- Straight-on front view with a very slight top-down tilt, like a dollhouse prop.
  Soft, round, chunky shapes.

Guide rules:
- Draw the object INSIDE the dashed box, as big as it can be: it fills the box.
- A SOLID edge on the box is where the object rests. A solid bottom edge: it stands on
  that line. A solid top edge with a small circle: it hangs from that circle.
- In the final image REMOVE the box, the solid line, the circle and every guide mark.
- Keep the guide's flat background colour edge to edge, exactly (pure green #00ff00 or
  pure magenta #ff00ff). Nothing else behind or under the object: no shelf, counter,
  table, floor, wall or shadow.
- No text, letters, numbers, watermark or border.
```

---

## Step 1: style anchor

### `style_anchor`
Attach: `art/bubbles/source/happy-base-2000.png`, `art/kitchen/basil-style-test-green.jpg`,
`art/kitchen/backdrop-style-test.jpg`. Save as `art/kitchen/style-anchor.png` (not cut,
not shipped).

```
Image 1 is my mascot Bubbles, image 2 an approved kitchen item and image 3 an approved
empty kitchen, all in my app's art style. Make a STYLE REFERENCE SHEET for the kitchen
decorations in exactly this style.

Four small kitchen objects in one row, evenly spaced, at the same scale, each standing
on its own with clear space around it:
1. a glass jam jar with a pink gingham cloth lid tied with a ribbon,
2. a round lavender cookie jar with a heart-shaped knob,
3. a salt and pepper pair, one peach and one cream, with tiny dot faces,
4. a small milk bottle with a mint label and a peach cap.

Style: thick, smooth, uniform outline in soft charcoal-brown #4a3a33, the same weight as
Bubbles' outline; flat pastel fills with one soft shading tone and one small glossy
highlight at the upper left; palette pastel pink #ffb5c5, mint #b5ead7, lavender
#c9b5e8, peach #ffdab3, coral #ff9aa2, cream #fff9f5. Kawaii, Sanrio-like: soft, round,
chunky and a little toy-like.
No mascot, no shelf, no table, no floor, no shadows, no text or labels. A flat plain
cream (#fff9f5) background.
```

Check before moving on: the line weight matches Bubbles, and nothing is detailed or
realistic. If the model adds a shelf, follow up with "remove the shelf; the objects stand
on nothing".

---

## Step 2: backgrounds (one per kitchen theme)

The theme keys come from issue #523 (*Kitchen themes*, not built yet). If `themes.ts`
lands with different keys, `manifest --write` picks them up. Rename the files to match.

### `pastel`
Attach: `art/kitchen/style-anchor.png`, `art/kitchen/backdrop-style-test.jpg`,
`art/guides/kitchen/scene-layout.png`. Landscape 4:3. No keying.

```
Images 1 and 2 show my app's art style (image 2 is an approved empty kitchen). Image 3
is a colour blockout of the exact layout I need.

Redraw image 3 as a finished EMPTY kitchen in exactly the style of images 1 and 2: a
cozy pastel dollhouse kitchen seen straight-on, landscape 4:3, the same framing as
image 3. Keep every element exactly where it is in image 3, at the same size:
- the wooden wall shelf at the upper left: a plain empty plank on two small brackets,
- the small wall bracket with a hook below it on the left (for a hanging plant),
- the mint fridge in the centre-left, with two doors; the upper door plain and empty,
- the window at the upper centre-right, with an empty mint sill,
- the thin wooden rail at the upper right (for string lights),
- the long counter on the right: a honey-wood worktop, pink cabinet doors below with
  small round knobs,
- the peach wooden floor along the bottom.
Keep EMPTY: every surface (the shelf, the sill, the worktop and the top of the fridge),
the blank wall above the fridge, and the floor in the lower left and in front of the
fridge and the counter. No objects, food, plants, pictures, lights, stove, table or
mascot. Those are added later as separate stickers.
Keep the top-right corner of the wall plain: a score badge sits there.
Walls cream #fff9f5 with a soft pink skirting board. Outline soft charcoal-brown
#4a3a33, the same weight as image 1. Flat pastel fills with one soft shading tone; no
gradients, no textures. Through the window: a soft pastel sky and a round lavender-and-
mint tree. No text.
```

**Background edit block** (for the three below: new chat, attach only
`art/kitchen/source/pastel.png`, paste this, then the theme's line):

```
Edit this image. Keep the kitchen EXACTLY as drawn: the shelf, hook, rail, window,
fridge, counter and floor in the same place, at the same size, with the same outline.
Keep every surface and the top-right corner empty. Do not add any objects. Flat pastel
fills, no gradients, no glow.
Change ONLY the following:
```

### `cozy_cottage`
```
the colours and surfaces: a warm cottage kitchen. Walls in soft peach #ffdab3 with a
thin cream tile band just above the worktop; cabinet doors cream with coral #ff9aa2
knobs; the fridge cream; a small coral gingham curtain across the TOP half of the window
only (the sill stays clear); a warm golden-hour sky through the window.
```

### `night_kitchen`
```
the time of day: night. Through the window, a deep lavender-navy sky with a pale crescent
moon and three small stars. Walls, cabinets and fridge keep their colours but in a
cooler, dimmer, lavender-tinted version: still soft and pastel, cosy, not dark or scary.
No lamps, candles or light beams.
```

### `seasonal`
One season for v1; this pack picks **snowy winter**, the one that looks most different
from `pastel`. For spring, swap in: "cherry-blossom branches outside the window and a
few pink petals on the sill's outer edge; walls a slightly pinker cream".
```
the season: snowy winter. Through the window, gently falling snow and a snow-covered
round tree; a thin line of snow along the outside of the window frame. Walls pale sky
blue #a8d8f0 mixed with cream; cabinet doors lavender #c9b5e8; the fridge stays mint.
No garlands, presents or other decorations.
```

---

## Step 3: decorations

Each section shows: slot · target size · where it rests · **background colour** · guide
to attach. Paste the Sticker style block first, then the block. Anchors come from the
background: stickers on the shelf, sill and worktop stand on the box's solid bottom
line; plants and lights hang from the top.

> **Why the stove and table stickers include furniture.** The `stove_top` and `table`
> slots are in the bottom row, at floor level, so the background has no surface at the
> height of their bottom edges. Those four stickers bring a small freestanding stove
> or table with them, standing on the floor line. The rest follow the "subject alone"
> rule. (The other fix is to move those two slots in `slots.ts`: a layout call for
> #527 or later, not for the art.)

### `shelf_mugs`
`wall_shelf` · 236x219 · stands on the shelf · **green** · `slot-wall_shelf-green.png`
```
The object: three chunky mugs standing side by side in a row, in pink, lavender and mint,
at slightly different heights. The middle mug has a tiny smiling face with pink blush;
another has a small heart. Their bases rest on the solid bottom line. No shelf under them.
```

### `shelf_cookbooks`
`wall_shelf` · 236x219 · stands on the shelf · **green** · `slot-wall_shelf-green.png`
```
The object: a small stack of three chunky cookbooks lying flat, with peach, mint and
lavender covers, plus one more book standing upright beside the stack, leaning slightly.
The covers carry a simple heart or star shape: no letters, no titles. Resting on the
solid bottom line. No shelf under them.
```

### `art_painting`
`wall_art` · 236x219 · centred on the wall · **green** · `slot-wall_art-green.png`
```
The object: a framed picture for a kitchen wall, hanging straight, front view. A chunky
rounded honey-wood frame around a painting of a slice of strawberry shortcake on a soft
pink background (strawberries without green tops). A tiny nail and string at the top.
No text.
```

### `art_clock`
`wall_art` · 236x219 · centred on the wall · **green** · `slot-wall_art-green.png`
```
The object: a round kitchen wall clock, front view. A pastel pink rim, a cream face with
twelve small dots instead of numbers, two rounded hands at ten past ten, and a tiny happy
face in the middle. No numbers, no text.
```

### `sill_succulent`
`window_sill` · 236x219 · stands on the sill · **magenta** · `slot-window_sill-magenta.png`
```
The object: one plump succulent rosette in soft sage and pale green, with pink-tipped
leaves, in a little round cream pot with a pink stripe. The pot's base rests on the solid
bottom line. No sill or window under or behind it. Background flat pure magenta #ff00ff.
```

### `sill_herbs`
`window_sill` · 236x219 · stands on the sill · **magenta** · `slot-window_sill-magenta.png`
```
The object: three small terracotta pots in a row holding basil, mint and parsley, like
the basil pot in the style reference. The middle pot is a little taller and has a tiny
smiling face with pink blush. The pots' bases rest on the solid bottom line. No sill or
shelf under them. Background flat pure magenta #ff00ff.
```

### `lights_string`
`lights` · 253x127 (wide) · hangs from the rail · **green** · `slot-lights-green.png`
```
The object: a string of fairy lights hanging from the solid top line in two soft swags,
its ends tied at the two top corners of the box and the middle caught on the small circle.
Round bulbs in pale yellow, pink, lavender and peach on a soft charcoal-brown cord. No
glow or light rays: flat colours only, with a tiny white four-point sparkle beside two of
the bulbs.
```

### `lights_lantern`
`lights` · 253x127 (wide) · hangs from the rail · **green** · `slot-lights-green.png`
```
The object: three small round paper lanterns hanging at slightly different heights on
short cords from the solid top line, spread across the width of the box: coral, peach
and pink, each with thin ribs, a lavender cap and a small tassel. Flat colours, no glow.
```

### `plant_pothos`
`hanging_plant` · 236x219 · hangs from the hook · **magenta** · `slot-hanging_plant-magenta.png`
```
The object: a hanging planter, a round peach pot on three thin cords that meet at the
small circle at the top centre of the box. Heart-shaped pothos leaves (green with pale
yellow marbling) spill over the rim and trail down both sides to the bottom of the box.
Background flat pure magenta #ff00ff.
```

### `plant_ivy`
`hanging_plant` · 236x219 · hangs from the hook · **magenta** · `slot-hanging_plant-magenta.png`
```
The object: a small lavender pot in a cream macramé hanger whose cords meet at the small
circle at the top centre of the box. Long strands of small ivy leaves trail down both
sides almost to the bottom of the box. Background flat pure magenta #ff00ff.
```

### `fridge_magnets`
`fridge_door` · 236x219 · centred on the door · **green** · `slot-fridge_door-green.png`
```
The object: a loose cluster of six cute fridge magnets, flat, front view, a little
overlapping: a pink heart, a yellow lemon slice, a lavender star, a peach donut, a coral
strawberry (no leaves) and a sky-blue cloud with a tiny face. Just the magnets: no fridge,
no door.
```

### `fridge_drawing`
`fridge_door` · 236x219 · centred on the door · **green** · `slot-fridge_door-green.png`
```
The object: a child's crayon drawing on a sheet of white paper, slightly tilted, held at
the top by a round pink magnet. Wobbly crayon lines show a little pink house, a yellow
sun, a heart and a round white dumpling character in a blue chef hat (a doodle of
Bubbles). No green crayon, no writing or letters. Just the paper: no fridge.
```

### `counter_fruit_bowl`
`counter_left` · 236x219 · stands on the worktop · **magenta** · `slot-counter_left-magenta.png`
```
The object: a shallow round cream bowl with a pink rim, piled with fruit: two red apples
(one with a single green leaf), a banana, an orange and a small bunch of purple grapes.
The bowl's base rests on the solid bottom line. No counter under it. Background flat pure
magenta #ff00ff.
```

### `counter_kettle`
`counter_left` · 236x219 · stands on the worktop · **green** · `slot-counter_left-green.png`
```
The object: a chunky round stovetop kettle in lavender with a cream handle and a peach
knob on the lid, a tiny smiling face with pink blush, and a small puff of white steam
from the spout. Its base rests on the solid bottom line. No counter under it.
```

### `counter_cutting_board`
`counter_right` · 253x219 · lies on the worktop · **green** · `slot-counter_right-green.png`
```
The object: a round honey-wood cutting board lying flat, seen slightly from above, with a
small cute knife (cream handle, rounded blade) and four lemon slices on it. The board's
front edge rests on the solid bottom line. No counter under it.
```

### `counter_bread`
`counter_right` · 253x219 · stands on the worktop · **green** · `slot-counter_right-green.png`
```
The object: a round loaf of fresh bread with three scored lines and a tiny sleepy smile,
with a baguette leaning against it, both on a small folded pink gingham cloth. Resting on
the solid bottom line. No counter, no basket.
```

### `stove_kettle_pot`
`stove_top` · 236x236 · stands on the floor · **green** · `slot-stove_top-green.png`
```
The object: a small, chunky freestanding kawaii stove (cream body, a peach oven door with
a round window, two knobs) standing on the solid bottom line, with a lavender cooking pot
on top. The pot has a tiny happy face, and its lid is lifted slightly by three soft
white puffs of steam. Stove and pot together fill the box. No floor under it.
```

### `stove_pan`
`stove_top` · 236x236 · stands on the floor · **green** · `slot-stove_top-green.png`
Do this one second and attach `source/stove_kettle_pot.png` as image 3, so it's the same stove.
```
The object: the same small freestanding stove as image 3 (cream body, a peach oven door
with a round window, two knobs) standing on the solid bottom line, with a pink frying pan
on top holding one sunny-side-up egg, and two small white puffs of steam. Stove and pan
together fill the box. No floor under it.
```

### `table_teapot`
`table` · 236x236 · stands on the floor · **green** · `slot-table-green.png`
```
The object: a small round café table (honey-wood top, one pedestal leg with a round foot)
standing on the solid bottom line, with a tea set on top: a round pink teapot with a tiny
smiling face and two small cream teacups on lavender saucers. No floor under it.
```

### `table_flowers`
`table` · 236x236 · stands on the floor · **magenta** · `slot-table-magenta.png`
Do this one second and attach `source/table_teapot.png` as image 3, so it's the same table.
```
The object: the same small round café table as image 3 (honey-wood top, one pedestal leg)
standing on the solid bottom line, with a lavender vase of flowers on top: pink tulips,
peach roses and a few green leaves. No floor under it. Background flat pure magenta
#ff00ff.
```

### `rug_pastel`
`rug` · 236x236 · lies on the floor · **green** · `slot-rug-green.png`
```
The object: an oval rug lying flat on the floor, seen from the front and slightly above,
so it is a wide flat oval filling the lower half of the box with its front edge on the
solid bottom line. Soft pink with a lavender border, a small cream heart in the middle
and tiny tassels at both ends. Nothing on it, and no floor around it.
```

### `rug_stripes`
`rug` · 236x236 · lies on the floor · **green** · `slot-rug-green.png`
```
The object: a rectangular striped rug lying flat on the floor, seen from the front and
slightly above, so it is a wide flat shape filling the lower half of the box with its
front edge on the solid bottom line. Stripes in sky blue #a8d8f0, cream and lavender,
with a short fringe at both ends. Nothing on it, and no floor around it.
```

### `corner_cat_bed`
`floor_corner` · 253x236 · stands on the floor · **green** · `slot-floor_corner-green.png`
```
The object: Bubbles' bed, a round plush pet-style bed in pink with a puffy lavender rim,
a small cream pillow and a folded sky-blue blanket with white polka dots. Sized for a
small round mascot, but EMPTY: no character in it. Sitting on the solid bottom line, with
no floor under it.
```

### `corner_basket`
`floor_corner` · 253x236 · stands on the floor · **green** · `slot-floor_corner-green.png`
```
The object: a round woven wicker basket with two handles and a peach-and-cream gingham
cloth tucked inside, holding a few round potatoes and two onions. Sitting on the solid
bottom line, with no floor under it.
```

---

## Step 4: counter corner (optional)

### `bubbles_balance_icon`
Pill icon · 64x64 · centred · **green** · `ui-bubbles_balance_icon-green.png`. It
shows at about 14 CSS px, so keep it bold and simple.
```
The object: a single round soap bubble, used as a game-currency icon. A flat lavender
#c9b5e8 fill, a lighter sky-blue #a8d8f0 crescent along one side, a big white glossy
highlight at the upper left, and one tiny extra bubble touching it at the lower right.
Bold outline; no face, no text. Fills the dashed box.
```

---

## Swap-in notes for #527

Issue #527 (*swap in the final Bubbles + kitchen art*) does the code. This PR doesn't
touch `nextjs/`.

- **Where the files go.** Copy `art/kitchen/export/` into `nextjs/public/kitchen/`:
  `decorations/<id>.png` → `nextjs/public/kitchen/decorations/<id>.png`,
  `themes/<key>.png` → `nextjs/public/kitchen/themes/<key>.png`,
  `ui/bubbles_balance_icon.png` → `nextjs/public/kitchen/ui/bubbles_balance_icon.png`.
  The Bubbles expressions go from `art/bubbles/expressions/<state>.png` to
  `nextjs/public/mascot/bubbles-<state>.png`. The "Ships to" column in `MANIFEST.md`
  has every path.
- **How the placeholder rendering finds a decoration.** `KitchenScene.tsx` looks up each
  unlocked row in `CATALOG` (`lib/kitchen/catalog.ts`). If the entry has `art`, it renders
  `<Image src={decoration.art} fill sizes="120px" className="object-contain" />`;
  otherwise it renders the `emoji`. So the swap is a data change: set
  `art: '/kitchen/decorations/<id>.png'` on each catalog entry that has a file. Leave
  `art` unset for any ID without one: a set `art` pointing at a missing file shows a
  broken image, not the emoji.
- **Don't trim or pad in code.** Every PNG is exactly its slot's aspect at 3x, so
  `object-contain` fills the slot box and the sticker's bottom or top lands on the
  background's shelf, sill, worktop, rail or floor. `sizes="120px"` is fine: the files
  are 236–253 px wide, and next/image doesn't upscale.
- **Backgrounds.** The scene paints a CSS gradient from the app theme tokens today.
  Issue #523 adds `KITCHEN_THEMES[].background`; point it at
  `/kitchen/themes/<key>.png` and render it behind the slots as a `next/image` with
  `fill`, `object-cover` and `priority`. It's above the fold and probably the LCP
  element, so #527's LCP check applies.
- **App colour themes** (sakura, mint, lavender, yuzu, bluebell in `ThemePicker`) are
  separate from kitchen themes. Once the background is an image, the scene no longer
  follows the app colour. If that matters, a low-opacity `var(--color-primary)` overlay
  on the image brings it back without more art.
- **The 🫧 pill.** Swap the emoji in the `kitchen-bubbles-balance` pill for
  `/kitchen/ui/bubbles_balance_icon.png` at 14px with `alt=""` (it's decorative; the
  number carries the meaning).
- **Empty slots.** The white dashed placeholders were drawn for a gradient. They may
  look noisy on a real background; that's a #527 call.
- **Sizes.** Check that each decoration stays under ~60 KB (#527's budget). If a file
  is over, `pngquant` or a WebP export fixes it.

## Appendix: Bubbles' prop collectibles (v1.1, not in this pack)

Spatula, rolling pin, whisk, apron patterns and hats. Per Ayush's decision on #526
(2026-09-23), these ship in v1.1 as **layers** (a paper doll: body, apron, hat, held
prop, a paw-on-top overlay), not as redrawn Bubbles. Their prompts get written with that
work. Nothing here depends on them.
