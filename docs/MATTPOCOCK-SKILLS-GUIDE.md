# Mattpocock Skills — Comprehensive Workflow Guide for Personal Projects

This guide explains the 12 mattpocock skills, their benefits, and how to use them together to create a clear, visual workflow for implementing personal projects.

---

## The Problem They Solve

When building software (especially solo projects), AI agents often:
- Misunderstand what you actually want
- Miss edge cases and architectural constraints
- Create code that conflicts with existing patterns
- Generate work items that aren't truly vertical slices
- Take shortcuts that create technical debt

The mattpocock skills prevent these by establishing **a shared language** between you and the agent before any coding begins.

---

## The Three Phases

```
┌─────────────────────────────────────────────────────────────┐
│  1. ALIGNMENT                                               │
│  Establish shared understanding + documentation             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. PLANNING                                                │
│  Break work into vertical slices with acceptance criteria   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. EXECUTION                                               │
│  Implement with immediate feedback + validate              │
└─────────────────────────────────────────────────────────────┘
```

---

## Skill Reference

### Phase 1: ALIGNMENT

#### `/setup-matt-pocock-skills`
**What it does**: Configures the repo for all other skills.

**Output**:
- `CONTEXT.md` — project domain glossary
- `docs/agents/` — issue tracker, triage labels, domain layout
- Updated `AGENTS.md` / `CLAUDE.md` with Agent skills block

**When to use**: Once, at project start. Re-run if switching issue trackers or restarting from scratch.

**Benefit**: All downstream skills know where to find domain terminology, issue tracker location, and documentation structure.

---

#### `/grill-with-docs`
**What it does**: Interview-style questioning to stress-test a plan against your existing domain model.

**Process**:
1. You describe a feature idea (e.g., "URL recipe import")
2. Agent asks **one question at a time** about design decisions
3. Agent challenges vague terminology against `CONTEXT.md`
4. Agent stress-tests with concrete scenarios
5. As you answer, agent **updates `CONTEXT.md` and `docs/adr/` inline**
6. By the end, you have a sharp, unambiguous design + updated documentation

**Example output**:
- Resolved terminology (e.g., "What exactly is a 'proposal' here?")
- Documented edge cases (e.g., "What if URL is behind a paywall?")
- Architecture ADRs created (e.g., "ADR: Why we use recipe-scrapers over custom parsing")
- Updated `CONTEXT.md` with new terms (e.g., `SourcePlatform` enum, `URLClassifier` workflow)

**When to use**: Before starting **any** non-trivial feature work. Especially for Phase 3+ features where you're extending existing systems.

**Benefit**: 
- Finds edge cases you hadn't considered
- Prevents terminology confusion (agent + you are speaking the same language)
- Documentation stays current (no stale specs)
- PRD that comes next has a solid foundation

---

#### `/grill-me`
**What it does**: Open-ended grilling for any ambiguous decision, without reference to code/docs.

**When to use**: When you're uncertain about a design decision outside the scope of `/grill-with-docs`.

**Example**: "Should this be REST or GraphQL?" → `/grill-me` walks through tradeoffs.

**Benefit**: Structured thinking; helps you reach a decision faster than solo deliberation.

---

### Phase 2: PLANNING

#### `/to-prd`
**What it does**: Converts a grilled design into a formal PRD (Product Requirements Document).

**Input**: A clear design (from `/grill-with-docs` output or your own notes)

**Output**:
- PRD with sections: Problem, Solution, Scope, Success Criteria, Acceptance Tests, UX Flows
- Ready to paste into GitHub / Linear / your issue tracker

**When to use**: After `/grill-with-docs` completes. Before `/to-issues`.

**Benefit**: 
- PRD is a **forcing function** — writing it surfaces ambiguities
- Teams (or future-you) can review PRD before code is written
- Easy to track "did we meet the acceptance criteria?"

---

#### `/to-issues`
**What it does**: Breaks a PRD into vertical slices (GitHub issues).

**Input**: A PRD (from `/to-prd` or manual)

**Process**:
1. Agent reads the PRD
2. Decomposes into 3–7 issues, each:
   - Has clear acceptance criteria
   - Can be implemented independently (or with explicit dependencies)
   - Delivers user value on its own
3. Creates GitHub issues with labels, dependencies, descriptions
4. Numbers them in dependency order

