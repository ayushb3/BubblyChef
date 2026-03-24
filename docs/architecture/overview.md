# Bubbly Chef — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │Dashboard │  │  Pantry  │  │   Scan   │  │      Chat        │ │
│  │  Home    │  │   List   │  │ Receipt  │  │  (Phase 2)       │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
└───────┼─────────────┼─────────────┼─────────────────┼───────────┘
        │             │             │                 │
        └─────────────┴──────┬──────┴─────────────────┘
                             │ HTTP/REST
┌────────────────────────────┼────────────────────────────────────┐
│                    Backend (FastAPI)                             │
│  ┌─────────────────────────┴─────────────────────────────────┐  │
│  │                      API Layer                             │  │
│  │  /pantry    /scan    /recipes    /chat                     │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
│                            │                                     │
│  ┌─────────────────────────┼─────────────────────────────────┐  │
│  │                   Service Layer                            │  │
│  │  ┌──────────┐  ┌────────┴───────┐  ┌──────────────────┐   │  │
│  │  │ Pantry   │  │    AI Manager  │  │   Normalizer     │   │  │
│  │  │ Service  │  │                │  │   + Expiry       │   │  │
│  │  └────┬─────┘  └───────┬────────┘  └──────────────────┘   │  │
│  └───────┼────────────────┼──────────────────────────────────┘  │
│          │                │                                      │
│  ┌───────┴────────┐  ┌────┴─────────────────────────────────┐   │
│  │  Repository    │  │         AI Providers                  │   │
│  │  (SQLite)      │  │  ┌────────┐  ┌────────┐  ┌────────┐  │   │
│  │                │  │  │ Gemini │  │ Ollama │  │ Groq   │  │   │
│  └───────┬────────┘  │  └────────┘  └────────┘  └────────┘  │   │
│          │           └──────────────────────────────────────┘   │
│          │                                                       │
│  ┌───────┴────────┐                                             │
│  │    SQLite      │                                             │
│  │   Database     │                                             │
│  └────────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
bubbly_chef/
├── api/
│   ├── app.py               # FastAPI app factory, lifespan, middleware
│   └── routes/
│       ├── health.py        # Health check
│       ├── pantry.py        # Pantry CRUD
│       ├── scan.py          # Receipt scanning (OCR + AI)
│       ├── recipes.py       # Recipe generation
│       ├── chat.py          # Chat orchestrator
│       ├── ingest.py        # AI ingest endpoints
│       ├── apply.py         # Apply proposals to DB
│       ├── profile.py       # User profile
│       ├── icons.py         # Fluent emoji icon API
│       └── decorations.py   # Kitchen scene decorations
│
├── ai/
│   ├── provider.py          # AIProvider protocol
│   ├── manager.py           # AIManager (provider selection + fallback)
│   ├── gemini.py            # Gemini free tier
│   └── ollama.py            # Self-hosted Ollama
│
├── workflows/               # LangGraph state machines
│   ├── state.py
│   ├── chat_ingest.py       # Chat → intent routing
│   ├── receipt_ingest.py    # Receipt → pantry
│   ├── product_ingest.py    # Product → pantry
│   └── recipe_ingest.py     # Recipe text → recipe card
│
├── domain/
│   ├── normalizer.py        # Food name normalization + categorization
│   ├── expiry.py            # Expiry date heuristics
│   ├── defaults.py          # Smart quantity/unit defaults
│   ├── icon_map.py          # Name → emoji/icon mapping
│   └── pantry_catalog.json  # 304-entry USDA-backed food catalog
│
├── models/
│   ├── pantry.py            # PantryItem, Category, Location
│   ├── recipes.py           # RecipeCard
│   ├── user.py              # UserProfile
│   └── proposals.py         # ProposalEnvelope
│
├── services/
│   ├── ocr.py               # Tesseract OCR wrapper
│   ├── receipt_parser.py    # AI-powered receipt parsing
│   └── image_preprocessor.py
│
├── tools/
│   ├── llm_client.py        # Ollama client
│   ├── normalizer.py        # Normalization utilities
│   ├── expiry.py            # Expiry tools
│   └── product_lookup.py    # Product lookup
│
├── repository/
│   ├── base.py              # Repository protocol
│   └── sqlite.py            # SQLite implementation (all DB access here)
│
└── config.py                # Settings from env vars

web/src/
├── api/client.ts            # API client + React Query hooks
├── pages/                   # Dashboard, Pantry, Scan, Chat, Profile
├── components/
│   ├── kitchen/             # DOMKitchenScene, InteriorView, KitchenItem
│   └── ...                  # Shared UI components
└── types/index.ts
```

---

## Core Components

### AI Provider Abstraction

```python
# ai/provider.py
from typing import Protocol, TypeVar, Type
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

class AIProvider(Protocol):
    """Base protocol for AI providers"""

    async def complete(
        self,
        prompt: str,
        response_schema: Type[T] | None = None
    ) -> T | str:
        """Generate completion, optionally with structured output"""
        ...

    async def complete_with_tools(
        self,
        prompt: str,
        tools: list["Tool"],
        response_schema: Type[T] | None = None
    ) -> T | str:
        """Generate with tool calling support"""
        ...

    def is_available(self) -> bool:
        """Check if provider is currently available"""
        ...
