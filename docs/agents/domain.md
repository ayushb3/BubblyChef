# Domain Docs Layout

BubblyChef uses a **single-context** layout for domain documentation.

## Structure

```
BubblyChef/                          # Repo root
├── CONTEXT.md                       # Project domain glossary ← Primary reference
├── docs/
│   ├── ARCHITECTURE.md              # High-level system design
│   ├── adr/                         # Architecture Decision Records
│   │   ├── 0001-supabase-choice.md
│   │   ├── 0002-fastapi-microservice.md
│   │   └── ...
│   └── plans/                       # Feature plans & designs
│       ├── 2026-04-29-url-recipe-import.md
│       └── ...
```

## How Skills Use These

### CONTEXT.md
**Read by**: `tdd`, `improve-codebase-architecture`, `diagnose`

Skills read `CONTEXT.md` at the repo root to understand:
- Domain entities (Recipe, Pantry, Grounding Workflow, etc.)
- Key patterns (Repository Pattern, ProposalEnvelope, AIManager)
- Stack overview
- Architectural phases

**How to maintain**: Add new domain terms as you introduce them. Update existing definitions as understanding evolves. Keep it concise — this is a reference, not a tutorial.

### docs/adr/
**Read by**: `diagnose`, `improve-codebase-architecture`

Skills read ADRs to understand *why* architectural decisions were made. This prevents reverting decisions or proposing contradictory changes.

**How to maintain**: Create one ADR per significant architectural decision. Use the [template](https://adr.github.io/madr/):
```markdown
# ADR NN: [Short Title]

## Context
[Why were we considering this?]

## Decision
[What did we decide?]

## Consequences
[What are the tradeoffs?]
```

### docs/plans/
**Read by**: `zoom-out`, manual reference

Skills don't automatically consume plans; they're for human reference and audit trail. Plans should document:
- Feature scope
- Acceptance criteria
- Dependency order
- Known tradeoffs

---

## Consumer Rules

### Rule 1: CONTEXT.md is Authoritative
If CONTEXT.md says "X is a ReAct workflow" but the code doesn't do ReAct, trust CONTEXT.md — it means the code is buggy or the docs are stale. Either way, the code should change to match the documented intent.

### Rule 2: ADRs Aren't Suggestions
If an ADR says "we chose FastAPI because Djängo's ORM scales poorly," don't propose switching to Django without revisiting that ADR and explaining why the decision has changed.

### Rule 3: Plans Are Frozen Snapshots
Once a plan is committed, it's read-only for audit purposes. For active work, refer to GitHub issues. If a plan becomes stale, archive it but don't delete it — future devs benefit from knowing what was tried and why.

---

## How to Add New Context

When introducing a new domain concept (e.g., "Shopping List Generation"), add it to CONTEXT.md under the appropriate section:

1. **New entity?** → Add to "Core Entities" section
2. **New workflow?** → Add to workflow description or create subsection
3. **New pattern?** → Add to "Key Patterns" section
4. **New architectural phase?** → Update the phase table

Keep definitions concise (2–4 sentences) with links to related concepts and code references (file paths, line numbers).

---

*Last updated: 2026-04-29*