**Output**: `beads-42`, `beads-43`, etc., ready to `bd ready` / pick up

**When to use**: After PRD is finalized.

**Benefit**:
- Work isn't "do the feature" (vague, large); it's "implement URL classifier" (clear, 1–2 day task)
- Parallel work possible (independent issues)
- Easier to validate (each issue has its own acceptance criteria)
- Git history is clean (each commit closes an issue)

---

#### `/zoom-out`
**What it does**: Provides system-level context when working on a feature.

**Input**: An issue or feature name

**Process**:
1. Agent reads relevant code + `CONTEXT.md`
2. Provides a high-level map showing: where this feature fits, what it depends on, what depends on it
3. Highlights potential gotchas

**When to use**: Before starting work on an issue, to understand the broader context.

**Benefit**: 
- Prevents accidental breakage of adjacent systems
- Helps you see integration points early
- Finds unexpected dependencies

---

### Phase 3: EXECUTION

#### `/tdd`
**What it does**: Implements red-green-refactor (test-first development).

**Process**:
1. You describe the issue / acceptance criteria
2. Agent writes the test (red)
3. Agent writes minimal code to pass (green)
4. Agent refactors for clarity
5. Repeats until done

**When to use**: For each issue after `/to-issues` creates them.

**Benefit**:
- Tests are never an afterthought
- Code is immediately validated against acceptance criteria
- Refactors don't break things (tests catch regressions)
- Easier debugging (test failures point to exact problem)

---

#### `/diagnose`
**What it does**: Structured debugging for when something's broken.

**Process**:
1. You describe the symptom
2. Agent asks targeted questions (2–3)
3. Agent explores code + logs
4. Agent identifies root cause
5. Proposes fix

**When to use**: When a test fails or you hit a runtime bug.

**Benefit**:
- Faster root cause analysis (no guessing)
- Prevents pattern matching on similar-looking bugs
- Documents the issue for future reference

---

#### `/improve-codebase-architecture`
**What it does**: Proactively finds architectural drift and suggests refactors.

**Process**:
1. Agent reads `docs/adr/` + `CONTEXT.md` + recent code changes
2. Identifies violations (e.g., "This component breaks the Repository Pattern")
3. Proposes refactor
4. Explains tradeoffs

**When to use**: Periodically (e.g., every 3–5 issues), or when you notice patterns repeating.

**Benefit**:
- Prevents slow architectural decay
- Catches "shortcuts that turned into habits"
- Keeps code aligned with documented decisions

---

### Bonus Skills

#### `/triage`
**What it does**: Processes incoming issues (bugs, feature requests, etc.) and applies triage labels.

**When to use**: When you're managing a team or shared project.

**Benefit**: Issues are automatically pre-sorted; team can focus on highest-value work first.

---

#### `/caveman`
**What it does**: Explains your design in ultra-compressed form (~75% fewer tokens).

**When to use**: When you want to document a decision succinctly.

**Benefit**: 
- Fewer tokens spent explaining → cheaper to iterate
- Compressed language is often clearer than verbose explanation

---

#### `/write-a-skill`
**What it does**: Scaffolds a new skill following mattpocock's patterns.

**When to use**: When you want to create custom skills for your project.

**Benefit**: Standardized skill format; your custom skills integrate with the rest of the tooling.

---

## The Workflow for BubblyChef — Example

Here's how you'd use the skills together to implement **URL Recipe Import** (a Phase 3 feature):

### Step 1: Setup (One-time)
```bash
/setup-matt-pocock-skills
# → Creates CONTEXT.md, docs/agents/*, updates AGENTS.md
# → BubblyChef is now ready for all other skills
```

### Step 2: Alignment
```bash
/grill-with-docs
# Prompt: "I want to add URL recipe import. Users paste a recipe URL, 
#          we fetch it, parse it, and add it to the recipe library."
#
# Agent grills you:
# Q1: "What sites should we support? Are they all HTML?"
# Q2: "What if the URL is behind a paywall or requires JavaScript?"
# Q3: "Should we auto-detect cuisine/dietary/prep time, or ask the user?"
# Q4: "Is this for recipe-scrapers gem, or custom parsing?"
# ... etc, one Q at a time
#
# Output: 
# - Updated CONTEXT.md (new term: URLClassifier, SourceMetadata)
# - New ADR: "Why we chose recipe-scrapers + fallback"
# - Edge cases documented (paywall handling, parsing failures)
```

