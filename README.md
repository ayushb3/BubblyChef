# BubblyChef

A Sanrio-inspired pantry + recipe assistant. Scan receipts, manage your pantry, generate AI recipes, and chat about cooking.

[![Demo Video](https://img.youtube.com/vi/0r-LrfWgBrk/maxresdefault.jpg)](https://youtu.be/0r-LrfWgBrk)

---

## What It Does

- **Receipt scanning** — photograph a receipt, OCR + AI parse items into pantry in under 30 seconds
- **Pantry management** — track items, expiry dates, and storage locations with a visual kitchen scene
- **AI recipe generation** — "What can I make tonight?" uses your actual pantry inventory, prioritising expiring items
- **Chat assistant** — natural language pantry updates, recipe suggestions, cooking questions
- **Recipe library** — save, search, edit, and favourite recipes from chat or manual entry

---

## Stack

| Layer | Tech |
|---|---|
| Frontend + CRUD | Next.js 14 (App Router), React, TypeScript, Tailwind CSS |
| Auth + Database | Supabase (Postgres + Row Level Security) |
| AI Microservice | FastAPI + LangGraph + Gemini API + Gemini Vision OCR |
| Deployment | Vercel (frontend) + Railway (AI service) |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- A free [Supabase](https://supabase.com) project
- A free [Gemini API key](https://aistudio.google.com/)

### 1. Clone and install

```bash
git clone https://github.com/your-username/BubblyChef
cd BubblyChef

# Frontend
cd nextjs && npm install

# AI microservice
cd ../ai-service && pip install -e ".[dev]"
```

### 2. Configure environment

```bash
# nextjs/.env.local
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_AI_SERVICE_URL=http://localhost:8888

# ai-service/.env
BUBBLY_SUPABASE_URL=your-supabase-url
BUBBLY_SUPABASE_SECRET_KEY=your-secret-key
BUBBLY_SUPABASE_JWT_SECRET=your-jwt-secret
BUBBLY_GEMINI_API_KEY=your-gemini-key
```

See `docs/SUPABASE_SETUP.md` for step-by-step Supabase project setup.

### 3. Apply database migrations

```bash
supabase db push
```

### 4. Run locally

```bash
# Terminal 1 — Next.js (http://localhost:3000)
cd nextjs && npm run dev

# Terminal 2 — AI microservice (http://localhost:8888)
cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888
```

---

## Architecture

```
Browser
  │
  ├── Next.js API routes (/api/*)  ──→  Supabase Postgres
  │   (pantry, recipes, profile,            (RLS per user)
  │    decorations, foods)
  │
  └── AI Microservice (port 8888)  ──→  Supabase (service_role)
      (chat, scan, recipe-generate)
       LangGraph workflows
       Gemini → Ollama fallback
       Gemini Vision OCR
```

**Key patterns:**
- CRUD operations go through Next.js API routes — no round-trip to the AI service
- AI operations hit the microservice directly (or via SSE stream for chat)
- Every DB table has `user_id` + RLS; microservice uses service_role key with explicit `user_id` filtering
- AI workflows return `ProposalEnvelope` with confidence scores — nothing writes to DB without user confirmation

---

## Project Structure

```
BubblyChef/
├── nextjs/                  # Next.js app (frontend + CRUD API)
│   └── src/
│       ├── app/             # Pages + API route handlers
│       ├── components/      # React components
│       └── lib/             # Supabase clients, API client, helpers
│
├── ai-service/              # FastAPI AI microservice
│   └── bubbly_chef/
│       ├── main.py          # App entry point (AI endpoints only)
│       ├── workflows/       # LangGraph state machines
│       ├── ai/              # Gemini + Ollama provider abstraction
│       ├── services/        # OCR, receipt parser, image preprocessor
│       └── domain/          # Normaliser, expiry heuristics, food catalog
│
├── supabase/
│   └── migrations/          # SQL migrations (schema + RLS)
│
└── docs/                    # Architecture, setup guides, plans
```

Full structure: `docs/ARCHITECTURE.md`

---

## What's Done

- **Phase 1 (monolith)** — Pantry CRUD, receipt scanning, recipe generation, LangGraph workflows, DOM kitchen scene, 454+ tests
- **Phase 2 (monolith)** — Chat intent router (4 intents), recipe grounding workflow (constraint extraction + expiry-ranked scoring), conversation history, milestone decorations
- **Migration** — Three-tier rewrite: Next.js + Supabase + FastAPI AI microservice
  - Supabase schema with RLS on all 7 tables
  - 19 CRUD API route handlers in Next.js
  - AI microservice extracted with full SupabaseRepository
  - Recipe library UI: save, search, edit, delete, favourite
  - Auth: cookie-based sessions via `@supabase/ssr`

---

## What's Next (Phase 3)

See `ROADMAP.md` for full plan and acceptance criteria.

| Feature | Status |
|---|---|
| Component migration (Pantry, Scan, Chat pages) | Pending |
| AI microservice wiring (JWT forwarding, SSE streaming) | Pending |
| URL recipe import (scrape structured data) | Planned |
| Video recipe ingestion (TikTok, YouTube Shorts) | Planned |
| Deploy to Vercel + Railway | Pending |

---

## Running Tests

```bash
# AI microservice tests
cd ai-service && pytest

# TypeScript check
cd nextjs && npx tsc --noEmit
```

---

## License

MIT
