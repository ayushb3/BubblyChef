# Milestone demos

One phone-sized recording per goal of the signature PRD
(`docs/plans/2026-09-29-signature-prd.md`). Each was recorded on a production
build against the hosted database as the e2e test user, at 390x844, with
human-paced taps. Every write was reverted afterwards. The captions are drawn
by the recording script, not the app, and there is no sound.

These are compressed copies (390 px wide). Per-ticket demos and the full-size
originals live outside the repo. The older per-flow recordings are one level up,
in [`demos/`](../README.md).

## Regenerating

These are not scripted in the repo, unlike the flow recordings in `demos/`. Each was
a one-off Playwright run (`recordVideo` with human-paced taps and overlaid
captions), recorded by an agent in its session scratchpad and then restored
against a snapshot of the e2e user's rows. To re-record one, follow the scenes
listed below on a production build (`scripts/dev/stack.sh up`) with the same
viewport, then shrink it for the repo:

```bash
ffmpeg -i <recording>.mp4 -vf "scale=390:-2" -c:v libx264 -preset slow -crf 30 -an -movflags +faststart demos/milestones/<name>.mp4
```

| Goal | File | Length | Recorded |
|---|---|---|---|
| 1. Dinner, planned (the meal engine) | [goal1-dinner-planned.mp4](goal1-dinner-planned.mp4) | 3:30 | 2026-09-30 |
| 2. The kitchen is the app | [goal2-kitchen.mp4](goal2-kitchen.mp4) | 5:41 | 2026-10-01 |
| 3. It looks like nothing else (signature components) | [goal3-signature.mp4](goal3-signature.mp4) | 2:46 | 2026-10-01 |
| Showcase tour (the README demo) | [bubblychef-tour.mp4](bubblychef-tour.mp4) | 1:46 | 2026-10-02 |

## Goal 1: Dinner, planned

Chat, then meal options as cards, then a meal (a main and up to two sides),
then a recipe card per dish and the interleaved timeline, then the cook-along,
then a single pantry deduction at the end.

## Goal 2: The kitchen is the app

| Time | Scene |
|---|---|
| 0:00 | Home: the dollhouse kitchen wall with real counts and expiring tags; Bubbles walks to the fridge because food is wilting |
| 0:13 | Fridge storage sheet: Scene view, "Use first", search across places, tabs with counts |
| 0:40 | List view: cook / used it / tossed, then a bulk move to the Basket |
| 1:17 | Scan (mocked receipt), then put-away over the kitchen: "Did I read these right?", +N badges, skipped lines |
| 2:00 | Put away 14 items: each hops into its place, +33 bubbles |
| 2:21 | The Bubbles card: mealtime, tip, expiring, planned-tonight and empty-pantry cases |
| 3:28 | Guided cook, then home: Bubbles at the stove, "Back to the ... step 3 of 10" |
| 4:56 | Decorations and themes: claim the Kettle, Night Kitchen theme |
| 5:27 | Old `/pantry` links redirect into the kitchen |

## Goal 3: It looks like nothing else

| Time | Scene |
|---|---|
| 0:00 | Home with the pixel Bubbles counter; the theme picker (PixelSheet) |
| 0:15 | Chat: "what's for dinner tonight?" (live Gemini) shows meal options as recipe cards |
| 0:34 | The picked meal: servings, Serve at, dish cards with In pantry tags, interleaved timeline, "2 to buy" |
| 1:16 | Recipe page, then save the meal |
| 1:37 | Cook-along: Now card, Next up, per-dish progress, Ask Bubbles sheet, timers finishing |
| 2:22 | Recipe library and the Meals tab |
| 2:26 | Pantry rescue ("Used it"), then the counter ticking up on Home |

## Showcase tour

A short end-to-end tour for the root README: scan, chat, a meal, cook-along, deduction, grocery, library. Unlike the goal recordings it ran on a **production build with every AI call and every `/api/*` call mocked in the browser** (canned responses, no Gemini, no hosted-database writes; the AI service was not running). The receipt image is the repo fixture `nextjs/e2e/fixtures/receipts/grocery-mart.png`; the 8 scanned items match it. Timers were skipped ahead by shifting `Date.now`. Recorded at 390x844, 1:46, 1.7 MB, shrunk with `scale=390:-2 -crf 28`. The recording script was throwaway and is not in the repo.

| Time | Scene |
|---|---|
| 0:00 | Kitchen home: the pixel dollhouse wall, expiring tags, bubbles balance |
| 0:05 | Fridge storage sheet: use-first items, Scene and List views |
| 0:11 | Scan a receipt (Grocery Mart), then the put-away review over the kitchen; nothing is written until "Put away 8 items" |
| 0:25 | Chat: "What's for dinner tonight?" returns three meal options as cards |
| 0:34 | Pick a meal: the waiting card, then the meal with its dishes; Open meal shows one interleaved timeline |
| 0:44 | Cook-along: Done, Start now, timers in the dock, hands-off steps finishing, "Dinner's ready" |
| 1:14 | Mark meal as cooked: the Update pantry review, then "Pantry updated!" |
| 1:23 | "Add to grocery list" for the missing lemon, then the grocery list (ran-out items included) |
| 1:30 | Recipe library: search, favorite a recipe, the Favorites filter |
| 1:41 | Back in the kitchen: stock updated, bubbles earned |
