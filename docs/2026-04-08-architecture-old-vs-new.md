# BubblyChef Architecture: Old vs New

## Summary

BubblyChef migrated from a React+Vite/FastAPI+SQLite monolith to a split-service architecture: Next.js (CRUD + SSR) + FastAPI AI microservice + Supabase (Postgres + Auth). This document captures both architectures side-by-side with Mermaid diagrams and explains the design decisions behind the migration.

---

## Old Architecture (Monolith)

Everything in one FastAPI process. React app talks to one backend, one database, one deployment unit. Simple, but everything scales (or breaks) together.

```mermaid
graph TB
    subgraph Browser
        A[React 18 + Vite<br/>port 5173]
    end

    subgraph "FastAPI Monolith (port 8888)"
        B[Routes<br/>pantry, scan, chat,<br/>recipes, profile]
        C[Services<br/>OCR, receipt parser,<br/>image preprocessor]
        D[LangGraph Workflows<br/>chat, receipt, product,<br/>recipe ingest]
        E[AI Manager<br/>Gemini → Ollama fallback]
        F[Repository<br/>SQLiteRepository]
    end

    G[(SQLite<br/>bubbly_chef.db)]

    A -->|fetch / REST| B
    B --> C
    B --> D
    D --> E
    C --> F
    D --> F
    F --> G

    style A fill:#ffb5c5,stroke:#d4607a,color:#4a4a4a
    style B fill:#b5ead7,stroke:#6bbd99,color:#4a4a4a
    style G fill:#ffdab3,stroke:#e6a36e,color:#4a4a4a
```

### Old Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite (port 5173) |
| Backend | FastAPI (port 8888) — routes, services, workflows, AI, repo all in one process |
| Database | SQLite via aiosqlite |
| AI | Gemini API + Ollama fallback, managed by `AIManager` |
| Migrations | Alembic |

---

## New Architecture (Split Services)

Three independently deployable services sharing Supabase as the data layer.

```mermaid
graph TB
    subgraph Browser
        A[Next.js React 19<br/>App Router + SSR]
    end

    subgraph "Next.js Server (Vercel)"
        B[API Routes — CRUD<br/>19 handlers: pantry,<br/>recipes, profile, foods]
        M[Middleware<br/>auth guard + redirect]
        H[Helpers<br/>requireAuth, enrichPantryItem]
    end

    subgraph "Supabase Cloud"
        S[(Postgres<br/>7 tables + RLS)]
        AU[Auth<br/>JWT + PKCE]
    end

    subgraph "AI Microservice (Railway)"
        R[FastAPI Routes<br/>chat stream, health]
        W[LangGraph Workflows<br/>chat, recipe, receipt,<br/>product ingest]
        AI[AI Providers<br/>Gemini → Ollama]
        SR[SupabaseRepository<br/>service_role key]
        OCR[Tesseract OCR]
        RX["Commented Out<br/>scan, recipes, apply"]
    end

    A -->|cookie auth| M
    M --> B
    B -->|Supabase SSR client<br/>publishable key + RLS| S
    B -->|session check| AU

    A -->|"direct SSE + JWT bearer<br/>(bypasses Next.js)"| R
    R -->|validate JWT| AU
    R --> W
    W --> AI
    W --> OCR
    W -->|"service_role key<br/>(bypasses RLS)"| S

    style A fill:#ffb5c5,stroke:#d4607a,color:#4a4a4a
    style B fill:#b5ead7,stroke:#6bbd99,color:#4a4a4a
    style S fill:#ffdab3,stroke:#e6a36e,color:#4a4a4a
    style R fill:#c9b5e8,stroke:#9b85c4,color:#4a4a4a
    style RX fill:#e0e0e0,stroke:#999,color:#777,stroke-dasharray: 5 5
```

### New Stack

| Layer | Tech | Deploys to |
|---|---|---|
| Frontend + CRUD API | Next.js 14 (App Router, React 19) | Vercel |
| AI Microservice | FastAPI + LangGraph + Tesseract | Railway |
| Database | Supabase Postgres (7 tables, RLS) | Supabase Cloud |
| Auth | Supabase Auth (JWT + PKCE) | Supabase Cloud |

---

## Design Decisions

