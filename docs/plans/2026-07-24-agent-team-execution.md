# Agent Team Execution Plan

*Date: 2026-07-24 · Status: proposed · Companion to `2026-07-24-autonomous-operations.md`*

How work actually gets spawned, staffed, and merged — per stage, with the
specific roles and gates for each.

---

## 1. Fixing skills in cloud sessions

### Why they're missing

Claude Code discovers skills from files on disk:

| Location | Scope | Survives a fresh clone? |
|---|---|---|
| `.claude/skills/<name>/SKILL.md` | Project | **Yes — it's in git** |
| `~/.claude/skills/<name>/` | User / machine | **No** |
| `skills-lock.json` | Manifest only | No — it's a pointer, not content |

BubblyChef's 12 skills exist only as *entries in the lockfile*. No `SKILL.md`
files are committed. A cloud session clones the repo, finds nothing, and every
`/skill` invocation silently does nothing.

**Live proof in this very session:** `nextjs/.claude/skills/supabase-postgres-best-practices/SKILL.md`
*is* committed — and it loaded automatically on first read of a `nextjs/` file.
One skill works in the cloud; the other twelve don't. The only difference is
whether the file is in git.

### The fix

Commit the resolved skill content, don't just reference it:

```
.claude/skills/
├── implement/SKILL.md
├── code-review/SKILL.md
├── to-spec/SKILL.md
├── to-tickets/SKILL.md
├── wayfinder/SKILL.md
├── triage/SKILL.md
├── tdd/SKILL.md
├── diagnosing-bugs/SKILL.md
├── research/SKILL.md
├── domain-modeling/SKILL.md
├── codebase-design/SKILL.md
├── handoff/SKILL.md
├── grill-with-docs/SKILL.md
├── improve-codebase-architecture/SKILL.md
└── resolving-merge-conflicts/SKILL.md
```

This is the rule `WORKFLOW.md` §5 already states for role files — *"committed to
the repo, never gitignored. A workflow that disappears on a fresh clone doesn't
survive switching machines."* Skills need the same treatment; they were simply
missed.

`skills-lock.json` stays as the provenance record (source + hash), so
`setup-matt-pocock-skills` can still detect upstream drift.

### Upstream realignment

Adopt the renames, add the missing six:

| Action | Skills |
|---|---|
| **Rename** | `to-prd`→`to-spec`, `to-issues`→`to-tickets`, `zoom-out`→`wayfinder`, `diagnose`→`diagnosing-bugs` |
| **Add** | `implement`, `code-review`, `codebase-design`, `domain-modeling`, `handoff`, `research` |
| **Keep** | `tdd`, `triage`, `grill-with-docs`, `improve-codebase-architecture`, `setup-matt-pocock-skills` |
| **Drop or justify** | `caveman`, `write-a-skill` — not referenced anywhere in `WORKFLOW.md` |

Then reconcile so `skills-lock.json`, `WORKFLOW.md` §9, and `.claude/skills/`
all name the same set. Three sources of truth is the current state; one is the
target.

### The ported skills

`interrogate`, `thermo-nuclear-code-quality-review`, `how`, `why`,
`blast-radius` live at `~/Code/.agents/skills/`. Same problem, no upstream
installer. Two options:

- **Vendor them in-repo** alongside the rest — they then work everywhere.
- **Downgrade the docs** to say these are local-only and don't run in CI or
  cloud sessions.

Recommend vendoring. `WORKFLOW.md` §7 currently promises a three-layer review
that in practice is one layer anywhere but your laptop.

---

## 2. Team shape

Roles are already defined in `docs/agents/roles/`. Restating only the spawn
rules:

- **PM** = the session you're talking to. Delegates, never explores the codebase
  itself.
- **Dev roles** = `backend`, `frontend`, `ui-ux`, `qa-reviewer`, spawned as
  subagents.
- **One level deep, hard cap.** Dev roles don't spawn further subagents. If a
  task wants to fan out, the ticket was sliced too big.
- **Parallel where ownership doesn't overlap.** Two agents touching
  `ai-service/` and `nextjs/` respectively can run concurrently; two agents both
  editing `RecipeBook.tsx` cannot.

---

## 3. Stage-by-stage staffing

### Stage 0 — CI + skills *(do first, blocks everything)*

| | |
|---|---|
| **Agents** | 1 × `backend` (CI config + skills vendoring) |
| **Parallel** | No — single small change |
| **Work** | Add `mypy --strict` job; land PR #59; wire Playwright per #55; vendor `.claude/skills/`; realign lockfile + `WORKFLOW.md` §9 |
| **Verify** | Introduce a deliberate type error → CI must fail. Invoke a vendored skill in a fresh session → must load. |
| **Gate** | Human review (touches CI config) |

### Stage 1 — Land the UI overhaul stack

| | |
|---|---|
| **Agents** | 1 × `qa-reviewer` (audit), then 1 × `frontend` (conflict resolution) |
| **Parallel** | No — sequential, the audit informs the merge |
| **Work** | Audit `feat/ui-overhaul` for staleness against 2 months of `main`; resolve conflicts; merge #74 then #119/#120/#121; apply migration `00006` to prod Supabase |
| **Risk** | 44 files across every ownership boundary. Time-box the audit to ~2 days; if it exceeds that, land behind the theme picker as opt-in and fix forward. |
| **Gate** | Human review — feature-level, crosses all boundaries |

