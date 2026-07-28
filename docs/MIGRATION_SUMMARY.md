# Migration Summary Report — BubblyChef

**Date**: 2026-04-02
**Migration**: Monolith (React+Vite / FastAPI+SQLite) → Three-tier (Next.js + Supabase + FastAPI AI Microservice)

---

## What Was Done

### Phase 1: Supabase Schema + RLS (COMPLETE)

**Files created:**
- `supabase/migrations/00001_initial_schema.sql` — 7 tables with `user_id`, JSONB columns, UUID PKs, indexes, `updated_at` triggers
- `supabase/migrations/00002_rls_policies.sql` — RLS on all tables + auto-create profile trigger on auth signup
- `supabase/config.toml` — Supabase CLI project config
- `scripts/migrate_sqlite_to_supabase.py` — One-time data migration script (SQLite → Supabase)

**Key decisions:**
- All tables have `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`
- SQLite TEXT dates → Postgres `DATE` / `TIMESTAMPTZ`
- SQLite TEXT JSON → Postgres `JSONB`
- SQLite `REAL` → Postgres `NUMERIC(10,2)`
- `food_catalog` is public read-only (no user_id)
- Profile auto-created via Postgres trigger on `auth.users` insert

### Phase 2: Next.js App + Supabase Auth (COMPLETE)

**Files created:**
- `nextjs/` — Full Next.js 16 App Router project
- `nextjs/src/lib/supabase/{client,server,middleware}.ts` — Supabase SSR setup
- `nextjs/src/middleware.ts` — Auth guard (redirects unauthenticated → `/login`)
- `nextjs/src/app/login/page.tsx` — Sign in / sign up page (BubblyChef design system)
- `nextjs/src/app/auth/callback/route.ts` — PKCE code exchange
- `nextjs/src/components/Providers.tsx` — React Query provider
- 7 skeleton pages (Dashboard, Pantry, Scan, Recipes, RecipeDetail, Chat, Profile)

**Key decisions:**
- Cookie-based auth via `@supabase/ssr` (no localStorage tokens)
- Nunito font (matching existing design system)
- React Query kept for server state management
- Login page uses BubblyChef color palette (#D4607A primary, #FFF9F5 background)

### Phase 3: CRUD API Routes (COMPLETE)

**Files created (19 route handlers):**
- `nextjs/src/app/api/pantry/route.ts` — GET list, POST create
- `nextjs/src/app/api/pantry/expiring/route.ts` — GET expiring items
- `nextjs/src/app/api/pantry/[id]/route.ts` — GET, PUT, DELETE
- `nextjs/src/app/api/pantry/[id]/slot/route.ts` — PATCH slot_index
- `nextjs/src/app/api/recipes/route.ts` — GET list, POST save
- `nextjs/src/app/api/recipes/[id]/route.ts` — GET, PUT, DELETE
- `nextjs/src/app/api/profile/route.ts` — POST create
- `nextjs/src/app/api/profile/[id]/route.ts` — GET, PUT, DELETE
- `nextjs/src/app/api/profile/email/[email]/route.ts` — GET by email
- `nextjs/src/app/api/profile/username/[username]/route.ts` — GET by username
- `nextjs/src/app/api/decorations/route.ts` — GET all
- `nextjs/src/app/api/foods/search/route.ts` — GET search

**Helpers created:**
- `nextjs/src/lib/pantry-helpers.ts` — `enrichPantryItem()`, `buildPantryListResponse()`
- `nextjs/src/lib/response-helpers.ts` — `requireAuth()`, `errorResponse()`, `notFound()`

**Key decisions:**
- Every route calls `requireAuth()` → extracts user from Supabase session cookie
- Pantry computed fields (`days_until_expiry`, `is_expired`, `is_expiring_soon`) ported from Python `@computed_field`
- `storage_location` ↔ `location` alias maintained for frontend compatibility
- Recipes support pagination (`limit`/`offset`) + filtering (`search`, `cuisine`, `meal_type`, `max_time`)

### Phase 5: AI Microservice Extraction (COMPLETE)

**Files created:**
- `ai-service/bubbly_chef/main.py` — Slimmed FastAPI app (AI endpoints only)
- `ai-service/bubbly_chef/config.py` — Supabase + Gemini + Ollama config
- `ai-service/bubbly_chef/api/auth.py` — JWT validation middleware (`get_current_user_id`)
- `ai-service/bubbly_chef/repository/supabase_repo.py` — Full SupabaseRepository (30+ methods)
- `ai-service/Dockerfile` — Python 3.12-slim + Tesseract
- `ai-service/pyproject.toml` — Dependencies
- All AI/workflow/domain/model code copied from monolith

**Key decisions:**
- Every repo method takes `user_id` as first parameter
- `supabase-py` with service_role key (bypasses RLS)
- JWT validated via `python-jose` against Supabase JWT secret
- `apply_pantry_proposal` kept in microservice (complex write logic tied to AI workflows)

---

## What's Remaining

### Phase 4: Component Migration (NOT STARTED)
- Copy 7 pages + ~15 components from `web/src/` to `nextjs/src/`
- Replace `react-router-dom` with `next/link` + `next/navigation`
- Add `'use client'` directives
- Rewrite `client.ts` to split CRUD (same-origin) vs AI (microservice URL) calls
- Replace hardcoded `testuser` with Supabase session user

### Phase 6: Wiring (NOT STARTED)
- AI proxy routes in Next.js (`app/api/ai/*`) for non-streaming endpoints
- Direct browser → AI microservice for SSE streaming
- Token forwarding (Supabase JWT in Authorization header)

### Phase 7: Deploy (NOT STARTED)
- Next.js → Vercel
- AI microservice → Railway
- Configure production env vars, CORS, health checks

---

## Documentation Created

| Doc | Purpose |
|---|---|
| `docs/SUPABASE_SETUP.md` | Step-by-step Supabase project setup |
| `docs/ARCHITECTURE.md` | Full architecture guide for the refactored codebase |
| `docs/MIGRATION_SUMMARY.md` | This file |

---

## File Count Summary

| Directory | Files created |
|---|---|
| `supabase/` | 3 (migrations + config) |
| `nextjs/` | ~30 (app, api routes, lib, components) |
| `ai-service/` | ~6 new + ~40 copied from monolith |
| `scripts/` | 1 (migration script) |
| `docs/` | 3 |

---

## Quality Checks

- TypeScript: `npx tsc --noEmit` — **clean** (0 errors)
- All Next.js API routes follow consistent `requireAuth()` pattern
- RLS policies cover all 7 tables
- Supabase migration is idempotent (CREATE TABLE IF NOT EXISTS equivalent via migration ordering)
