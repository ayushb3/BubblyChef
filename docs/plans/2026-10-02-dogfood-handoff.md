# Dogfood handoff, 2026-10-02

BubblyChef is paused while Ayush works on something else. This is what to pick
up first, from today's dogfooding round. Links go to GitHub. "Issue" and "PR"
are stated every time because the numbers look alike.

## 1. On hold (cost decision, Ayush)

| Item | What it means |
|---|---|
| [Issue #889](https://github.com/ayushb3/BubblyChef/issues/889), *Preload meal expansion and side alternatives (on hold: spends Gemini quota)* | Start the dish-expansion and side-alternative model calls before the user taps, so opening a meal feels instant. It spends Gemini quota on options nobody picks. Ayush said "no for now". Do not build it without his yes. |

## 2. Ayush's design work, then a build

**Kitchen decorations redesign (Claude Design).** Today's decoration stickers sit
on top of the scene image instead of feeling part of it. The goal is fixed spots
on real surfaces (shelves, counter, wall hooks, windowsill), in the same pixel
style, with contact shadows and depth ordering. Build it after his design lands.
Claude offered to write a design brief for it; he has not asked for one yet.

## 3. Unanswered question

**Kitchen-scene idle animations** (steam, a blinking Bubbly). Not decided. What
exists today:

- `PixelBubbles` breathes and walks.
- The header mascot bobs at rest and flips on tap ([PR #899](https://github.com/ayushb3/BubblyChef/pull/899)).
- The chat thinking indicator is a two-frame flip-book ([PR #896](https://github.com/ayushb3/BubblyChef/pull/896)).

## 4. Known gaps, unfiled

None of these has a GitHub issue yet. File them when someone picks them up.

- On an active cook card, other running timers can only be ended from the dock.
  Explicitly out of scope in [PR #895](https://github.com/ayushb3/BubblyChef/pull/895).
- Meals have no favorite concept, so the Favorites heart is disabled on the Meals
  tab ([PR #908](https://github.com/ayushb3/BubblyChef/pull/908)).
- `ai-service/bubbly_chef/workflows/recipe/nodes.py` has a duplicate recent-titles
  fetch helper; it could share the meal one.
- `fetchRecipeCookMeta` still uses `?limit=100`.
- A stale recipe cook session can mislabel unattributed timer chips.

## 5. Prompt changes not checked against live Gemini

These were tested with mocks and fakes only. Spot-check them in real use.

- [PR #897](https://github.com/ayushb3/BubblyChef/pull/897) (issue #891): nudge so the model emits `depends_on` correctly for preheats.
- [PR #898](https://github.com/ayushb3/BubblyChef/pull/898) (issue #892): spice and pinch units in the dish-expansion prompt.
- [PR #899](https://github.com/ayushb3/BubblyChef/pull/899) (issue #894): the assistant persona is now called Bubbly.

## 6. Real-device checks pending

- Chat band under the Cooking now banner ([PR #902](https://github.com/ayushb3/BubblyChef/pull/902), issue #900). Only simulated in Playwright.
- The iOS keyboard against `useChatViewportLock`.
- The opt-in timer chime on an iPhone (issue #848).

## 7. Usage tracking

```bash
bash ~/.claude/bubblychef-orchestrator/usage/digest.sh <email> 7   # read-only
```

Ayush's own account showed no recent activity because he was using guest mode.
Sign in with a real account to see it.

## 8. Older open PRs not owned by this round

| PR | Meaning |
|---|---|
| [PR #639](https://github.com/ayushb3/BubblyChef/pull/639), *docs(lessons): curate 20 proposed lesson(s)* | Nightly curation of lessons for `docs/agents/lessons.md`. Needs a human read before merge, since it steers every agent run. |
| [PR #558](https://github.com/ayushb3/BubblyChef/pull/558), *feat(skills): backlog-triage* | A `/backlog-triage` skill that clears the `needs-triage` pile in one sitting onto a sign-off board. |
| [PR #532](https://github.com/ayushb3/BubblyChef/pull/532) (draft), *db(v1): guest-cleanup cron job (migration 00012)* | Deletes stale anonymous accounts in production. Held until the 30-day rule is confirmed and the dry run checked. |
| [PR #421](https://github.com/ayushb3/BubblyChef/pull/421) (draft), *docs: architecture explainer* | Checks in the "two services, one database" explainer as a standalone HTML page. |

## 9. Shipped today, for context (all merged)

| PR | Issue | One line |
|---|---|---|
| [PR #893](https://github.com/ayushb3/BubblyChef/pull/893) | [#888](https://github.com/ayushb3/BubblyChef/issues/888) | Cuts avoidable database work around the model call when opening a meal or adding a side. |
| [PR #895](https://github.com/ayushb3/BubblyChef/pull/895) | [#890](https://github.com/ayushb3/BubblyChef/issues/890) | A cook step waiting on a running timer always offers Start now; the timer keeps ticking. |
| [PR #896](https://github.com/ayushb3/BubblyChef/pull/896) | [#887](https://github.com/ayushb3/BubblyChef/issues/887) | Waiting states for opening a meal and adding a side; thinking Bubbly is a flip-book. |
| [PR #897](https://github.com/ayushb3/BubblyChef/pull/897) | [#891](https://github.com/ayushb3/BubblyChef/issues/891) | Prep steps run during a preheat; only steps that use the oven wait for it. |
| [PR #898](https://github.com/ayushb3/BubblyChef/pull/898) | [#892](https://github.com/ayushb3/BubblyChef/issues/892) | Spices keep their units ("Cinnamon, to taste") instead of "0.25 count". |
| [PR #899](https://github.com/ayushb3/BubblyChef/pull/899) | [#894](https://github.com/ayushb3/BubblyChef/issues/894) | One header on Chat, Recipes and Scan; the mascot is Bubbly, the currency stays bubbles. |
| [PR #902](https://github.com/ayushb3/BubblyChef/pull/902) | [#900](https://github.com/ayushb3/BubblyChef/issues/900) | No dead band under the Cooking now banner; Jump to latest is a bare pill. |
| [PR #903](https://github.com/ayushb3/BubblyChef/pull/903) | [#901](https://github.com/ayushb3/BubblyChef/issues/901) | Ingredient amounts read like a recipe: no "count", plural units, fractions. |
| [PR #908](https://github.com/ayushb3/BubblyChef/pull/908) | [#904](https://github.com/ayushb3/BubblyChef/issues/904) | Search on the library's Meals tab; Favorites becomes a heart key. |
| [PR #909](https://github.com/ayushb3/BubblyChef/pull/909) | [#906](https://github.com/ayushb3/BubblyChef/issues/906) | Every notification can be dismissed; chat header order is New Chat, bell, profile. |
| [PR #910](https://github.com/ayushb3/BubblyChef/pull/910) | [#905](https://github.com/ayushb3/BubblyChef/issues/905) | The cook nudge opens a suggestion chat; Scan header loses Cancel. |
| [PR #911](https://github.com/ayushb3/BubblyChef/pull/911) | [#907](https://github.com/ayushb3/BubblyChef/issues/907) | The bubbles balance moves into the kitchen scene's top-right corner. |

Issues #887, #888, #890, #891, #892, #894, #900, #901, #904, #905, #906 and #907
are all closed by the PRs above.
