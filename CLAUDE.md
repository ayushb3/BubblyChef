# BubblyChef - AI-Powered Pantry Assistant

**A cute, Sanrio-inspired pantry and recipe tracking app with AI-powered receipt scanning.**

Track groceries • Scan receipts • Plan meals • Never waste food 🍳✨

---

## 📋 Quick Reference

| Info | Value |
|------|-------|
| **Version** | 0.2.0 |
| **Backend** | Python 3.12 + FastAPI (Port 8888) |
| **Frontend** | React 18 + TypeScript + Vite (Port 5173) |
| **Database** | SQLite (aiosqlite) |
| **AI** | Gemini API (free tier) + Ollama (self-hosted fallback) |
| **OCR** | Tesseract |
| **Phase** | 1C Complete (Recipe Generation) |

### Quick Start
```bash
# Start backend
uvicorn bubbly_chef.api.app:app --reload --port 8888

# Start frontend (separate terminal)
cd web && npm run dev

# Navigate to
http://localhost:5173
```

---

## 🏗️ Architecture Overview

### System Design

```
┌──────────────────────────────────────────────────────┐
│              Frontend (React + TypeScript)           │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Pantry  │  │   Scan   │  │ Recipes  │          │
│  │   Page   │  │ Receipt  │  │ Generate │          │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘          │
└────────┼─────────────┼─────────────┼────────────────┘
         │             │             │
         │   React Query + Fetch    │
         └─────────────┴─────────────┘
                       │ HTTP/REST
┌──────────────────────┼──────────────────────────────┐
│           Backend (FastAPI + Python)                 │
│                      │                               │
│  ┌───────────────────┴────────────────────┐         │
│  │         API Routes                     │         │
│  │  /health  /api/pantry  /api/scan      │         │
│  │  /api/recipes                         │         │
│  └───────────────────┬────────────────────┘         │
│                      │                               │
│  ┌───────────────────┴────────────────────┐         │
│  │         Services Layer                 │         │
│  │  ┌──────────┐  ┌──────────┐           │         │
│  │  │   OCR    │  │   AI     │           │         │
│  │  │ (Tess.)  │  │ Manager  │           │         │
│  │  └─────┬────┘  └─────┬────┘           │         │
│  └────────┼─────────────┼─────────────────┘         │
│           │             │                            │
│  ┌────────┴────┐  ┌─────┴────────────────┐         │
│  │  Domain     │  │  AI Providers         │         │
│  │  Logic      │  │  ┌──────┐  ┌──────┐  │         │
│  │  - Norm.    │  │  │Gemini│  │Ollama│  │         │
│  │  - Expiry   │  │  └──────┘  └──────┘  │         │
│  │  - Default  │  └───────────────────────┘         │
│  └──────┬──────┘                                     │
│         │                                            │
│  ┌──────┴──────┐                                     │
│  │ Repository  │                                     │
│  │  (SQLite)   │                                     │
│  └─────────────┘                                     │
└─────────────────────────────────────────────────────┘
```

### Key Design Patterns

1. **AI Provider Abstraction** - Pluggable AI backends (Gemini, Ollama) with fallback
2. **Repository Pattern** - Clean data access layer with async SQLite
3. **Domain-Driven Design** - Business logic separated from API/data layers
4. **React Query** - Server state management with caching
5. **Smart Defaults** - Auto-categorization, expiry estimation, unit defaults

---

## 📁 Project Structure

