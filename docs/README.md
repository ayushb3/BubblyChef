# BubblyChef Documentation

## Architecture

- [Architecture Guide](ARCHITECTURE.md) — three-tier system overview, data flows, auth, key patterns
- [Old vs New Architecture](2026-04-08-architecture-old-vs-new.md) — side-by-side comparison with Mermaid diagrams
- [Workflow Diagrams](architecture/2026-03-30-workflow-diagrams.md) — LangGraph workflow topology (Mermaid)
- [Recipe Workflow Spec](architecture/2026-05-03-recipe-workflow.md) — chat intent router detailed spec

## Setup

- [Supabase Setup](SUPABASE_SETUP.md) — step-by-step Supabase project setup (schema, auth, RLS)

## Plans (active)

- [AI Workflows Redesign](plans/2026-03-30-ai-workflows-architecture-redesign.md) — Phase 3 LangGraph refactor (R1-R2 done, R3-R5 pending)
- [Active Work Items](plans/2026-04-29-active-work-items.md) — current features, dependencies, priorities

## Reference

- [Workflow Guide](WORKFLOW.md) — full pipeline: plan → PRD → issues → implement
- [Mattpocock Skills Guide](MATTPOCOCK-SKILLS-GUIDE.md) — grill→PRD→issues→TDD methodology
- [Migration Summary](MIGRATION_SUMMARY.md) — monolith → Next.js + Supabase migration log
- [Design Prompts](design/v0-prompts.md) — UI design system + Vercel v0 component prompts
- [ADRs](adr/) — architectural decision records

## Agent Config

- [Domain docs](agents/domain.md) — how domain context is organized
- [Issue tracker](agents/issue-tracker.md) — GitHub Issues via `gh` CLI
- [Triage labels](agents/triage-labels.md) — mattpocock label vocabulary

## Archive

Historical docs from earlier phases — see [archive/](archive/) (ignored by Claude).

---

## Key files (project root)

| File | Purpose |
|---|---|
| `README.md` | Project overview, quick start, what's done, what's next |
| `ROADMAP.md` | Current phase, features, blockers, success criteria |
| `CLAUDE.md` | Stack reference, architecture, dev guidelines (for AI agents) |