### Stage 2 — Backlog sweep

| | |
|---|---|
| **Agents** | 1 × `pm` running `/triage` |
| **Work** | Close the ~30 UI children Stage 1 resolved; re-label the rest |
| **Gate** | None — labels and closures only, fully reversible |

### Stage 3 — PWA shell

| | |
|---|---|
| **Agents** | 1 × `frontend` |
| **Work** | `manifest.json`, maskable icons, service worker (app-shell cache + offline page), install prompt, Web Push subscription scaffolding (no sends) |
| **Gate** | Sub-PR — autonomous merge on green CI |

### Stage 4 — Kitchen art spike *(human decision point)*

| | |
|---|---|
| **Agents** | 1 × `ui-ux` running `/wayfinder` |
| **Work** | Present licensed tileset options; **human picks**; produce room background + 4 furniture sprites + Bubbles walk cycle |
| **Gate** | Human — licence and art direction are judgment calls |

### Stage 5 — Kitchen room *(the fun one)*

| | |
|---|---|
| **Agents** | 3 × `frontend` in parallel after a shared scaffold lands |
| **Sequencing** | **5a** (solo): room scaffold, two-band layout, `image-rendering: pixelated`, asset loading. Then in parallel: **5b** tap zones + navigation · **5c** Bubbles NPC walk cycle + moods · **5d** ambient state (fridge fullness, expiry glow, counter dishes) |
| **Why 5a is solo** | All three parallel slices import the same scaffold. Landing it first avoids three agents inventing three different layouts. |
| **Verify** | Playwright screenshots committed to `docs/media/`, linked from each PR — this is how `prove-it-works` survives an unattended run |
| **Gate** | Sub-PR each; the `HeroHome.tsx` deletion is the feature-level PR |

### Stage 6 — Progression engine

| | |
|---|---|
| **Agents** | 1 × `backend` (ledger + XP/streak logic), then 1 × `frontend` (HUD) |
| **Work** | `00007_kitchen_events`, `00008_kitchen_progress`, RLS, event emission from existing write paths, level/streak computation with the grace-day rule |
| **Gate** | **Feature-level** — schema migrations are the one thing here that's expensive to undo |

### Stage 7 — Provider bake-off

| | |
|---|---|
| **Agents** | 1 × `backend` running `/research` |
| **Work** | Implement GLM + Claude providers against the existing `AIProvider` ABC; run `tests/test_intent_classification.py` snapshots against each; score accuracy, structured-output failure rate, latency, cost |
| **Note** | **The abstraction already exists** — `ai/provider.py` defines `AIProvider` with `complete` / `vision_complete` / `stream_complete` / `is_available`, and `AIManager` already does ordered fallback. Each new provider is ~150 lines implementing that ABC. No refactor needed; do not let an agent "improve" the abstraction as part of this. |
| **Gate** | Human picks the winner from the report |

### Stage 8 — Kitchen evolution + Living Bubbles

| | |
|---|---|
| **Agents** | 1 × `frontend` (decorations render, room tiers, unlock moment) ‖ 1 × `backend` (BubblesContext builder, daily-line generation + cache + templated fallback) |
| **Parallel** | Yes — clean split across `nextjs/` and `ai-service/` |
| **Gate** | Feature-level |

### Stage 9 — Push notifications *(human)*

| | |
|---|---|
| **Agents** | 1 × `frontend`, human-supervised |
| **Why human** | Sends external messages. House rule `never-block-on-the-human` explicitly exempts irreversible/outbound actions. |
| **Gate** | Human |

---

## 4. Autonomous merge — with probation

Confirmed: sub-PRs merge autonomously once CI is green.

**But not from day one.** Run the first ~5 sub-PRs with auto-merge *disabled*,
confirm each would have been safe to merge, then switch it on. The cost of being
wrong here is a bad merge to `main`; the cost of waiting is five manual clicks.

Auto-merge stays **off** until Stage 0 lands — merging on a CI signal that
doesn't run `mypy` is automating the breakage rather than the work.

---

## 5. Parallelism summary

| Stage | Agents | Parallel? |
|---|---:|---|
| 0 · CI + skills | 1 | — |
| 1 · UI overhaul | 2 | Sequential |
| 2 · Triage sweep | 1 | — |
| 3 · PWA | 1 | — |
| 4 · Art spike | 1 | — |
| 5 · Kitchen | 1 then 3 | **Yes**, after scaffold |
| 6 · Progression | 2 | Sequential |
| 7 · Bake-off | 1 | — |
| 8 · Evolution + Bubbles | 2 | **Yes** |
| 9 · Push | 1 | — |

Peak concurrency is 3, at Stage 5. That's deliberate — beyond three parallel
agents on one repo, merge-conflict overhead outweighs the speedup on a codebase
this size.

---

## 6. Stop conditions

Any agent halts and escalates on:

- Same CI failure twice after two fix attempts
- Work requiring edits outside its role's ownership boundary
- A schema migration not named in the ticket
- A `/code-review` finding that can't be fixed without changing the spec
- Any destructive git operation
- No `ready-for-agent` issue available — **stop, don't invent work**