```
BubblyChef/
├── bubbly_chef/              # Backend (Python 3.12)
│   ├── api/
│   │   ├── app.py           # FastAPI application factory
│   │   ├── deps.py          # Dependency injection
│   │   └── routes/
│   │       ├── health.py    # Health checks
│   │       ├── pantry.py    # Pantry CRUD endpoints
│   │       └── scan.py      # Receipt scanning endpoints
│   │
│   ├── ai/                   # AI Provider System
│   │   ├── provider.py      # Base AIProvider protocol
│   │   ├── manager.py       # AIManager (provider selection/fallback)
│   │   ├── gemini.py        # Gemini API implementation
│   │   └── ollama.py        # Ollama local implementation
│   │
│   ├── domain/               # Business Logic
│   │   ├── normalizer.py    # Food name normalization + categorization
│   │   ├── expiry.py        # Expiry date estimation + storage location
│   │   └── defaults.py      # Smart quantity/unit defaults (NEW)
│   │
│   ├── services/             # External Services
│   │   ├── ocr.py           # Tesseract OCR wrapper
│   │   └── receipt_parser.py # AI-powered receipt parsing
│   │
│   ├── models/               # Pydantic Models
│   │   └── pantry.py        # PantryItem, Category, Location
│   │
│   ├── repository/           # Data Access
│   │   ├── base.py          # Repository protocol
│   │   └── sqlite.py        # SQLite implementation
│   │
│   ├── config.py            # Environment configuration
│   └── logger.py            # Structured logging
│
├── web/                      # Frontend (React + TypeScript)
│   ├── src/
│   │   ├── api/
│   │   │   └── client.ts    # API client + React Query hooks
│   │   │
│   │   ├── pages/
│   │   │   ├── Pantry.tsx   # Pantry list/management
│   │   │   └── Scan.tsx     # Receipt scanning UI
│   │   │
│   │   ├── components/      # Reusable UI components
│   │   ├── types/           # TypeScript type definitions
│   │   │   └── index.ts     # Shared types (PantryItem, etc.)
│   │   │
│   │   ├── App.tsx          # Root component + routing
│   │   └── main.tsx         # Entry point
│   │
│   ├── public/              # Static assets
│   ├── package.json         # Dependencies
│   ├── vite.config.ts       # Vite configuration
│   ├── tailwind.config.js   # Tailwind CSS (pastel theme)
│   └── tsconfig.json        # TypeScript config
│
├── docs/                     # Documentation
│   ├── architecture/
│   │   └── overview.md      # System architecture
│   ├── guides/
│   │   ├── testing.md       # Testing guide
│   │   └── logging.md       # Logging guide
│   ├── design/
│   │   └── v0-prompts.md    # UI design system (v0.dev)
│   ├── plans/
│   │   └── roadmap.md       # Product roadmap
│   └── TODO.md              # Current tasks & bugs
│
├── tests/                    # Backend Tests
│   ├── api/                 # API endpoint tests
│   ├── domain/              # Domain logic tests
│   ├── services/            # Service tests
│   └── conftest.py          # Pytest fixtures
│
├── scripts/                  # Development Scripts
│   ├── start-backend.sh     # Start backend server
│   ├── start-frontend.sh    # Start frontend dev server
│   └── dev.sh               # Start both (legacy)
│
├── .env                      # Environment variables (local)
├── .env.example              # Environment template
├── pyproject.toml            # Python project config
├── CLAUDE.md                 # This file! (AI assistant context)
└── README.md                 # User-facing documentation
```

---

## 🔑 Key Concepts & Workflows

### 1. Pantry Management

**Models:**
- `PantryItem` - Core data model with computed properties
- `Category` - Enum: produce, dairy, meat, seafood, frozen, pantry, beverages, condiments, bakery, snacks, other
- `Location` - Enum: fridge, freezer, pantry, counter

**Auto-categorization Flow:**
```python
User adds "milk" → normalize_food_name("milk") → "milk"
                → detect_category("milk") → Category.DAIRY
                → get_default_location(DAIRY) → Location.FRIDGE
                → estimate_expiry_days("milk", DAIRY, FRIDGE) → 7 days
```

**Smart Defaults (NEW in 0.2.0):**
```python
# If AI doesn't return quantity/unit, use smart defaults
"eggs" → quantity: 1, unit: "dozen"
"milk" → quantity: 1, unit: "gallon"
"crackers" → quantity: 1, unit: "box"
"chicken" → quantity: 1, unit: "lb"
```

### 2. Receipt Scanning Flow

**Updated Flow (as of 2026-03-06):**

```
1. User uploads receipt image
   ↓
2. Backend: OCR extracts text (Tesseract)
   ↓
3. Backend: AI parses items with confidence scores
   ↓
4. Backend: Split by confidence:
   - ≥ 0.8 → ready_to_add (NOT added to DB yet!)
   - 0.5-0.8 → needs_review
   - < 0.5 → skipped
   ↓
5. Frontend: Display 3 sections:
   - "Ready to Add" (green) - High confidence, editable
   - "Please Check" (orange) - Medium confidence, editable
   - "Skipped" (gray) - Low confidence, can promote to review
   ↓
6. User reviews/edits ALL items
   ↓
7. User clicks "Add X Items to Pantry"
   ↓
8. Backend: ALL items written to database at once
```

