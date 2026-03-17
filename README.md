# BubblyChef 🍳

AI-first agentic workflow service for pantry and recipe management. This service powers the intelligence behind a mobile app, handling receipt parsing, product scanning, chat-based pantry updates, and recipe extraction.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Web Frontend (React + TS)                    │
│                     http://localhost:5173                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP/REST
┌─────────────────────────▼───────────────────────────────────────┐
│                     BubblyChef Service                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    FastAPI Endpoints                      │   │
│  │  /health  /ingest/*  /pantry  /chat  /scan  /recipes     │   │
│  │  /apply  /profile  /workflows/*                          │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────▼───────────────────────────────┐   │
│  │              LangGraph Workflows                          │   │
│  │  chat_ingest  receipt_ingest  product_ingest  recipe_ingest│  │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────▼───────────────────────────────┐   │
│  │                    Tooling Layer                          │   │
│  │  LLMClient(Ollama)  Normalizer  ExpiryHeuristics  Repo   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    External Services                             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │Gemini (Default)│  │ SQLite (Local) │  │ OpenFoodFacts    │   │
│  │  + Ollama      │  │ Data Store     │  │ (Stub for now)   │   │
│  │  LLM Backends  │  └────────────────┘  └──────────────────┘   │
│  └────────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Principles

1. **AI-First but Deterministic When Possible**: LLM is used only for ambiguous extraction. Normalization, expiry estimation, and category detection use deterministic rules.

2. **Proposals, Not Mutations**: Every AI workflow returns a `ProposalEnvelope` with confidence scores. The service NEVER mutates state directly from LLM output without human review.

3. **Human-in-the-Loop**: UI receives proposals, displays them for review, and sends approved proposals to `/v1/apply` endpoint.

4. **Free/Local First**: Uses Ollama for local LLM inference. No paid API dependencies.

## Prerequisites

### 1. Gemini API Key (Recommended — Free Tier)

Get a free API key from [Google AI Studio](https://aistudio.google.com/) and set it in your `.env`:

```bash
BUBBLY_GEMINI_API_KEY=your-key-here
```

### 2. Install Ollama (Optional — Local Fallback)

```bash
# macOS
brew install ollama

# Or download from https://ollama.ai
```

### 2. Start Ollama and Pull Model

```bash
# Start Ollama service
ollama serve

# In another terminal, pull the model
ollama pull llama3.2:3b
```

The default model is `llama3.2:3b` which provides a good balance of speed and quality. You can use other models by setting the `BUBBLY_OLLAMA_MODEL` environment variable.

Alternative models:

- `llama3.2:1b` - Faster, less accurate
- `llama3.2:8b` - More accurate, slower
- `mistral:7b` - Good alternative

### 3. Python Environment

```bash
# Requires Python 3.11+
python --version  # Should be 3.11 or higher

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -e ".[dev]"
```

### 4. Web Frontend (Optional)

```bash
# Requires Node.js 18+
cd web && npm install
```

## Running the Server

### Development Mode

```bash
# Backend (from project root)
uvicorn bubbly_chef.api.app:app --reload --host 0.0.0.0 --port 8888

# Frontend (in a separate terminal)
cd web && npm run dev
```

Or use the helper scripts:

```bash
./scripts/start-backend.sh   # Backend on http://localhost:8888
./scripts/start-frontend.sh  # Frontend on http://localhost:5173
```

### Production Mode

```bash
uvicorn bubbly_chef.api.app:app --host 0.0.0.0 --port 8888 --workers 4
```

### Environment Variables

Copy the example file and fill in your API key:

```bash
cp .env.example .env
```

`.env.example` (full reference):

```bash
# BubblyChef Environment Configuration

# =============================================================================
# AI Providers (at least one required)
# =============================================================================

# Gemini (Recommended - Free Tier)
# Get your key at: https://aistudio.google.com/
BUBBLY_GEMINI_API_KEY=your-gemini-api-key-here

# Ollama (Self-hosted - Optional)
# Install: https://ollama.ai/
BUBBLY_OLLAMA_BASE_URL=http://localhost:11434
BUBBLY_OLLAMA_MODEL=llama3.2:3b

# =============================================================================
# Application Settings
# =============================================================================

# Debug mode (set to true for verbose logging)
BUBBLY_DEBUG=false

# Database location
BUBBLY_DATABASE_URL=sqlite+aiosqlite:///./bubbly_chef.db

# CORS origins (frontend URLs)
BUBBLY_CORS_ORIGINS=["http://localhost:5173", "http://localhost:3000"]

# =============================================================================
# Receipt Scanning
# =============================================================================

# Confidence thresholds
BUBBLY_AUTO_ADD_CONFIDENCE_THRESHOLD=0.8
BUBBLY_REVIEW_CONFIDENCE_THRESHOLD=0.5

# =============================================================================
# Logging
# =============================================================================

# Optional log file path (leave empty to log to console only)
# BUBBLY_LOG_FILE=./logs/bubbly_chef.log

# Enable request/response logging (default: true)
BUBBLY_LOG_REQUESTS=true
```

## API Endpoints

Base URL: `http://localhost:8888`  
Interactive docs: `http://localhost:8888/docs`

### Health Check

```bash
curl http://localhost:8888/health
```

Response:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "ollama_available": true,
  "ollama_model": "llama3.2:3b"
}
```

### Chat API (Main Conversational Interface)

The `/chat` endpoint is the primary conversational interface. It handles:

- **Pantry updates**: "I bought milk and eggs"
- **Receipt scan requests**: "I want to scan a receipt"
- **Product lookup requests**: "Scan this barcode"
- **Recipe imports**: "I want to save this recipe"
- **General questions**: "How long does cheese last?"

#### Basic Usage

```bash
curl -X POST http://localhost:8888/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I bought 2 gallons of milk and a dozen eggs"
  }'
```

Response for pantry update:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "workflow_id": "660e8400-e29b-41d4-a716-446655440001",
  "schema_version": "1.0.0",
  "intent": "pantry_update",
  "assistant_message": "I found 2 items. Please review before updating your pantry.",
  "proposal": {
    "actions": [
      {
        "action_type": "add",
        "item": {
          "name": "milk",
          "quantity": 2,
          "unit": "gallon",
          "category": "dairy"
        },
        "confidence": 0.9
      },
      {
        "action_type": "add",
        "item": {
          "name": "eggs",
          "quantity": 12,
          "unit": "item",
          "category": "dairy"
        },
        "confidence": 0.85
      }
    ]
  },
  "confidence": { "overall": 0.87 },
  "requires_review": true,
  "next_action": "review_proposal"
}
```

#### Receipt Scan Request

```bash
curl -X POST http://localhost:8888/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I want to scan a receipt"}'
```

Response (handoff):

```json
{
  "intent": "receipt_ingest_request",
  "assistant_message": "I can help you add items from a receipt! Please upload a photo or paste the text.",
  "proposal": {
    "kind": "receipt",
    "instructions": "Upload a photo of your receipt or paste the text.",
    "required_inputs": ["receipt_image"]
  },
  "next_action": "request_receipt_image"
}
```

#### General Chat

```bash
curl -X POST http://localhost:8888/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How long does cheese last in the fridge?"}'
```

Response:

```json
{
  "intent": "general_chat",
  "assistant_message": "Hard cheeses like cheddar can last 3-4 weeks in the fridge once opened...",
  "proposal": null,
  "next_action": "none"
}
```

### Understanding next_action

The `next_action` field tells the UI what to display or prompt next:

| Value                     | Description                                |
| ------------------------- | ------------------------------------------ |
| `none`                    | No action needed, just display the message |
| `review_proposal`         | Show the proposal for user review/edit     |
| `request_receipt_image`   | Prompt user to upload a receipt photo      |
| `request_product_barcode` | Prompt user to scan a barcode              |
| `request_product_photos`  | Prompt user to take product photos         |
| `request_recipe_text`     | Prompt user for recipe URL/text            |
| `request_clarification`   | Ask clarifying questions                   |

### Workflow Events (Resume Paused Workflows)

When a workflow requires human review, you can resume it:

```bash
# Approve a proposal
curl -X POST http://localhost:8888/workflows/{workflow_id}/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "submit_review",
    "decision": "approve"
  }'

# Approve with edits
curl -X POST http://localhost:8888/workflows/{workflow_id}/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "submit_review",
    "decision": "approve_with_edits",
    "edits": {"actions": [...]}
  }'

# Reject
curl -X POST http://localhost:8888/workflows/{workflow_id}/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "submit_review",
    "decision": "reject"
  }'
```

### Chat Ingest (Legacy - Free-form text → Pantry Proposal)

```bash
curl -X POST http://localhost:8888/ingest/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "I bought 2 gallons of milk, a dozen eggs, and 6 apples from the store"
  }'
```

Response:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "schema_version": "1.0.0",
  "intent": "pantry_update",
  "proposal": {
    "actions": [
      {
        "action_type": "add",
        "item": {
          "id": "...",
          "name": "milk",
          "category": "dairy",
          "quantity": 2,
          "unit": "gallon",
          "expiry_date": "2026-02-27",
          "estimated_expiry": true
        },
        "confidence": 0.85
      }
    ],
    "source_text": "I bought 2 gallons of milk...",
    "normalization_applied": true
  },
  "confidence": {
    "overall": 0.85,
    "field_scores": {}
  },
  "warnings": [],
  "errors": [],
  "requires_review": true
}
```

### Receipt Ingest (OCR text → Pantry Proposal)

```bash
curl -X POST http://localhost:8888/ingest/receipt \
  -H "Content-Type: application/json" \
  -d '{
    "ocr_text": "WHOLE FOODS MARKET\n2% MILK 1GAL  $4.99\nORGANIC EGGS DZ  $6.49\nBANANAS  $1.29\nTOTAL  $12.77",
    "store_name": "Whole Foods",
    "purchase_date": "2026-02-17"
  }'
```

### Product Ingest (Barcode/Description → Pantry Proposal)

```bash
# By barcode (uses OpenFoodFacts stub)
curl -X POST http://localhost:8888/ingest/product \
  -H "Content-Type: application/json" \
  -d '{
    "barcode": "0012000001086",
    "quantity": 6,
    "unit": "can"
  }'

# By description
curl -X POST http://localhost:8888/ingest/product \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Organic Greek Yogurt, Vanilla, 32oz",
    "quantity": 1,
    "unit": "container"
  }'
```

### Recipe Generation

```bash
# Generate a recipe from a prompt
curl -X POST http://localhost:8888/recipes/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Quick chicken stir-fry with what I have",
    "constraints": {
      "max_time_minutes": 30,
      "use_expiring": true
    }
  }'
```

Response:

```json
{
  "recipe": {
    "title": "Honey Garlic Chicken Stir-Fry",
    "description": "A quick and delicious stir-fry...",
    "prep_time_minutes": 10,
    "cook_time_minutes": 15,
    "servings": 4,
    "ingredients": [...],
    "instructions": [...]
  },
  "ingredients_status": [
    { "ingredient_name": "chicken breast", "status": "have" },
    { "ingredient_name": "soy sauce", "status": "missing" }
  ],
  "missing_count": 1,
  "have_count": 5,
  "pantry_match_score": 0.83
}
```

```bash
# Get recipe suggestions based on pantry
curl http://localhost:8888/recipes/suggestions
```

### Recipe Ingest (Text/Transcript → Recipe Card Proposal)

```bash
# From text/transcript
curl -X POST http://localhost:8888/ingest/recipe \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Classic Chocolate Chip Cookies\n\nIngredients:\n- 2 1/4 cups flour\n- 1 cup butter\n- 3/4 cup sugar\n- 2 eggs\n- 1 tsp vanilla\n- 2 cups chocolate chips\n\nInstructions:\n1. Cream butter and sugar\n2. Add eggs and vanilla\n3. Mix in flour\n4. Fold in chocolate chips\n5. Bake at 375°F for 9-11 minutes",
    "caption": "Grandmas cookie recipe"
  }'
```

### Apply Proposal (Human-reviewed → Database)

After the UI presents a proposal to the user and they approve it:

```bash
curl -X POST http://localhost:8888/apply \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "intent": "pantry_update",
    "proposal": {
      "actions": [
        {
          "action_type": "add",
          "item": {
            "name": "milk",
            "category": "dairy",
            "quantity": 2,
            "unit": "gallon",
            "storage_location": "fridge",
            "expiry_date": "2026-02-27"
          },
          "confidence": 0.95
        }
      ]
    }
  }'
```

Response:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "applied_count": 1,
  "failed_count": 0,
  "errors": [],
  "affected_item_ids": ["..."]
}
```

### Receipt Scanning

```bash
# Check OCR availability
curl http://localhost:8888/scan/ocr-status

# Scan a receipt image (returns items for review)
curl -X POST http://localhost:8888/scan/receipt \
  -F "image=@receipt.jpg"

# Optionally preprocess the image first for better OCR accuracy
curl -X POST http://localhost:8888/scan/preprocess \
  -F "image=@receipt.jpg" \
  -F "mode=auto"

# Confirm reviewed items (writes to database)
curl -X POST http://localhost:8888/scan/confirm \
  -H "Content-Type: application/json" \
  -d '{"request_id": "...", "items": [...]}'

# Undo a scan session
curl -X POST http://localhost:8888/scan/undo/{request_id}
```

### List Pantry

```bash
# All items
curl http://localhost:8888/pantry

# Filter by category
curl "http://localhost:8888/pantry?category=dairy"

# Filter by storage
curl "http://localhost:8888/pantry?storage=fridge"

# Search by name
curl "http://localhost:8888/pantry?search=milk"
```

### Get Single Pantry Item

```bash
curl http://localhost:8888/pantry/{item_id}
```

### Delete Pantry Item

```bash
curl -X DELETE http://localhost:8888/pantry/{item_id}
```

## Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=bubbly_chef

# Run specific test file
pytest tests/test_normalizer.py

# Run with verbose output
pytest -v
```

## Project Structure

```
bubbly_chef/
├── __init__.py
├── config.py                 # Settings and configuration
├── api/
│   ├── app.py               # FastAPI application factory
│   ├── deps.py              # Dependency injection
│   ├── middleware.py        # Logging middleware
│   └── routes/
│       ├── health.py        # Health check endpoint
│       ├── chat.py          # Chat conversational interface
│       ├── ingest.py        # AI ingest endpoints (chat/receipt/product/recipe)
│       ├── pantry.py        # Pantry query endpoints
│       ├── scan.py          # Receipt scanning (OCR + AI parsing)
│       ├── recipes.py       # Recipe generation endpoints
│       ├── apply.py         # Apply proposals endpoint
│       └── profile.py       # User profile endpoints
├── ai/
│   ├── gemini.py            # Gemini API provider
│   ├── ollama.py            # Ollama local provider
│   ├── manager.py           # AI provider manager with fallback
│   └── provider.py          # AIProvider protocol
├── models/
│   ├── base.py              # ProposalEnvelope, base types
│   ├── pantry.py            # PantryItem, PantryProposal
│   ├── recipe.py            # RecipeCard, RecipeCardProposal
│   ├── user.py              # UserProfile models
│   └── requests.py          # Request/response models
├── services/
│   ├── ocr.py               # Tesseract OCR wrapper
│   ├── receipt_parser.py    # AI-powered receipt parsing
│   ├── recipe_generator.py  # AI recipe generation
│   └── image_preprocessor.py # Image preprocessing for OCR
├── tools/
│   ├── llm_client.py        # Ollama client with circuit breaker
│   ├── normalizer.py        # Food name normalization
│   ├── expiry.py            # Expiry date heuristics
│   └── product_lookup.py    # OpenFoodFacts stub
├── domain/
│   ├── normalizer.py        # Food name normalization + categorization
│   ├── expiry.py            # Expiry estimation
│   └── defaults.py          # Smart quantity/unit defaults
├── repository/
│   ├── base.py              # Repository interface
│   └── sqlite.py            # SQLite implementation
└── workflows/
  ├── state.py             # Shared workflow state
  ├── chat_ingest.py       # Chat → Pantry workflow
  ├── receipt_ingest.py    # Receipt → Pantry workflow
  ├── product_ingest.py    # Product → Pantry workflow
  └── recipe_ingest.py     # Recipe → RecipeCard workflow

web/                          # React + TypeScript frontend
├── src/
│   ├── api/client.ts        # API client + React Query hooks
│   ├── pages/               # Dashboard, Pantry, Scan, Recipes, Profile
│   ├── components/          # Reusable UI components
│   └── types/index.ts       # Shared TypeScript types
├── package.json
└── vite.config.ts
```

## Workflow Details

### Chat Ingest Graph

```
┌─────────────┐    ┌───────────┐    ┌────────┐    ┌───────────────┐    ┌──────────┐
│ parse_llm   │───▶│ normalize │───▶│ expiry │───▶│ create_actions│───▶│ finalize │
│ (LLM call)  │    │ (determ.) │    │(determ)│    │   (determ.)   │    │ (determ.)│
└─────────────┘    └───────────┘    └────────┘    └───────────────┘    └──────────┘
```

Only the first node calls the LLM. All other nodes use deterministic logic.

### Human-in-the-Loop Flow

```
1. User speaks/types: "I bought milk and eggs"
           │
           ▼
2. POST /ingest/chat
           │
           ▼
3. LangGraph workflow generates ProposalEnvelope
   - confidence: 0.85
   - requires_review: true
           │
           ▼
4. UI displays proposal for review
   - User can modify items
   - User approves
           │
           ▼
5. POST /apply with approved proposal
           │
           ▼
6. Items added to pantry database
```

## Confidence Thresholds

- `auto_apply_confidence_threshold`: 0.95 (above this, UI could auto-apply)
- `review_confidence_threshold`: 0.70 (below this, strongly requires review)

## User Profiles

The app now supports user profiles with dietary preferences management:

- **Profile Management**: Create, read, update, and delete user profiles
- **Dietary Preferences**: Track dietary restrictions (vegetarian, vegan, gluten-free, etc.)
- **API Integration**: RESTful endpoints at `/profile/*`
- **UI Component**: Profile page accessible via bottom navigation

### Profile Endpoints

```bash
# Get profile by ID
GET /profile/:id

# Get profile by email
GET /profile/email/:email

# Create new profile
POST /profile
{
  "username": "foodlover",
  "email": "food@example.com",
  "dietary_preferences": ["vegetarian"]
}

# Update profile
PUT /profile/:id
{
  "dietary_preferences": ["vegan", "gluten-free"]
}

# Delete profile
DELETE /profile/:id
```

See `CLAUDE.md` for full API documentation and integration details.

## Future Enhancements

- [ ] Real OpenFoodFacts API integration (barcode scanning)
- [ ] Recipe URL scraping with structured data extraction
- [ ] Video recipe ingestion (TikTok, Instagram Reels, YouTube Shorts)
- [ ] Pantry expiry notifications
- [ ] Shopping list generation from recipes
- [ ] Unit conversion system (e.g. dozen eggs → individual eggs)
- [ ] Meal planning suggestions
- [ ] Mobile app (React Native / Expo)

## License

MIT
