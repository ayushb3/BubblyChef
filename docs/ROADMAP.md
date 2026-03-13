# Bubbly Chef — Master Plan v2

## Vision

Bubbly Chef is a **recipe assistant grounded in your actual pantry**. The core experience is casual, low-friction recipe discovery ("I have chicken and broccoli, suggest an asian recipe") enhanced by knowing what ingredients you actually have.

**Primary flow:** Chat with AI about recipes → AI knows your pantry → suggests what you can make

**Supporting flows:**
- Scan receipts to populate pantry quickly
- Manually manage pantry when needed
- Dashboard shows what's expiring soon

---

## Core Principles

1. **Recipe-first, pantry-supporting** — Pantry management exists to make recipes better, not as the main feature
2. **Zero cost AI** — Free cloud tiers (Gemini) → self-hosted Ollama → never pay for API calls
3. **Auto-add with smart review** — High confidence items auto-add; low confidence gets reviewed
4. **Simple over clever** — No over-engineered proposal systems; straightforward request/response
5. **Web-first, mobile-later** — Build features fast on web, refactor to mobile when ready

---

## Tech Stack

### Backend
- **Framework:** Python + FastAPI
- **Database:** SQLite (async via aiosqlite)
- **AI:** Provider abstraction supporting multiple backends

### Frontend
- **Framework:** React + TypeScript
- **Styling:** Tailwind CSS
- **State:** React Query (server state) + Zustand (UI state)
- **Build:** Vite

### AI Providers (in priority order)
1. **Gemini Free Tier** — Default, easiest to start
2. **Ollama (self-hosted)** — Your home PC over local network
3. **Other free tiers** — Groq, Mistral, etc. as fallbacks

---

## App Structure

```
┌─────────────────────────────────────────────────────────┐
│                     Dashboard (Home)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Expiring    │  │ Quick       │  │ Recent          │  │
│  │ Soon (3)    │  │ Actions     │  │ Activity        │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │   Chat   │  │   Scan   │  │  Pantry  │              │
│  │ (recipes)│  │(receipts)│  │  (CRUD)  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Feature Modules

### 1. Pantry (Option B depth)
- View all items with quantities and expiry dates
- Add/edit/delete items manually
- "Use soon" warnings for expiring items
- Categories: produce, dairy, meat, frozen, pantry staples, etc.
- Storage locations: fridge, freezer, pantry, counter

**Not included (keep simple):**
- Complex dedup logic
- Barcode scanning (maybe Phase 4+)
- Nutrition tracking

### 2. Receipt Scanning
- Upload/capture receipt image
- OCR → LLM extraction → parsed items
- **Auto-add high confidence (>0.8)** with undo option
- **Review low confidence (<0.8)** before adding
- Normalize names, estimate expiry dates

### 3. Recipe Generation & Management
- Input: natural language ("creamy pasta with what I have")
- AI checks pantry, suggests recipes
- Shows what you have vs. what's missing
- Generate step-by-step instructions

**Recipe Sources:**
1. **AI-generated recipes** - Created on-demand from prompts
2. **Video recipe ingestion** - Parse TikToks/Reels/YouTube Shorts (Phase 3+)
3. **URL imports** - Scrape traditional recipe websites
4. **Manual entry** - User-created recipes

**Phase 2+ additions:**
- Save favorite recipes (both generated and imported)
- Recipe history and collections
- Shopping list from missing ingredients
- Recipe search across all saved recipes

**Phase 3+ Video Recipe Ingestion:**
- Parse cooking videos from TikTok, Instagram Reels, YouTube Shorts
- Extract recipe data: ingredients, steps, timing, tips
- Index video recipes into searchable database
- Chat can reference saved video recipes ("make that butter chicken from TikTok")
- Store video metadata: source URL, creator, timestamp, thumbnail
- Transcription + visual analysis for ingredient detection
- Support for multi-language videos

### 4. Chat (Phase 2 - Orchestrator)
- Single conversational interface
- Intent router determines:
  - Recipe request → Recipe module
  - "I bought groceries" → Scan module
  - "Add milk" → Direct pantry update
  - General questions → Direct response

**Recipe Integration with Chat:**
- Chat has access to user's saved recipe library
- Can reference recipes by name or source ("that TikTok recipe", "the butter chicken you saved")
- Suggest saved recipes that match pantry contents
- Compare multiple recipes ("which one uses fewer ingredients?")
- Adapt saved recipes based on what's available
- Track which saved recipes have been cooked

---

## Data Model (Simplified)

### pantry_items
```
id              UUID PRIMARY KEY
name            TEXT NOT NULL
name_normalized TEXT NOT NULL  -- for matching
category        TEXT           -- produce, dairy, meat, etc.
location        TEXT           -- fridge, freezer, pantry, counter
quantity        REAL
unit            TEXT           -- count, lb, oz, g, ml, etc.
expiry_date     DATE           -- nullable
added_at        TIMESTAMP
updated_at      TIMESTAMP
```

### recipes (Phase 2+)
```
id              UUID PRIMARY KEY
title           TEXT NOT NULL
ingredients     JSON           -- [{name, quantity, unit}]
instructions    JSON           -- [step1, step2, ...]
source_type     TEXT           -- 'generated', 'video', 'url', 'manual'
source_url      TEXT           -- TikTok/Reel/YouTube URL or recipe website
source_metadata JSON           -- {platform, creator, duration, thumbnail, etc.}
tags            JSON           -- [cuisine, difficulty, etc.]
notes           TEXT           -- user's personal notes
times_cooked    INTEGER        -- usage tracking
last_cooked_at  TIMESTAMP      -- when last prepared
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