**Key Improvement (v0.2.0):**
- **Before:** High confidence items auto-added immediately (user had to undo)
- **After:** Nothing added until user confirms (full control)

**AI Prompt Improvements:**
- Explicit rule: "Ignore prices - numbers with decimals are NOT quantities"
- Examples: "Eggs 6.17" → quantity: null (not 6)
- Only extract quantity if explicitly part of product (e.g., "12pk")

### 3. Domain Logic

**Food Name Normalization:**
```python
normalize_food_name("ORGANIC WHOLE MILK 1GAL") → "organic whole milk"
# Lowercase, remove extra whitespace, strip PLU codes
```

**Category Detection:**
Uses keyword matching + synonyms:
```python
detect_category("chicken breast") → "meat"
detect_category("almond milk") → "dairy"  # Has "milk"
detect_category("ice cream") → "frozen"
```

**Expiry Estimation:**
```python
estimate_expiry_days("milk", "dairy", "fridge") → 7 days
estimate_expiry_days("chicken", "meat", "fridge") → 3 days
estimate_expiry_days("frozen peas", "frozen", "freezer") → 180 days
```

### 4. AI Provider System

**Pluggable Architecture:**
```python
class AIProvider(Protocol):
    async def complete(prompt: str, response_schema: Type[T]) -> T | str
    def is_available() -> bool

class AIManager:
    def __init__(self, providers: list[AIProvider]):
        self.providers = providers  # [GeminiProvider(), OllamaProvider()]

    def get_provider() -> AIProvider:
        # Returns first available provider (fallback logic)
        for provider in self.providers:
            if provider.is_available():
                return provider
```

**Structured Output:**
Uses Pydantic models for type-safe AI responses:
```python
class ReceiptItem(BaseModel):
    name: str
    quantity: float | None
    unit: str | None
    confidence: float

result = await ai_manager.complete(
    prompt=RECEIPT_PARSE_PROMPT,
    response_schema=LLMReceiptOutput  # Enforces structure
)
```

---

## 🎨 Design System (Sanrio/Kawaii Aesthetic)

### Color Palette
```css
--pastel-pink: #FFB5C5;      /* Primary accent */
--pastel-mint: #B5EAD7;      /* Success states */
--pastel-lavender: #C9B5E8;  /* Secondary accent */
--pastel-peach: #FFDAB3;     /* Warning states */
--pastel-coral: #FF9AA2;     /* Alert states */
--pastel-yellow: #FFF1B5;    /* Highlights */
--cream-white: #FFF9F5;      /* Background */
--soft-charcoal: #4A4A4A;    /* Text */
```

### Design Principles
- **Rounded everything:** 12-16px border radius on all UI elements
- **Pill-shaped buttons:** Fully rounded (999px radius)
- **Emoji-driven:** Use food emojis instead of icon fonts
- **Soft shadows:** Warm-toned, subtle depth
- **Mobile-first:** Max-width 480px, centered layout
- **Friendly fonts:** Nunito/Quicksand (rounded sans-serif)

### Component Patterns
- **Cards:** White background, soft shadow, rounded corners
- **Sections:** Pastel backgrounds with matching borders
- **Buttons:** Pill-shaped, bold text, active state scale
- **Inputs:** Rounded, pastel borders, ring on focus

---

## 🔧 Development Guidelines

### Backend (Python)

**Code Style:**
- Use `ruff` for linting (line length: 100)
- Type hints everywhere (mypy strict mode)
- Async/await for all I/O operations
- Pydantic for validation and serialization

**Conventions:**
```python
# Dependency injection via FastAPI
async def get_repository() -> PantryRepository:
    return SQLiteRepository(...)

@router.get("/api/pantry")
async def list_pantry_items(
    repo: Annotated[PantryRepository, Depends(get_repository)]
):
    ...

# Logging with structured context
from bubbly_chef.logger import get_logger
logger = get_logger(__name__)

logger.info("Item added", extra={"item_id": item.id, "category": item.category})
```

**Testing:**
```bash
# Run all tests
pytest

# With coverage
pytest --cov=bubbly_chef

# Specific test file
pytest tests/domain/test_normalizer.py -v

# Test pattern
pytest -k "test_receipt"
```

### Frontend (React + TypeScript)