```

```python
# ai/manager.py
class AIManager:
    """Manages AI provider selection and fallback"""

    def __init__(self, providers: list[AIProvider]):
        self.providers = providers

    def get_provider(self) -> AIProvider:
        """Return first available provider"""
        for provider in self.providers:
            if provider.is_available():
                return provider
        raise NoProviderAvailableError()

    async def complete(self, prompt: str, **kwargs):
        """Convenience method using best available provider"""
        provider = self.get_provider()
        return await provider.complete(prompt, **kwargs)
```

### Repository Pattern

```python
# repository/base.py
from typing import Protocol
from models.pantry import PantryItem

class PantryRepository(Protocol):
    """Abstract pantry data access"""

    async def get_all(self) -> list[PantryItem]: ...
    async def get_by_id(self, id: str) -> PantryItem | None: ...
    async def get_expiring_soon(self, days: int = 3) -> list[PantryItem]: ...
    async def add(self, item: PantryItem) -> PantryItem: ...
    async def update(self, item: PantryItem) -> PantryItem: ...
    async def delete(self, id: str) -> bool: ...
    async def search(self, query: str) -> list[PantryItem]: ...
```

### Domain Models

```python
# models/pantry.py
from pydantic import BaseModel
from datetime import date, datetime
from enum import Enum

class Category(str, Enum):
    PRODUCE = "produce"
    DAIRY = "dairy"
    MEAT = "meat"
    SEAFOOD = "seafood"
    FROZEN = "frozen"
    PANTRY = "pantry"
    BEVERAGES = "beverages"
    CONDIMENTS = "condiments"
    OTHER = "other"

class Location(str, Enum):
    FRIDGE = "fridge"
    FREEZER = "freezer"
    PANTRY = "pantry"
    COUNTER = "counter"

class PantryItem(BaseModel):
    id: str
    name: str
    name_normalized: str
    category: Category
    location: Location
    quantity: float
    unit: str
    expiry_date: date | None = None
    added_at: datetime
    updated_at: datetime

    @property
    def days_until_expiry(self) -> int | None:
        if not self.expiry_date:
            return None
        return (self.expiry_date - date.today()).days

    @property
    def is_expiring_soon(self) -> bool:
        days = self.days_until_expiry
        return days is not None and days <= 3

    @property
    def is_expired(self) -> bool:
        days = self.days_until_expiry
        return days is not None and days < 0
```

---

## API Endpoints

### Pantry
```
GET    /api/pantry              # List all items
GET    /api/pantry/:id          # Get single item
POST   /api/pantry              # Add item
PUT    /api/pantry/:id          # Update item
DELETE /api/pantry/:id          # Delete item
GET    /api/pantry/expiring     # Get expiring soon items
```

### Scan
```
POST   /api/scan/receipt        # Upload receipt image
POST   /api/scan/confirm        # Confirm parsed items
```

### Recipes
```
POST   /api/recipes/generate    # Generate recipe from prompt
GET    /api/recipes             # List saved recipes (Phase 2+)
POST   /api/recipes             # Save recipe (Phase 2+)
```

### Chat (Phase 2)
```
POST   /api/chat                # Send message, get response
GET    /api/chat/history        # Get conversation history
```

---

## Data Flow Examples

### Receipt Scanning Flow

```
User uploads receipt image
         │
         ▼
┌─────────────────┐
│  /api/scan/     │
│  receipt        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  OCR Service    │────▶│  Raw text       │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  AI Provider    │
                        │  (parse items)  │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Normalizer +   │
                        │  Expiry lookup  │
                        └────────┬────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────┐
│  Response: {                                       │
│    auto_added: [...],    # confidence > 0.8       │
│    needs_review: [...],  # confidence < 0.8       │
│  }                                                 │
└───────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  UI shows:      │
│  - Auto-added   │
│    (with undo)  │
│  - Review list  │
└─────────────────┘
```

### Recipe Generation Flow

```
User: "What can I make with chicken?"
         │
         ▼
┌─────────────────┐
│  /api/recipes/  │
│  generate       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Fetch pantry   │
│  items          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AI Provider    │
│  with context:  │
│  - User prompt  │
│  - Pantry list  │
└────────┬────────┘
         │
         ▼
┌───────────────────────────────────────────────────┐
│  Response: {                                       │
│    recipe: {                                       │
│      title: "...",                                │
│      ingredients: [...],                          │
│      instructions: [...]                          │
│    },                                              │
│    have: ["chicken", "garlic", "soy sauce"],     │
│    missing: ["ginger", "sesame oil"]              │
│  }                                                 │
└───────────────────────────────────────────────────┘
```

---

## Configuration

```python
# config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite+aiosqlite:///./bubbly_chef.db"

    # AI Providers
    gemini_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"

    # OCR
    ocr_provider: str = "tesseract"  # or "google_vision"
    google_vision_key: str | None = None

    # App
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:5173"]

    class Config:
        env_prefix = "BUBBLY_"
        env_file = ".env"
```

---

## Testing Strategy

```
tests/
├── api/                    # API route tests
├── domain/                 # Domain logic tests
├── ai/                     # AI provider tests (mocked)
├── workflows/              # LangGraph workflow tests
└── conftest.py             # Shared fixtures, temp SQLite DB
```

**Testing approach:**
- Mock AI providers for deterministic tests
- Test domain logic independently
- Async test client via `ASGITransport` + `AsyncClient`
- Coverage target: ≥ 80% on core modules