**Video Recipe Metadata (stored in source_metadata):**
```json
{
  "platform": "tiktok|instagram|youtube",
  "creator": "username or channel name",
  "video_duration": 45,
  "thumbnail_url": "https://...",
  "video_id": "original platform ID",
  "transcription": "full text transcript",
  "prep_time": 10,
  "cook_time": 20,
  "original_caption": "Easy butter chicken!",
  "hashtags": ["cooking", "indian", "dinner"]
}
```

### No complex proposal tables — just simple request/response

---

## AI Provider Architecture

```python
class AIProvider(Protocol):
    async def complete(self, prompt: str, schema: Type[T]) -> T:
        """Generate structured output"""
        ...

    async def complete_with_tools(self, prompt: str, tools: list[Tool]) -> Response:
        """Generate with tool calling support"""
        ...

# Implementations
class GeminiProvider(AIProvider): ...
class OllamaProvider(AIProvider): ...

# Manager picks best available
class AIManager:
    def get_provider(self) -> AIProvider: ...
```

### LLM Tools
- `lookup_expiry(item: str) -> int` — Returns days until expiry (JSON defaults + LLM reasoning)
- `search_pantry(query: str) -> list[Item]` — Find items in user's pantry
- `get_pantry_summary() -> str` — Summarize what user has available

---

## Expiry Strategy

1. **JSON defaults** — Static lookup table for common items
   ```json
   {
     "milk": 10,
     "eggs": 21,
     "chicken": 3,
     "bread": 7,
     "apples": 14,
     ...
   }
   ```

2. **LLM tool fallback** — For items not in defaults, LLM estimates based on category
3. **User override** — User can always set custom expiry

---

## Phased Roadmap

### Phase 0: Foundation
- [ ] Project setup (FastAPI + React + Vite)
- [ ] SQLite schema + repository
- [ ] AI Provider abstraction + Gemini integration
- [ ] Basic API structure

**Exit criteria:** Can call AI provider from API endpoint

### Phase 1: Core Features (Parallel Tracks)

**Track A: Pantry**
- [ ] Pantry CRUD API
- [ ] Pantry list UI
- [ ] Add/edit item modal
- [ ] Expiry warnings display

**Track B: Receipt Scanning**
- [ ] Receipt upload endpoint
- [ ] OCR integration (cloud service or local)
- [ ] LLM parsing with confidence scores
- [ ] Review/confirm UI for low confidence
- [ ] Auto-add flow for high confidence

**Track C: Recipe Generation**
- [ ] Recipe generation endpoint
- [ ] Pantry-grounded prompting
- [ ] Recipe display UI
- [ ] Missing ingredients list

**Exit criteria:** Can scan receipt, view pantry, generate recipe

### Phase 2: Dashboard + Chat
- [ ] Dashboard home screen
- [ ] Expiring soon widget
- [ ] Quick actions
- [ ] Chat interface
- [ ] Intent router

**Exit criteria:** Chat can invoke all features

### Phase 3: Recipe Library + Video Ingestion
- [ ] Recipe CRUD (save, edit, delete recipes)
- [ ] Recipe collections and favorites
- [ ] Recipe search and filtering
- [ ] Shopping list generation from recipes
- [ ] **Video recipe ingestion system**
  - [ ] TikTok video parser (URL → recipe)
  - [ ] Instagram Reels parser
  - [ ] YouTube Shorts parser
  - [ ] Video transcription service integration
  - [ ] AI extraction: ingredients + steps from video
  - [ ] Thumbnail extraction and storage
  - [ ] Video metadata indexing
- [ ] Recipe recommendation engine (saved + generated)
- [ ] Better OCR accuracy
- [ ] Ollama self-hosted support

### Phase 4+: Future
- [ ] Mobile app (React Native)
- [ ] In-app video playback for saved video recipes
- [ ] Barcode scanning
- [ ] Meal planning calendar
- [ ] Multi-user/household support
- [ ] Social recipe sharing with video embeds
- [ ] Video recipe commenting and ratings

---

## Quality Gates

For any feature to be "done":
- [ ] API endpoint works with tests
- [ ] UI is functional (not necessarily polished)
- [ ] Error states handled gracefully
- [ ] Works offline for read operations (pantry viewing)

---

## What We're NOT Building (Scope Control)

- ❌ Social features (sharing recipes)
- ❌ Complex meal planning calendars
- ❌ Nutrition tracking
- ❌ Grocery store integrations
- ❌ Multi-household sync
- ❌ Native mobile app (until web is solid)

---

## Open Questions

1. **OCR Service:** Use cloud (Google Vision, AWS Textract) or local (Tesseract)?
2. **Auth:** Do we need user accounts, or single-user local app?
3. **Hosting:** Where does backend run? Local only? Free tier hosting?
