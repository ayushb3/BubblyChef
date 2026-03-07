# BubblyChef

A cute, Sanrio-inspired pantry and recipe assistant app. AI-powered grocery tracking with a bubbly aesthetic.

## Project Structure

```
BubblyChef/
├── bubbly_chef/          # Python backend (FastAPI)
│   ├── api/              # API routes
│   ├── ai/               # AI provider abstraction (Gemini, Ollama)
│   ├── domain/           # Business logic (normalizer, expiry)
│   ├── models/           # Pydantic models
│   └── repository/       # SQLite data layer
├── web/                  # React frontend
│   ├── src/
│   │   ├── api/          # API client + React Query hooks
│   │   ├── components/   # UI components
│   │   ├── pages/        # Page components
│   │   └── ...
│   └── v0-designs/       # Exported v0.dev components
├── docs/                 # Documentation
│   └── UI_PROMPTS_V0.md  # v0 design prompts
├── PLANS/                # Phase implementation plans
└── scripts/              # Dev scripts
```

## Tech Stack

### Backend
- **Framework:** Python 3.12 + FastAPI
- **Database:** SQLite (aiosqlite)
- **AI:** Provider abstraction supporting Gemini (free tier) and Ollama (self-hosted)

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **Styling:** Tailwind CSS (pastel color palette)
- **State:** React Query + Zustand
- **Routing:** React Router v6

---

## Design System

### Color Palette (Sanrio/Kawaii aesthetic)
```css
--pastel-pink: #FFB5C5;
--pastel-mint: #B5EAD7;
--pastel-lavender: #C9B5E8;
--pastel-peach: #FFDAB3;
--pastel-coral: #FF9AA2;
--pastel-yellow: #FFF1B5;
--cream-white: #FFF9F5;
--soft-charcoal: #4A4A4A;
```

### Design Principles
- Soft rounded corners (12-16px radius)
- Pill-shaped buttons
- Cute emoji icons throughout
- Friendly rounded fonts (Nunito/Quicksand)
- Subtle warm-toned shadows
- Mobile-first (max-width 480px centered)

---

## API Reference

Backend runs at `http://localhost:9000`. Frontend at `http://localhost:5173`.

**Quick Start:**
- Run `./start.sh` and choose an option (both/backend/frontend)
- Or run separately: `./scripts/start-backend.sh` and `./scripts/start-frontend.sh`

### Endpoints

#### Health
```
GET  /health        → { status, version }
GET  /health/ai     → { healthy, providers[] }
```

#### Pantry
```
GET    /api/pantry                    → { items[], total_count, expiring_soon_count, expired_count }
GET    /api/pantry?category=dairy     → Filter by category
GET    /api/pantry?location=fridge    → Filter by location
GET    /api/pantry?search=milk        → Search by name
GET    /api/pantry/expiring?days=3    → Items expiring soon
GET    /api/pantry/:id                → Single item
POST   /api/pantry                    → Create item (auto-categorizes, estimates expiry)
PUT    /api/pantry/:id                → Update item
DELETE /api/pantry/:id                → Delete item
```

#### Scan (Receipt Scanning)
```
GET    /api/scan/ocr-status           → { available, service, message }
POST   /api/scan/receipt              → Upload image, returns { request_id, auto_added[], needs_review[], warnings[] }
POST   /api/scan/confirm              → Confirm reviewed items: { request_id, items[] }
POST   /api/scan/undo/:request_id     → Undo auto-added items from scan session
```

**Scan Flow:**
1. Upload receipt image to `/api/scan/receipt`
2. High confidence items (>0.8) are auto-added to pantry
3. Lower confidence items returned in `needs_review` for user confirmation
4. User confirms/edits items via `/api/scan/confirm`
5. Can undo auto-added items via `/api/scan/undo/:request_id`

### Data Types

```typescript
type Category = 'produce' | 'dairy' | 'meat' | 'seafood' | 'frozen' | 'pantry' | 'beverages' | 'condiments' | 'bakery' | 'snacks' | 'other';
type Location = 'fridge' | 'freezer' | 'pantry' | 'counter';

interface PantryItem {
  id: string;
  name: string;
  name_normalized: string;
  category: Category;
  location: Location;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  added_at: string;
  updated_at: string;
  // Computed fields
  days_until_expiry: number | null;
  is_expired: boolean;
  is_expiring_soon: boolean;
}

interface CreatePantryItem {
  name: string;
  quantity?: number;    // default: 1
  unit?: string;        // default: "item"
  category?: Category;  // auto-detected
  location?: Location;  // defaults by category
  expiry_date?: string; // auto-estimated
}
```

---

## Running the App

### Quick Start
```bash
# Interactive menu
./start.sh

# Or run separately:
./scripts/start-backend.sh   # Backend only
./scripts/start-frontend.sh  # Frontend only
```

### Backend
```bash
# Setup (first time)
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Copy env and add your Gemini API key
cp .env.example .env

# Run
uvicorn bubbly_chef.api.app:app --reload
# → http://localhost:9000
# → API docs: http://localhost:9000/docs
```

### OCR Setup (for receipt scanning)
```bash
# macOS
brew install tesseract

# Ubuntu/Debian
sudo apt install tesseract-ocr

# Verify installation
tesseract --version
```

### Frontend
```bash
cd web
npm install
npm run dev
# → http://localhost:5173
```

### Scripts
```bash
./start.sh                    # Interactive menu
./scripts/start-backend.sh    # Backend only
./scripts/start-frontend.sh   # Frontend only
./scripts/dev.sh              # Both (runs in same terminal)
```

---

## Current Phase

**Phase 1A: Pantry UI**

### Backend (Complete ✅)
- [x] AI provider abstraction (Gemini + Ollama)
- [x] Pantry CRUD API
- [x] Auto-categorization
- [x] Expiry estimation

### Frontend (In Progress)
- [ ] React project setup
- [ ] Pantry list page
- [ ] Add/Edit item modal
- [ ] Dashboard home
- [ ] Bottom navigation

See `PLANS/` folder for detailed phase plans.

---

## v0 Design Workflow

UI designs are prototyped in [v0.dev](https://v0.dev). Prompts are in `docs/UI_PROMPTS_V0.md`.

1. Generate components in v0 using the prompts
2. Export to `web/v0-designs/`
3. Integrate into React app with real API data

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/plans/roadmap.md` | Vision and roadmap |
| `docs/TODO.md` | Current tasks and bugs |
| `docs/architecture/overview.md` | System design |
| `docs/guides/testing.md` | Testing guide |
| `docs/guides/logging.md` | Logging system |
| `docs/design/v0-prompts.md` | v0 design prompts |
| `.env.example` | Environment config template |