**Code Style:**
- TypeScript strict mode
- Functional components + hooks
- Tailwind for styling (no custom CSS)
- React Query for server state

**Conventions:**
```typescript
// API client with React Query
export function usePantryItems() {
  return useQuery({
    queryKey: ['pantry'],
    queryFn: fetchPantryItems,
  });
}

// Mutations with cache invalidation
export function useCreatePantryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPantryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

// Component structure
export function Pantry() {
  const { data, isLoading } = usePantryItems();

  if (isLoading) return <Loading />;

  return (
    <div className="p-4 space-y-4">
      {data?.items.map(item => (
        <PantryItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
```

**Building:**
```bash
cd web
npm run build  # Production build
npm run dev    # Development server
```

---

## 📡 API Reference

### Base URLs
- Backend: `http://localhost:8888`
- Frontend: `http://localhost:5173`
- API Docs: `http://localhost:8888/docs` (Swagger UI)

### Endpoints

#### Health
```
GET  /health                    → { status: "healthy", version: "0.2.0" }
GET  /health/ai                 → { healthy: true, providers: [...] }
```

#### Pantry
```
GET    /api/pantry              → { items: [...], total_count: N, ... }
GET    /api/pantry?category=dairy
GET    /api/pantry?location=fridge
GET    /api/pantry?search=milk
GET    /api/pantry/expiring?days=3
GET    /api/pantry/:id          → PantryItem
POST   /api/pantry              → PantryItem (creates with auto-category/expiry)
PUT    /api/pantry/:id          → PantryItem (updates)
DELETE /api/pantry/:id          → { success: true, deleted_id: "..." }
```

#### Receipt Scanning
```
GET    /api/scan/ocr-status     → { available: bool, service: "tesseract", ... }
POST   /api/scan/receipt        → { request_id, ready_to_add: [...], needs_review: [...], skipped: [...] }
POST   /api/scan/confirm        → { added: [...], failed: [...] }
```

**Scan Receipt Request:**
```
POST /api/scan/receipt
Content-Type: multipart/form-data

image: <file>
```

**Scan Receipt Response:**
```json
{
  "request_id": "uuid",
  "ready_to_add": [  // High confidence (≥0.8), NOT in DB yet
    {
      "temp_id": "uuid",
      "name": "Eggs",
      "quantity": 1,
      "unit": "dozen",
      "confidence": 0.95,
      "category": "dairy",
      "location": "fridge",
      ...
    }
  ],
  "needs_review": [  // Medium confidence (0.5-0.8)
    { "temp_id": "uuid", "name": "Aubergine", "confidence": 0.65, ... }
  ],
  "skipped": [  // Low confidence (<0.5)
    { "temp_id": "uuid", "name": "XTRA SAVINGS", "confidence": 0.2, ... }
  ],
  "warnings": ["OCR quality low"]
}
```

**Confirm Items Request:**
```json
{
  "request_id": "uuid",
  "items": [
    {
      "temp_id": "uuid",
      "name": "Eggs",
      "quantity": 1,
      "unit": "dozen"
    }
  ]
}
```

#### Recipe Generation
```
POST   /api/recipes/generate     → { recipe, ingredients_status, missing_count, ... }
GET    /api/recipes/suggestions  → ["Use up my chicken...", "Quick dinner...", ...]
```

**Generate Recipe Request:**
```json
{
  "prompt": "What can I make with chicken?",
  "constraints": {
    "max_time_minutes": 30,
    "cuisine": "asian",
    "dietary": ["gluten-free"],
    "use_expiring": true,
    "servings": 4
  },
  "previous_recipe_context": "{...}"  // Optional, for follow-ups
}
```

**Generate Recipe Response:**
```json
{
  "recipe": {
    "id": "uuid",
    "title": "Honey Garlic Chicken Stir-Fry",
    "description": "A quick and delicious stir-fry...",
    "prep_time_minutes": 10,
    "cook_time_minutes": 15,
    "total_time_minutes": 25,
    "servings": 4,
    "ingredients": [
      { "name": "chicken breast", "quantity": 1, "unit": "lb", "preparation": "sliced" },
      { "name": "garlic", "quantity": 3, "unit": "cloves", "preparation": "minced" }
    ],
    "instructions": [
      "Slice chicken breast into strips",
      "Mince garlic and prepare sauce",
      "Heat oil in wok over high heat..."
    ],
    "tips": ["Add more honey for sweeter taste"],
    "cuisine": "Asian",
    "difficulty": "easy"
  },
  "ingredients_status": [
    { "ingredient_name": "chicken breast", "status": "have", "pantry_item_name": "Chicken Breast" },
    { "ingredient_name": "soy sauce", "status": "missing" }
  ],
  "missing_count": 2,
  "have_count": 5,
  "partial_count": 0,
  "pantry_match_score": 0.71
}
```

