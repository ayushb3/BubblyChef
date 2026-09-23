# Bubbles stylesheet — Nano Banana prompt pack (v1)

**Goal:** lock ONE art style that every future asset copies: the mascot, the kitchen
decorations and the kitchen backgrounds. This fixes issue #401 (mismatched mascot art) and
becomes the reference image for everything later.

**Anchor image:** `nextjs/public/mascot/bubbles-happy.png`, the "polished reference look".
Attach it to EVERY prompt below. When a result is good, attach that too from then on
(at most 2–3 references per prompt).

## How to run it (Gemini app, Nano Banana / latest image model)

1. Start a fresh chat. Attach `bubbles-happy.png`.
2. Paste the **Style block**, then one prompt. Generate 2–4 variants.
3. Keep the best one and download it at full size. Regenerate anything that drifts:
   line thickness, face placement, hat shape and blue shade are the usual drift points.
4. Stay in the same chat for prompts 1–4, so the model keeps the style in context.
5. Save outputs as `art/stylesheet/<nn>-<name>.png`. Don't worry about the green
   background; a script will cut it out later.

## Style block (paste before every prompt)

```
Art style — match the attached reference image EXACTLY:
- Kawaii sticker illustration, chibi proportions, soft and round.
- Thick, smooth, uniform outline in warm dark brown (#4a3a33), rounded line ends.
- Flat pastel fills with at most one soft shading tone and one small glossy highlight.
  No gradients, no textures, no realistic lighting, no drop shadows.
- Palette: cream body #fff4e0, sky-blue hat/apron #a8d8f0, blush #ffb5c5, plus accents
  from pastel pink #ffb5c5, mint #b5ead7, lavender #c9b5e8, peach #ffdab3, coral #ff9aa2.
- Background: one flat solid pure green (#00ff00), edge to edge, nothing else, no ground
  shadow — it will be removed. **Exception: if the subject is green (herbs, vegetables,
  plants, anything mint-leaf coloured), use flat solid magenta (#ff00ff) instead**, or the
  cut-out dulls or eats the green parts.
- The subject ALONE: no shelf, table, floor strip or scenery under or behind it.
- Clean, centered, generous margin around the subject. No text, no watermark, no border.
```

## Prompt 1 (v3, USE THIS): trace a construction guide

Image models don't reason in 3D. Asked to rotate a round character, they narrow it into
an egg, whatever the wording (v1 and v2 both did). The fix is to hand the model the geometry
and ask it to trace. Attach **two images**: `bubbles-happy.png` (the style) and
`bubbles-turnaround-guide.png` (five identical circles, eye dots, hat, apron line, feet,
all on shared guide lines).

```
Image 1 is my mascot Bubbles (the character and art style). Image 2 is an animation
construction guide: five views of Bubbles turning — front, three-quarter left, left
profile, three-quarter back, back.

Draw Bubbles over the guide, one view per circle:
- Trace each body circle EXACTLY. The body outline must match the guide circle's size and
  roundness in all five views. Do not make any view narrower, taller or egg-shaped: the
  body is a sphere, so every view is the same circle.
- Put the eyes exactly on the dark dots; views without dots show no eyes. Cheeks sit just
  below the eyes. In the left profile the eye sits on the very edge of the circle.
- Put the chef hat where the hat shapes are, the apron top on the horizontal line inside
  each circle, and the feet on the small ovals, standing on the bottom guide line.
- Same outfit as image 1: plain sky-blue hat and apron, no hearts, no props, empty paws.
- In the final image, REMOVE every guide line, circle and dot; only Bubbles remains,
  on a flat pure green (#00ff00) background.
```

**If the side view still drifts:** do it alone. Open a new chat, attach `bubbles-happy.png`
plus a crop of just the middle circle from the guide, and ask for "only the left
profile view" using the same rules. A single view is much easier for the model to hold.

## Prompt 1 (v2, superseded): Character turnaround — kept for reference

```
This is my mascot "Bubbles", a little chef dumpling. Draw an ANIMATION TURNAROUND MODEL
SHEET of Bubbles in the exact same style, as used by animators to keep a character
consistent while it rotates.

Five views in one row, evenly spaced: front, three-quarter left, side (left profile),
three-quarter back, back.

Construction rules (most important):
- Bubbles' body is a soft, slightly squashed SPHERE, like a mochi ball. The silhouette
  stays ROUND from every angle — the side view is as wide and as round as the front view,
  NOT a tall narrow egg.
- All five views stand on the same ground line and are exactly the same height. Draw
  faint horizontal guide lines through the top of the hat, the eyes, the apron top and
  the feet so the proportions visibly match across views.
- In the side view the face sits at the front edge of the sphere, wrapping around the
  curve: one eye and one cheek visible, the smile in profile. The chef hat sits centred
  on top and is seen in profile; the apron wraps around the belly, with the strap visible.
- The two little feet and small paws keep the same size and position in every view.

Design rules:
- NO PROPS. Empty paws, nothing held, nothing on the ground.
- Plain sky-blue apron with no hearts, patterns or pockets; plain sky-blue chef hat.
  Exactly the outfit in the reference image.
- Neutral, gentle smile in every view.
```

