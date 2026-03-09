# Architecture Analysis: LangChain vs Prompt-Based

## Current State (March 2026)

### ✅ ACTIVE: Prompt-Based (Simple AI)

**What's Actually Running:**
- Recipe generation (`bubbly_chef/services/recipe_generator.py`)
- Receipt parsing (`bubbly_chef/services/receipt_parser.py`)
- Pantry CRUD (`bubbly_chef/api/routes/pantry.py`)
- Receipt scanning (`bubbly_chef/api/routes/scan.py`)

**How it works:**
```python
# Direct AI provider calls with structured output
result = await ai_manager.complete(
    prompt=RECIPE_GENERATION_PROMPT.format(...),
    response_schema=AIRecipeOutput,
    temperature=0.8
)

# Simple, direct, no framework
```

**Architecture:**
```
User Request → API Route → Service (prompt + AI) → Pydantic Model → Response
```

**Pros:**
- ✅ Simple and direct
- ✅ Easy to debug
- ✅ Fast (no framework overhead)
- ✅ Full control over prompts
- ✅ No complex dependencies

**Cons:**
- ⚠️ No conversation memory
- ⚠️ No multi-step reasoning
- ⚠️ Each request is independent

---

### 🚧 INACTIVE: LangGraph Workflows (Complex AI)

**What Exists But Isn't Used:**
- `bubbly_chef/workflows/chat_ingest.py` - Chat router with intent classification
- `bubbly_chef/workflows/receipt_ingest.py` - Multi-step receipt workflow
- `bubbly_chef/workflows/product_ingest.py` - Product parsing workflow
- `bubbly_chef/workflows/recipe_ingest.py` - Recipe extraction workflow
- `bubbly_chef/api/routes/chat.py` - Chat endpoint (commented out)
- `bubbly_chef/api/routes/ingest.py` - Ingest endpoints (not registered)

**Architecture (If Enabled):**
```
User Message
    ↓
Chat Router Graph (LangGraph)
    ↓
Intent Classification (AI)
    ↓
    ├─→ pantry_update → Parse → Normalize → Proposal
    ├─→ receipt_request → Handoff to receipt workflow
    ├─→ recipe_request → Handoff to recipe workflow
    └─→ general_chat → Conversational response
```

**Features (If Enabled):**
- State management across steps
- Intent routing ("I bought milk" → pantry update)
- Proposal system (human-in-the-loop)
- Multi-step reasoning
- Conversation memory

**Why It's Not Active:**
1. Phase 1C (recipes) doesn't need it
2. Chat interface is Phase 2
3. Simpler approach working well
4. LangChain not in `pyproject.toml` (but installed globally)

---

## Detailed Comparison

### Current Recipe Generation (Prompt-Based)

**File:** `bubbly_chef/services/recipe_generator.py`

```python
# Single AI call with retry logic
for attempt in range(MAX_RETRIES + 1):
    try:
        result = await ai_manager.complete(
            prompt=full_prompt,
            response_schema=AIRecipeOutput,
            temperature=0.8,
        )
        break
    except StructuredOutputError:
        # Retry with exponential backoff
        await asyncio.sleep(2 ** attempt)
```

**Characteristics:**
- One prompt in, one result out
- Retry logic for reliability
- No state management needed
- Perfect for simple tasks

### LangGraph Chat Workflow (Complex)

**File:** `bubbly_chef/workflows/chat_ingest.py`

```python
# Multi-node graph with state
graph = StateGraph(WorkflowState)
graph.add_node("classify", classify_intent)
graph.add_node("parse_pantry", parse_pantry_update)
graph.add_node("normalize", normalize_and_enrich)
graph.add_node("generate_handoff", generate_handoff)
graph.add_node("general_chat", handle_general_chat)

# Conditional routing based on intent
graph.add_conditional_edges(
    "classify",
    lambda state: state.intent,
    {
        Intent.PANTRY_UPDATE: "parse_pantry",
        Intent.RECEIPT_REQUEST: "generate_handoff",
        Intent.GENERAL_CHAT: "general_chat",
    }
)
```

**Characteristics:**
- Multiple AI calls with state passing
- Conditional routing
- Human-in-the-loop proposals
- Better for conversational UIs

---

## When to Use Each Approach

### Use Prompt-Based (Current) For:

✅ **Single-turn interactions**
- "Generate a recipe" → response
- "Parse this receipt" → items

✅ **Deterministic flows**
- Fixed input/output
- No branching logic needed

✅ **Simple tasks**
- One prompt can handle it
- No multi-step reasoning

✅ **Speed-critical operations**
- No framework overhead
- Direct AI calls

**Examples:**
- Recipe generation ✅ (current)
- Receipt parsing ✅ (current)
- Ingredient matching ✅ (current)

### Use LangGraph For:

✅ **Multi-turn conversations**
- "What can I make?" → "Something spicy" → "With chicken"
- Context across messages

✅ **Intent routing**
- "I bought milk" → pantry update
- "Show me recipes" → recipe search
- "What's expiring?" → pantry query

✅ **Complex workflows**
- Parse → Validate → Enrich → Propose
- Multiple decision points

✅ **Human-in-the-loop**
- Low confidence → ask user
- Proposals before DB mutations

**Examples:**
- Chat interface (Phase 2)
- Natural language commands
- "I cooked the pasta recipe" → deduct ingredients