---

## 🧪 Testing

### Backend Tests

**Structure:**
```
tests/
├── api/
│   ├── test_pantry.py        # Pantry CRUD endpoints
│   └── test_scan.py          # Receipt scanning endpoints
├── domain/
│   ├── test_normalizer.py    # Name normalization + categorization
│   ├── test_expiry.py        # Expiry estimation
│   └── test_defaults.py      # Smart defaults (NEW)
├── services/
│   ├── test_ocr.py           # OCR service
│   └── test_receipt_parser.py # AI parsing (mocked)
└── conftest.py               # Shared fixtures
```

**Running Tests:**
```bash
# All tests
pytest

# Specific module
pytest tests/domain/

# With coverage report
pytest --cov=bubbly_chef --cov-report=html

# Watch mode (requires pytest-watch)
ptw
```

**Mocking AI Providers:**
```python
@pytest.fixture
def mock_ai_manager():
    manager = Mock(spec=AIManager)
    manager.complete.return_value = LLMReceiptOutput(
        items=[{"name": "Milk", "quantity": 1, "unit": "gallon", "confidence": 0.9}]
    )
    return manager
```

### Frontend Tests
(Not yet implemented - TODO)

---

## 🔐 Configuration

### Environment Variables

**Required:**
```bash
BUBBLY_GEMINI_API_KEY=your-key-here  # Get from https://aistudio.google.com/
```

**Optional:**
```bash
# Ollama (self-hosted AI)
BUBBLY_OLLAMA_BASE_URL=http://localhost:11434
BUBBLY_OLLAMA_MODEL=llama3.2:3b

# Database
BUBBLY_DATABASE_URL=sqlite+aiosqlite:///./bubbly_chef.db

# Receipt Scanning
BUBBLY_AUTO_ADD_CONFIDENCE_THRESHOLD=0.8
BUBBLY_REVIEW_CONFIDENCE_THRESHOLD=0.5

# CORS
BUBBLY_CORS_ORIGINS=["http://localhost:5173"]

# Debug
BUBBLY_DEBUG=false
```

**Setup:**
```bash
cp .env.example .env
# Edit .env with your values
```

---

## 📝 Common Tasks

### Adding a New Pantry Field

1. **Update model** (`bubbly_chef/models/pantry.py`):
   ```python
   class PantryItem(BaseModel):
       ...
       new_field: str | None = None
   ```

2. **Update database schema** (`bubbly_chef/repository/sqlite.py`):
   ```python
   CREATE TABLE pantry_items (
       ...
       new_field TEXT
   )
   ```

3. **Update API types** (`web/src/types/index.ts`):
   ```typescript
   export interface PantryItem {
       ...
       new_field: string | null;
   }
   ```

4. **Update UI** (`web/src/pages/Pantry.tsx`):
   ```tsx
   <p>{item.new_field}</p>
   ```

### Adding a New API Endpoint

1. **Add route** (`bubbly_chef/api/routes/pantry.py`):
   ```python
   @router.get("/api/pantry/custom")
   async def custom_endpoint():
       return {"data": "..."}
   ```

2. **Add API client** (`web/src/api/client.ts`):
   ```typescript
   async function customEndpoint(): Promise<CustomResponse> {
       const response = await fetch(`${API_BASE_URL}/api/pantry/custom`);
       return response.json();
   }

   export function useCustomEndpoint() {
       return useQuery({
           queryKey: ['custom'],
           queryFn: customEndpoint,
       });
   }
   ```

3. **Use in component**:
   ```tsx
   const { data } = useCustomEndpoint();
   ```

### Updating Smart Defaults

Edit `bubbly_chef/domain/defaults.py`:
```python
DEFAULT_QUANTITIES = {
    "new_item": {"quantity": 1, "unit": "package"},
    ...
}
```

---

## 🚀 Deployment (Future)