```mermaid
graph LR
    subgraph "Decision 1: Separate CRUD from AI"
        D1A[CRUD ops are<br/>fast, stateless,<br/>cacheable] -->|"fits serverless<br/>(Vercel)"| D1B[Next.js API routes]
        D1C[AI ops are<br/>long-running,<br/>GPU/memory heavy] -->|"needs persistent<br/>process"| D1D[FastAPI on Railway]
    end

    subgraph "Decision 2: Direct browser → AI"
        D2A["Vercel serverless<br/>has ~30s timeout"] -->|"SSE streaming<br/>would get killed"| D2B["Browser calls AI<br/>service directly"]
    end

    subgraph "Decision 3: Two auth patterns"
        D3A[Next.js CRUD] -->|"cookie-based<br/>(Supabase SSR)"| D3B[RLS enforces<br/>user isolation]
        D3C[AI service] -->|"JWT bearer<br/>(service_role writes)"| D3D[Bypasses RLS<br/>for workflow writes]
    end

    subgraph "Decision 4: Supabase over SQLite"
        D4A[SQLite] -->|"single file,<br/>no concurrent writes,<br/>no auth"| D4B[Blocks multi-user<br/>+ deployment]
        D4C[Supabase Postgres] -->|"RLS, auth, realtime,<br/>cloud-native"| D4D[Multi-user ready<br/>+ free tier]
    end

    style D1B fill:#b5ead7,stroke:#6bbd99,color:#4a4a4a
    style D1D fill:#c9b5e8,stroke:#9b85c4,color:#4a4a4a
    style D2B fill:#ffb5c5,stroke:#d4607a,color:#4a4a4a
    style D3B fill:#b5ead7,stroke:#6bbd99,color:#4a4a4a
    style D3D fill:#c9b5e8,stroke:#9b85c4,color:#4a4a4a
    style D4D fill:#ffdab3,stroke:#e6a36e,color:#4a4a4a
```

### Decision 1: Separate CRUD from AI

CRUD operations (pantry list, recipe save, profile update) are fast, stateless, and cacheable — perfect for Vercel's serverless model. AI operations (LLM calls, OCR, LangGraph workflows) are long-running and memory-heavy — they need a persistent process on something like Railway.

### Decision 2: Direct browser-to-AI connection

Vercel serverless functions have a ~30 second timeout. Chat streaming via SSE can run much longer than that. Rather than fighting the platform, the browser calls the AI microservice directly for streaming endpoints. Non-streaming AI calls could optionally be proxied through Next.js API routes later.

### Decision 3: Two auth patterns

- **Next.js CRUD** uses cookie-based auth via Supabase SSR. Row-Level Security (RLS) on Postgres enforces user isolation automatically — the API routes don't need manual `WHERE user_id = ...` filters.
- **AI microservice** validates the same JWT from the cookie, but writes to the DB using a `service_role` key that bypasses RLS. This is necessary because LangGraph workflows write on behalf of users from a backend context where RLS cookie auth doesn't apply.

### Decision 4: Supabase over SQLite

SQLite was fine for local development but blocked multi-user support and cloud deployment (single-file DB, no concurrent writes, no built-in auth). Supabase provides Postgres with RLS, built-in auth (email/password, OAuth), realtime subscriptions, and a generous free tier.

---

## Data Flow Patterns

### CRUD (pantry, recipes, profile)
```
Browser → Next.js API route (cookie auth)
    → Supabase Postgres (publishable key + RLS)
```

### AI Chat (streaming)
```
Browser → AI service directly (JWT bearer + SSE)
    → LangGraph workflow → Gemini/Ollama
    → Supabase Postgres (service_role key, bypasses RLS)
```

### AI Non-streaming (scan, recipe gen — future)
```
Browser → Next.js proxy route /api/ai/* (cookie auth)
    → AI service (internal, JWT forwarded)
    → Supabase Postgres (service_role key)
```

---

## Migration Status (as of 2026-04-08)

| Phase | Status |
|---|---|
| Supabase schema + RLS + auth | Done |
| Next.js app + auth + CRUD API routes | Done |
| AI service extraction + chat streaming | Done |
| Wire remaining AI endpoints (scan, recipes, apply) | TODO |
| Port UI components from old React app | TODO |
| Next.js → AI proxy routes | TODO |
| Deployment (Vercel + Railway + Supabase) | TODO |
| CI/CD pipeline | TODO |

**Estimated completion: ~70%** — all infrastructure and core APIs are done; UI components and deployment remain.

---

## References

- `docs/MIGRATION_SUMMARY.md` — Phase-by-phase migration log
- `docs/ARCHITECTURE.md` — Full architecture reference
- `docs/SUPABASE_SETUP.md` — Supabase setup guide
- `supabase/migrations/` — Database schema + RLS policies
- `nextjs/src/app/api/` — All CRUD route handlers
- `ai-service/bubbly_chef/` — AI microservice code
