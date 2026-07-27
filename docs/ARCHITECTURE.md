# BubblyChef — Refactored Architecture Guide

## Overview

BubblyChef is now a **three-tier architecture** deployed as separate services:

```
┌─────────────────────────────┐
│   Next.js (Vercel)          │
│   React + API Routes        │
│   Auth (Supabase SSR)       │
├─────────────────────────────┤
│           │           │     │
│     Supabase      AI Service│
│    (Postgres)    (Railway)  │
│     Auth+RLS     FastAPI    │
│                  LangGraph  │
│                  Tesseract  │
└─────────────────────────────┘
```

| Service | Tech | Hosts | Port |
|---|---|---|---|
| **Frontend + CRUD API** | Next.js 16, React, TypeScript, Tailwind | Vercel (prod), localhost:3000 (dev) | 3000 |
| **Database + Auth** | Supabase (Postgres 15), Row Level Security | Supabase cloud | N/A |
| **AI Microservice** | FastAPI, LangGraph, Gemini, Tesseract | Railway (prod), localhost:8888 (dev) | 8888 |

---

## Directory Structure

```
BubblyChef/
├── nextjs/                          # Next.js app (frontend + CRUD)
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx           # Root layout (Nunito font, Providers)
│   │   │   ├── page.tsx             # Dashboard
│   │   │   ├── login/page.tsx       # Auth: sign in / sign up
│   │   │   ├── auth/callback/       # Supabase PKCE callback
│   │   │   ├── pantry/page.tsx
│   │   │   ├── scan/page.tsx
│   │   │   ├── recipes/
│   │   │   │   ├── page.tsx         # Recipe list
│   │   │   │   └── [id]/page.tsx    # Recipe detail
│   │   │   ├── chat/page.tsx
│   │   │   ├── profile/page.tsx
│   │   │   └── api/                 # Next.js Route Handlers (CRUD)
│   │   │       ├── pantry/          # GET/POST, expiring/, [id]/, [id]/slot/
│   │   │       ├── recipes/         # GET/POST, [id]/
│   │   │       ├── profile/         # POST, [id]/, email/[email]/, username/[username]/
│   │   │       ├── decorations/     # GET
│   │   │       └── foods/search/    # GET
│   │   ├── components/              # React components (migrated from web/src/)
│   │   ├── lib/
│   │   │   ├── supabase/
│   │   │   │   ├── client.ts        # Browser Supabase client
│   │   │   │   ├── server.ts        # Server Supabase client
│   │   │   │   └── middleware.ts     # Auth session refresh
│   │   │   ├── api/client.ts        # API client + React Query hooks
│   │   │   ├── pantry-helpers.ts    # Computed fields (expiry, etc.)
│   │   │   └── response-helpers.ts  # requireAuth(), error responses
│   │   ├── types/index.ts           # TypeScript types (API contract)
│   │   └── middleware.ts            # Next.js middleware (auth guard)
│   ├── .env.local                   # Supabase keys, AI service URL
│   └── package.json
│
├── ai-service/                      # FastAPI AI microservice
│   ├── bubbly_chef/
│   │   ├── main.py                  # FastAPI app (AI endpoints only)
│   │   ├── config.py                # Supabase + Gemini + Ollama config
│   │   ├── api/
│   │   │   ├── auth.py              # JWT validation middleware
│   │   │   └── routes/              # AI-only route handlers
│   │   ├── ai/                      # Provider abstraction
│   │   │   ├── manager.py           # AIManager (Gemini → Ollama fallback)
│   │   │   ├── gemini.py
│   │   │   └── ollama.py
│   │   ├── workflows/               # LangGraph state machines
│   │   │   ├── chat_ingest.py       # Intent routing → sub-workflows
│   │   │   ├── receipt_ingest.py    # OCR → parse → proposals
│   │   │   ├── recipe_ingest.py
│   │   │   └── recipe/nodes.py      # Grounding + constraint extraction
│   │   ├── tools/                   # LLM client, expiry, normalizer
│   │   ├── services/                # OCR, receipt parser, image preprocessor
│   │   ├── domain/                  # Normalizer, expiry, catalog, icon map
│   │   ├── models/                  # Pydantic models (shared types)
│   │   └── repository/
│   │       └── supabase_repo.py     # SupabaseRepository (service_role key)
│   ├── Dockerfile
│   └── pyproject.toml
│
├── supabase/                        # Database schema
│   ├── migrations/
│   │   ├── 00001_initial_schema.sql # Tables, indexes, triggers
│   │   └── 00002_rls_policies.sql   # RLS + auto-create profile trigger
│   └── config.toml
│
├── bubbly_chef/                     # [LEGACY] Original monolith (reference only)
├── web/                             # [LEGACY] Original Vite frontend (reference only)
├── scripts/
│   └── migrate_sqlite_to_supabase.py
└── docs/
    ├── SUPABASE_SETUP.md
    └── ARCHITECTURE.md              # ← this file
```