Not yet implemented. Future considerations:
- Docker containerization
- Database migrations (Alembic)
- Environment-specific configs
- Cloud deployment (Render, Railway, Fly.io)
- CI/CD pipeline

---

## 🐛 Known Issues & Limitations

### Current Limitations
- **Unit conversion not supported** - Can't deduct "3 eggs" from "1 dozen eggs"
- **No user authentication** - Single-user only
- **No offline support** - Requires network for AI calls
- **Receipt quality dependent** - Poor lighting/crumpled receipts may fail
- **SQLite only** - No PostgreSQL support yet

### TODO Items
See `docs/TODO.md` for complete list. Key items:
- [ ] Unit conversion system for recipe integration
- [ ] Recipe management (Phase 1C)
- [ ] User authentication (Phase 2)
- [ ] Pagination for large pantries
- [ ] Bulk operations (delete multiple items)
- [ ] Mobile PWA setup

---

## 📚 Additional Documentation

- **[README.md](README.md)** - User-facing quick start
- **[docs/architecture/overview.md](docs/architecture/overview.md)** - Detailed architecture
- **[docs/TODO.md](docs/TODO.md)** - Current sprint & roadmap
- **[docs/guides/testing.md](docs/guides/testing.md)** - Testing strategy
- **[docs/guides/logging.md](docs/guides/logging.md)** - Logging system
- **[docs/design/v0-prompts.md](docs/design/v0-prompts.md)** - UI design system

---

## 🎯 Current Phase: 1C Complete

### Completed Features ✅
- Pantry CRUD (create, read, update, delete)
- Auto-categorization and expiry estimation
- Receipt scanning with OCR + AI parsing
- Confidence-based review workflow
- Smart quantity/unit defaults
- Editable high-confidence items
- Skipped items visibility
- **Recipe Generation (Phase 1C)**
  - AI-powered recipe generation from prompts
  - Pantry-grounded suggestions (uses your ingredients)
  - Expiring item prioritization
  - Ingredient availability status (have/partial/missing)
  - Follow-up support ("make it spicier")

### Next Phase: 2 - Dashboard & Chat
- Dashboard home page with insights
- Chat interface for natural language interactions
- Recipe saving and management
- Shopping list generation

---

## 📋 Documentation Update Checklist

**IMPORTANT:** When implementing a new feature, update these docs:

### For Every Feature:
- [ ] **This file (CLAUDE.md)** - Add to architecture, workflows, or API reference
- [ ] **docs/TODO.md** - Mark task as complete, add new tasks if discovered
- [ ] **Git commit message** - Use clear, descriptive commits

### For Major Features:
- [ ] **README.md** - Update feature list, quick start if changed
- [ ] **docs/architecture/overview.md** - Update diagrams, data flows
- [ ] **API docs (Swagger)** - FastAPI auto-generates, but verify examples

### For Breaking Changes:
- [ ] **CHANGELOG.md** - Document breaking changes (TODO: create this file)
- [ ] **Migration guide** - Document upgrade path
- [ ] **Frontend types** - Update TypeScript interfaces
- [ ] **Backend models** - Update Pydantic schemas

### Documentation Triggers:

**Always update docs when:**
1. Adding/removing API endpoints
2. Changing data models (PantryItem, etc.)
3. Adding new environment variables
4. Changing configuration options
5. Introducing new dependencies
6. Modifying core workflows (receipt scanning, etc.)
7. Adding smart defaults or business logic
8. Changing database schema

**Example Commit Messages:**
```
feat: Add unit conversion system for recipe consumption
- Add UnitConverter class with conversion table
- Update PantryItem model with base_unit field
- Add /api/pantry/convert endpoint
- Update CLAUDE.md with unit conversion workflow
- Update TODO.md with remaining conversion tasks

docs: Update receipt scanning flow in CLAUDE.md
- Document new 3-state review process
- Add API examples for scan endpoints
- Update architecture diagrams

fix: Correct smart defaults for crackers
- Change crackers default from "lb" to "box"
- Update defaults.py documentation
```

---

## 🤝 Contributing

1. Check `docs/TODO.md` for open tasks
2. Read this file (CLAUDE.md) for architecture context
3. Follow code style conventions (ruff for Python, prettier for TS)
4. Write tests for new features
5. **Update documentation** (see checklist above)
6. Create clear commit messages

---

## 📄 License

MIT

---

**Last Updated:** 2026-03-08
**Current Version:** 0.2.0
