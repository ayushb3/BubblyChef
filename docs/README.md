# BubblyChef Documentation

## Architecture

- [Architecture Guide](ARCHITECTURE.md) — three-tier system overview, data flows, auth, key patterns
- [Migration Summary](MIGRATION_SUMMARY.md) — what changed in the monolith → Next.js + Supabase migration

## Setup

- [Supabase Setup](SUPABASE_SETUP.md) — step-by-step Supabase project setup (schema, auth, RLS)

## Guides

- [Testing Guide](guides/testing.md) — how to write and run tests (AI microservice)
- [Logging Guide](guides/logging.md) — using the logging system

## Plans (active)

- [AI Workflows Redesign](plans/2026-03-30-ai-workflows-architecture-redesign.md) — Phase 3 LangGraph refactor plan (router + sub-graph decomposition)

## Archive

Historical docs from earlier phases — see [archive/](archive/).

---

## Key files (project root)

| File | Purpose |
|---|---|
| `README.md` | Project overview, quick start, what's done, what's next |
| `ROADMAP.md` | Current phase, features, blockers, success criteria |
| `CLAUDE.md` | Stack reference, architecture, dev guidelines (for AI agents) |
| `AGENTS.md` | Agent workflow instructions (beads issue tracking, session protocol) |