---

## Future Phases & Architecture

### Phase 1C (Current) - Prompt-Based ✅
- Recipe generation: Direct AI call
- No conversation needed
- Working well

### Phase 2 (Chat Interface) - Should Use LangGraph
```
User: "I bought milk and eggs"
    ↓
Chat Router (LangGraph)
    ↓
Intent: PANTRY_UPDATE
    ↓
Parse items → Normalize → Show proposals → User confirms → Add to DB
```

**Why LangGraph:**
- Intent classification needed
- Multi-turn conversation
- "milk" → "how much?" → "1 gallon" → add
- State management

### Phase 3 (Video Recipes) - Hybrid
```
Video URL
    ↓
Extract transcript (simple)
    ↓
Parse recipe (LangGraph workflow)
    ├─→ Extract ingredients
    ├─→ Extract steps
    ├─→ Match to pantry
    └─→ Generate proposal
```

**Why hybrid:**
- Initial parsing: simple prompt
- Recipe extraction: complex workflow
- Validation steps needed

---

## Dependency Status

### Currently Installed (Not in pyproject.toml)
```bash
# LangChain is installed globally but not declared
python -c "import langchain; print('installed')"
# → installed

# But not in pyproject.toml dependencies
grep langchain pyproject.toml
# → (no results)
```

### If Phase 2 Needs LangGraph

**Add to pyproject.toml:**
```toml
dependencies = [
    # ... existing deps
    "langchain>=0.1.0",
    "langgraph>=0.0.20",
    "langchain-core>=0.1.0",
]
```

**Or keep it out:**
- LangGraph is optional
- Only needed for Phase 2 chat
- Current architecture doesn't need it

---

## Recommendations

### For Current Phase (1C) ✅
**Keep prompt-based architecture:**
- Simple and working
- No framework overhead
- Easy to debug and modify
- Recipe generation is one-shot task

### For Phase 2 (Chat)
**Migrate to LangGraph:**
```python
# Enable chat router
from bubbly_chef.workflows import run_chat_workflow

@router.post("/chat")
async def chat(message: str):
    result = await run_chat_workflow(message)
    return result
```

**Benefits:**
- Intent classification
- Multi-turn conversations
- State management
- Proposal system already built

### Hybrid Approach (Recommended)
```
├─ Simple tasks (recipes, receipts)
│  └─ Prompt-based (current)
│
└─ Complex tasks (chat, multi-step)
   └─ LangGraph workflows
```

**Why hybrid:**
- Best of both worlds
- Don't overcomplicate simple tasks
- Use frameworks where they add value

---

## Code Organization

### Current (Phase 1C)
```
bubbly_chef/
├── services/
│   ├── recipe_generator.py  ← Prompt-based ✅
│   └── receipt_parser.py    ← Prompt-based ✅
├── api/routes/
│   ├── recipes.py           ← Active ✅
│   ├── scan.py              ← Active ✅
│   └── pantry.py            ← Active ✅
└── workflows/               ← Exists but not active 🚧
    ├── chat_ingest.py
    ├── receipt_ingest.py
    └── recipe_ingest.py
```

### Future (Phase 2+)
```
bubbly_chef/
├── services/
│   ├── recipe_generator.py  ← Still prompt-based ✅
│   └── receipt_parser.py    ← Still prompt-based ✅
├── workflows/
│   ├── chat_router.py       ← Enable for Phase 2 ✅
│   └── ...                  ← Use as needed
└── api/routes/
    ├── chat.py              ← Uncomment & use workflows ✅
    └── ...
```

---

## Performance Comparison

### Prompt-Based (Current)
- **Latency:** 15-25 seconds (1 AI call)
- **Overhead:** ~0ms (direct call)
- **Memory:** Low
- **Complexity:** Simple

### LangGraph Workflow
- **Latency:** 20-40 seconds (multiple AI calls)
- **Overhead:** ~50-100ms (state management)
- **Memory:** Medium (state objects)
- **Complexity:** Higher

**When it matters:**
- Simple recipe: prompt-based wins
- Complex chat: LangGraph wins

---

## Bottom Line

### Current Status:
**✅ Prompt-based, working great, no need to change**

**Why:**
- Recipe generation is single-shot
- No conversation needed
- Simple = fast and reliable

### When to Switch:
**Phase 2 (Chat) - Enable LangGraph workflows**

**Why:**
- Intent routing needed
- Multi-turn conversations
- "I bought milk" → parse → propose → confirm
- State management required

### Recommendation:
**Keep both, use appropriately:**
- **Simple tasks:** Direct prompts (current approach)
- **Complex tasks:** LangGraph workflows (when needed)
- **Don't overcomplicate** what's working

---

## Files to Review

**Active (Prompt-Based):**
- `bubbly_chef/services/recipe_generator.py`
- `bubbly_chef/services/receipt_parser.py`
- `bubbly_chef/ai/manager.py`

**Inactive (LangGraph):**
- `bubbly_chef/workflows/chat_ingest.py`
- `bubbly_chef/workflows/*_ingest.py`
- `bubbly_chef/api/routes/chat.py` (commented out)

**To Enable LangGraph (Phase 2):**
1. Add to `pyproject.toml`
2. Uncomment `chat.router` in `app.py`
3. Test chat workflows
4. Deploy with conversation state
