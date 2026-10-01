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
