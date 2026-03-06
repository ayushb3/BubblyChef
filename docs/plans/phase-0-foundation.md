# Phase 0: Foundation

## Goal
Set up project structure and core infrastructure so we can build features on a solid base.

**Exit Criteria:** Can call AI provider from API endpoint and see response in browser.

---

## Tasks

### 0.1 Project Structure Setup

- [ ] Create new directory structure (keep `bubbly_chef/` for backend)
- [ ] Set up `web/` directory for React frontend
- [ ] Initialize Vite + React + TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up basic routing (React Router)
- [ ] Create placeholder pages: Dashboard, Pantry, Scan, Recipes

### 0.2 Backend Foundation

- [ ] Clean up existing `bubbly_chef/` structure
- [ ] Remove over-engineered workflow files
- [ ] Simplify models (remove ProposalEnvelope complexity)
- [ ] Keep: normalizer.py, expiry.py, sqlite repository pattern
- [ ] Update `config.py` for new settings
- [ ] Set up CORS for local development

### 0.3 AI Provider Abstraction

- [ ] Create `ai/provider.py` - base protocol
- [ ] Create `ai/manager.py` - provider selection
- [ ] Implement `ai/gemini.py` - Gemini free tier
- [ ] Create placeholder `ai/ollama.py` - for later
- [ ] Test endpoint: `GET /api/health/ai` - verify provider works

### 0.4 Database Schema

- [ ] Simplify SQLite schema
- [ ] Create migration script
- [ ] Tables: `pantry_items` (simplified)
- [ ] Test: can add/retrieve items

### 0.5 Dev Environment

- [ ] Update `pyproject.toml` dependencies
- [ ] Create `web/package.json`
- [ ] Set up concurrent dev script (backend + frontend)
- [ ] Document local setup in README

---

## File Changes

### New Files
```
web/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Pantry.tsx
│   │   ├── Scan.tsx
│   │   └── Recipes.tsx
│   └── api/
│       └── client.ts
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts

bubbly_chef/ai/
├── __init__.py
├── provider.py
├── manager.py
└── gemini.py
```

### Files to Remove/Archive
```
bubbly_chef/workflows/chat_ingest.py      # Too complex
bubbly_chef/workflows/state.py            # Not needed
bubbly_chef/models/base.py                # ProposalEnvelope stuff
bubbly_chef/models/proposals.py           # Not needed
bubbly_chef/tools/llm_client.py           # Replace with ai/
```

### Files to Simplify
```
bubbly_chef/models/pantry.py              # Remove proposal-related fields
bubbly_chef/repository/sqlite.py          # Simplify schema
```

---

## Verification

Phase 0 is complete when:

1. `npm run dev` in `web/` shows React app at localhost:5173
2. `uvicorn main:app` runs backend at localhost:9000
3. Frontend can fetch from `GET /api/health`
4. `GET /api/health/ai` returns AI provider status
5. Basic CRUD on pantry works (even if UI is ugly)

---

## Time Estimate

~2-3 sessions of focused work

---

## Notes

- Don't over-optimize frontend yet - basic Tailwind is fine
- Focus on wiring, not polish
- Keep existing tests that still apply (normalizer, expiry)