---

## Data Flow

### CRUD Operations (pantry, recipes, profiles)

```
Browser → Next.js API Route (/api/pantry) → Supabase Client → Postgres
                                              ↑
                                     Auth cookie → user_id
                                     RLS enforces user isolation
```

### AI Operations (chat, scan, recipe generation)

```
Browser → AI Microservice (Railway, port 8888)
              ↓
         JWT validation → extract user_id
              ↓
         LangGraph workflow
              ↓
         Supabase (service_role key, bypasses RLS)
              ↓
         Read pantry, write proposals, save history
```

### SSE Streaming Chat

```
Browser → direct fetch to AI Service /v1/chat/stream
          (NOT proxied through Next.js — avoids serverless timeout)
          ↓
     SSE stream back to browser
```

---

## Auth Flow

1. User visits any page → Next.js middleware checks session
2. No session → redirect to `/login`
3. User signs up/in → Supabase issues JWT in HTTP-only cookie
4. Postgres trigger auto-creates `user_profiles` row
5. Every API route: `requireAuth()` extracts user from cookie
6. AI calls: frontend reads `session.access_token`, sends as `Authorization: Bearer` header
7. AI microservice: `get_current_user_id()` validates JWT, extracts `sub` claim

---

## Key Patterns

### Supabase Client Creation

```typescript
// Browser (client components)
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()

// Server (API routes, server components)
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()
```

### Protected API Route

```typescript
export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { data } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('user_id', user.id)
  // ...
}
```

### AI Microservice → Supabase

```python
# Uses service_role key — bypasses RLS
repo = await get_repository()
items = await repo.get_all_pantry_items(user_id=user_id)
```

---

## Environment Variables

### Next.js (`nextjs/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `NEXT_PUBLIC_AI_SERVICE_URL` | AI microservice URL (default: `http://localhost:8888`) |

### AI Microservice (`ai-service/.env`)

| Variable | Description |
|---|---|
| `BUBBLY_SUPABASE_URL` | Supabase project URL |
| `BUBBLY_SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `BUBBLY_SUPABASE_JWT_SECRET` | JWT secret for token validation |
| `BUBBLY_GEMINI_API_KEY` | Google Gemini API key |
| `BUBBLY_CORS_ORIGINS` | Allowed origins (JSON array) |

---

## Running Locally

```bash
# Terminal 1: Next.js (frontend + CRUD)
cd nextjs && npm run dev
# → http://localhost:3000

# Terminal 2: AI microservice
cd ai-service
uvicorn bubbly_chef.main:app --reload --port 8888
# → http://localhost:8888

# Database: Supabase cloud (always running)
```

---

## What Lives Where

| Concern | Location | Why |
|---|---|---|
| Pantry CRUD | `nextjs/src/app/api/pantry/` | Simple DB ops, no AI needed |
| Recipe CRUD | `nextjs/src/app/api/recipes/` | Same |
| User profiles | `nextjs/src/app/api/profile/` | Same |
| Auth | `nextjs/src/lib/supabase/` + middleware | Cookie-based, SSR |
| Chat (AI) | `ai-service/` | LangGraph + Gemini |
| Receipt OCR | `ai-service/` | Tesseract binary dependency |
| Recipe generation | `ai-service/` | LangGraph grounding workflow |
| `apply_pantry_proposal` | `ai-service/` | Complex write logic tied to AI workflows |
