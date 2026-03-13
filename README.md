# BubblyChef 🍳

AI-first agentic workflow service for pantry and recipe management. This service powers the intelligence behind a mobile app, handling receipt parsing, product scanning, chat-based pantry updates, and recipe extraction.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Mobile App (Future)                       │
│                     (Expo/React Native UI)                       │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP/REST
┌─────────────────────────▼───────────────────────────────────────┐
│                     BubblyChef Service                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    FastAPI Endpoints                      │   │
│  │  /health  /v1/ingest/*  /v1/pantry  /v1/recipes  /v1/apply│   │
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
│  │ Ollama (Local) │  │ SQLite (Local) │  │ OpenFoodFacts    │   │
│  │ LLM Runtime    │  │ Data Store     │  │ (Stub for now)   │   │
│  └────────────────┘  └────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Principles

1. **AI-First but Deterministic When Possible**: LLM is used only for ambiguous extraction. Normalization, expiry estimation, and category detection use deterministic rules.

2. **Proposals, Not Mutations**: Every AI workflow returns a `ProposalEnvelope` with confidence scores. The service NEVER mutates state directly from LLM output without human review.

3. **Human-in-the-Loop**: UI receives proposals, displays them for review, and sends approved proposals to `/v1/apply` endpoint.

4. **Free/Local First**: Uses Ollama for local LLM inference. No paid API dependencies.

## Prerequisites

### 1. Install Ollama

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

## Running the Server

### Development Mode

```bash
# From project root
uvicorn bubbly_chef.api.app:app --reload --host 0.0.0.0 --port 8000
```

### Production Mode

```bash
uvicorn bubbly_chef.api.app:app --host 0.0.0.0 --port 8000 --workers 4
```

### Environment Variables

Create a `.env` file or set environment variables:

```bash
# .env
BUBBLY_OLLAMA_BASE_URL=http://localhost:11434
BUBBLY_OLLAMA_MODEL=llama3.2:3b
BUBBLY_OLLAMA_TIMEOUT_SECONDS=60
BUBBLY_DEBUG=false
```

## API Endpoints

### Health Check

```bash
curl http://localhost:8000/health
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

The `/v1/chat` endpoint is the primary conversational interface. It handles:

- **Pantry updates**: "I bought milk and eggs"
- **Receipt scan requests**: "I want to scan a receipt"
- **Product lookup requests**: "Scan this barcode"
- **Recipe imports**: "I want to save this recipe"
- **General questions**: "How long does cheese last?"

#### Basic Usage

```bash
curl -X POST http://localhost:8000/v1/chat \
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
curl -X POST http://localhost:8000/v1/chat \
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
curl -X POST http://localhost:8000/v1/chat \
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
curl -X POST http://localhost:8000/v1/workflows/{workflow_id}/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "submit_review",
    "decision": "approve"
  }'

# Approve with edits
curl -X POST http://localhost:8000/v1/workflows/{workflow_id}/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "submit_review",
    "decision": "approve_with_edits",
    "edits": {"actions": [...]}
  }'

# Reject
curl -X POST http://localhost:8000/v1/workflows/{workflow_id}/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "submit_review",
    "decision": "reject"
  }'
```

### Chat Ingest (Legacy - Free-form text → Pantry Proposal)

```bash
curl -X POST http://localhost:8000/v1/ingest/chat \
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
curl -X POST http://localhost:8000/v1/ingest/receipt \
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
curl -X POST http://localhost:8000/v1/ingest/product \
  -H "Content-Type: application/json" \
  -d '{
    "barcode": "0012000001086",
    "quantity": 6,
    "unit": "can"
  }'

# By description
curl -X POST http://localhost:8000/v1/ingest/product \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Organic Greek Yogurt, Vanilla, 32oz",
    "quantity": 1,
    "unit": "container"
  }'
```

### Recipe Ingest (URL/Text → Recipe Card Proposal)

```bash
# From text/transcript
curl -X POST http://localhost:8000/v1/recipes/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Classic Chocolate Chip Cookies\n\nIngredients:\n- 2 1/4 cups flour\n- 1 cup butter\n- 3/4 cup sugar\n- 2 eggs\n- 1 tsp vanilla\n- 2 cups chocolate chips\n\nInstructions:\n1. Cream butter and sugar\n2. Add eggs and vanilla\n3. Mix in flour\n4. Fold in chocolate chips\n5. Bake at 375°F for 9-11 minutes",
    "caption": "Grandmas cookie recipe"
  }'
```

### Apply Proposal (Human-reviewed → Database)

After the UI presents a proposal to the user and they approve it:

```bash
curl -X POST http://localhost:8000/v1/apply \
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

### List Pantry

```bash
# All items
curl http://localhost:8000/v1/pantry

# Filter by category
curl "http://localhost:8000/v1/pantry?category=dairy"

# Filter by storage
curl "http://localhost:8000/v1/pantry?storage=fridge"

# Search by name
curl "http://localhost:8000/v1/pantry?search=milk"
```

### Get Single Pantry Item

```bash
curl http://localhost:8000/v1/pantry/{item_id}
```

### Delete Pantry Item

```bash
curl -X DELETE http://localhost:8000/v1/pantry/{item_id}
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
│   ├── __init__.py
│   ├── app.py               # FastAPI application factory
│   └── routes/
│       ├── __init__.py
│       ├── health.py        # Health check endpoint
│       ├── ingest.py        # AI ingest endpoints
│       ├── pantry.py        # Pantry CRUD endpoints
│       └── apply.py         # Apply proposals endpoint
├── models/
│   ├── __init__.py
│   ├── base.py              # ProposalEnvelope, base types
│   ├── pantry.py            # PantryItem, PantryProposal
│   ├── recipe.py            # RecipeCard, RecipeCardProposal
│   └── requests.py          # Request/response models
├── tools/
│   ├── __init__.py
│   ├── llm_client.py        # Ollama client with circuit breaker
│   ├── normalizer.py        # Food name normalization
│   ├── expiry.py            # Expiry date heuristics
│   └── product_lookup.py    # OpenFoodFacts stub
├── repository/
│   ├── __init__.py
│   ├── base.py              # Repository interface
│   └── sqlite.py            # SQLite implementation
└── workflows/
    ├── __init__.py
    ├── state.py             # Shared workflow state
    ├── chat_ingest.py       # Chat → Pantry workflow
    ├── receipt_ingest.py    # Receipt → Pantry workflow
    ├── product_ingest.py    # Product → Pantry workflow
    └── recipe_ingest.py     # Recipe → RecipeCard workflow
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
2. POST /v1/ingest/chat
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
5. POST /v1/apply with approved proposal
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
- **API Integration**: RESTful endpoints at `/v1/profile/*`
- **UI Component**: Profile page accessible via bottom navigation

### Profile Endpoints

```bash
# Get profile by ID
GET /v1/profile/:id

# Get profile by email
GET /v1/profile/email/:email

# Create new profile
POST /v1/profile
{
  "username": "foodlover",
  "email": "food@example.com",
  "dietary_preferences": ["vegetarian"]
}

# Update profile
PUT /v1/profile/:id
{
  "dietary_preferences": ["vegan", "gluten-free"]
}

# Delete profile
DELETE /v1/profile/:id
```

See `CLAUDE.md` for full API documentation and integration details.

## Future Enhancements

- [ ] Real OCR integration (Tesseract/cloud OCR)
- [ ] Real OpenFoodFacts API integration
- [ ] Recipe URL scraping with structured data extraction
- [ ] Pantry expiry notifications
- [ ] Shopping list generation from recipes
- [ ] Meal planning suggestions
- [ ] Voice interface integration

## License

MIT