### Step 3: PRD
```bash
/to-prd
# Input: Output from grill-with-docs
# 
# Output:
# - Problem: Users can't easily import recipes from external sites
# - Solution: URL paste → parse → add to library
# - Scope: Support top 5 recipe sites + generic HTML fallback
# - Success criteria: 
#   * Parse recipe title, ingredients, steps, cuisine
#   * Show confidence scores (proposal pattern)
#   * User reviews before adding
# - Acceptance tests:
#   * New recipe from TastyRecipes.com parses ≥80% of fields
#   * Paywall URL shows friendly error
#   * Invalid URL shows helpful message
```

### Step 4: Issues
```bash
/to-issues
# Input: PRD from step 3
# 
# Output (5 issues):
# - beads-50: Add source_url + source_platform to recipes table (DB migration)
# - beads-51: Build URLClassifier (detect recipe site vs video URL)
# - beads-52: Integrate recipe-scrapers library + error handling
# - beads-53: Build "Import Recipe" UI (URL input + source card + confirm)
# - beads-54: Wire streaming response (fetch URL, show parsing progress)
```

### Step 5: Implementation (Loop for each issue)
```bash
bd ready                # See beads-50, beads-51, etc.
bd update beads-50 --claim

# For each issue:
/tdd
# Prompt: "Implement the source_url + source_platform migration"
# Agent writes test, then code, then refactors

# If stuck:
/diagnose
# Agent helps debug the issue

# Every 3–5 issues:
/improve-codebase-architecture
# Agent finds architectural drift and suggests refactors
```

### Step 6: Handoff
```bash
/zoom-out
# Before closing the epic, see system-wide impact
# Make sure no other features were broken
```

---

## Key Benefits for Personal Projects

| Problem | Solution | Skill |
|---------|----------|-------|
| "I have an idea but haven't thought through the details" | Interactive grilling that stress-tests your idea | `/grill-with-docs`, `/grill-me` |
| "Lots of edge cases, not sure which to prioritize" | Documented edge cases in ADRs + CONTEXT.md | Output of `/grill-with-docs` |
| "How do I break this into work?" | Automatic vertical-slice decomposition | `/to-prd`, `/to-issues` |
| "Tests are an afterthought, always incomplete" | Red-green-refactor forces tests first | `/tdd` |
| "Code drifts from architectural decisions" | Proactive architecture review | `/improve-codebase-architecture` |
| "Debugging takes forever" | Structured root-cause analysis | `/diagnose` |
| "Documentation gets stale" | Docs updated inline during grilling + implementation | `/grill-with-docs` updates CONTEXT.md |
| "Issue description was vague, implementation wandered" | Clear acceptance criteria per issue | `/to-issues` output |

---

## When to Use Each Skill

```
Feature idea → /grill-with-docs → /grill-me (if stuck) → /to-prd
                                                            ↓
                                                        /to-issues
                                                            ↓
                    /zoom-out (optional, before implementation)
                            ↓
                    For each issue: /tdd
                            ↓
                    If broken: /diagnose
                            ↓
                    Every 3–5 issues: /improve-codebase-architecture
                            ↓
                    Repeat until epic is done
                            ↓
                    /zoom-out (final check)
```

---

## Configuration (Already Done)

BubblyChef is now configured:
- ✅ `CONTEXT.md` created with domain glossary (Recipe, Pantry, Grounding, etc.)
- ✅ `docs/agents/issue-tracker.md` — GitHub Issues
- ✅ `docs/agents/triage-labels.md` — canonical triage labels
- ✅ `docs/agents/domain.md` — CONTEXT.md + ADRs layout
- ✅ `AGENTS.md` updated with Agent skills block

Next steps:
1. Pick a feature (e.g., URL recipe import)
2. Run `/grill-with-docs` to stress-test the design
3. Run `/to-prd` to write the PRD
4. Run `/to-issues` to break into GitHub issues
5. Run `/tdd` on each issue

---

## Token Efficiency

- `/caveman` reduces explanation overhead by ~75%
- `/grill-with-docs` prevents design thrashing (do it right the first time)
- `/tdd` reduces debugging time (tests catch issues early)
- **Net effect**: Fewer iterations, faster implementation, cleaner code

---

*Created: 2026-04-29*