If the side view still comes out egg-shaped, follow up in the same chat with:
`Redo only the side view. Keep the body a round sphere exactly as wide as the front view;
the side view must not be narrower or taller than the front.`

## Prompt 2 (v2, USE THIS): expressions by EDITING the approved front view

A 6-pose grid drifted: taller bell body, flat shading, saturated blue, a bib apron. So each
expression is now an **edit** of the approved front view, which means the body, shading,
colours and outline are never redrawn.

**Rules:** one expression per **new chat**. Attach only `bubbles-front-edit-base.png`. Paste
the edit block, then one line from the list. One or two follow-up tweaks in the same chat
are fine; if it's still off after that, start a new chat from the base again. Never edit
an edited result.

Edit block (paste first every time):
```
Edit this image. Keep Bubbles EXACTLY as drawn: the same round sphere body, the same soft
shading and glossy highlight, the same pastel sky-blue hat and small apron (#a8d8f0 —
do not darken or saturate it), the same outline, the same size and position, the same
flat green background. Do not redraw the body or change the proportions.
Change ONLY the following:
```
Then one of these (HAPPY is the base image itself, no edit needed):
- **THINKING:** `the face — eyes looking up and to the side, small unsure mouth; one paw lifted to touch the cheek; a tiny white "…" thought bubble beside the hat.`
- **SURPRISED / EXCITED:** `the face — sparkly star-shaped eye highlights, small open happy mouth; both paws raised to the cheeks; a few small pale-yellow sparkles around the head.`
- **SAD:** `the face — droopy eyes, small frown, one small light-blue tear on the cheek; the hat tilted slightly to one side.`
- **CELEBRATING:** `the face — eyes closed in happy arcs, big smile; both paws raised up above the apron; a few confetti pieces around in pastel pink, mint, lavender and peach only.`
- **COOKING:** `the face — determined eyes with tiny eyebrows, small focused smile; both paws raised in front as if stirring an invisible pot; two tiny motion lines by the paws. No spoon or props.`

## Prompt 2 (v1, superseded): Expression set in a grid

```
Using the same Bubbles (plain apron, no hearts, NO PROPS in any pose), draw six separate poses in a 3x2 grid, same size, same style,
each clearly separated with space around it:
1. HAPPY — the reference pose (smile, rosy cheeks).
2. THINKING — eyes looking up, one paw on cheek, tiny "…" thought bubble.
3. SURPRISED / EXCITED — wide sparkly eyes, open mouth, little star sparkles.
4. SAD — droopy eyes, small tear, hat slightly tilted (used when food expires).
5. CELEBRATING — both paws up, eyes closed happy, confetti and sparkles.
6. COOKING — determined cute face, paws raised as if stirring an invisible pot (no props).
```

## Status (2026-09-23)
Approved: turnaround master, happy (base), thinking, surprised, celebrating, determined
(the 'cooking' prompt came out as a determined fist-pump — kept as `determined`).
Re-roll: SAD (hat grew ~1.3x and shifted — ask to keep the hat exactly the base size and
position, tilted only slightly). BASIL re-roll on magenta, pot only, no shelf.
Kitchen backdrop style test: approved.

## Prompt 3: Style test — one kitchen decoration

```
In exactly this art style (same outline, fills and highlight), draw a single kitchen
decoration with no mascot: a small terracotta pot of basil for a window sill.
Front-facing, slightly cute (tiny smile on the pot is fine). Same line weight as Bubbles.
```

## Prompt 4: Style test — kitchen backdrop

```
In exactly this art style, draw an EMPTY cozy pastel kitchen as a phone-screen backdrop,
portrait 9:16, straight-on front view (like a dollhouse wall, minimal perspective).
Include clearly EMPTY spots: a wall shelf, a window with an empty sill, a counter, a
fridge door, a patch of floor for a rug, a blank wall for a picture. No people, no mascot,
no food yet. Soft pastel walls (cream #fff9f5 with pink/mint accents). For this one only,
ignore the green-background rule: the kitchen IS the background.
```

## What to send back

The 4 winners (or screenshots of them). I'll check consistency, pick the final style
reference, and write the cut-out script. Prompt 4 is only a style test: the real
backgrounds and the full decoration list come after the kitchen layout is built with
placeholders.
