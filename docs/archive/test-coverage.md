# Test Coverage & Implementation Guide

## Overview

This document describes the comprehensive test suite for the chat_ingest workflow, covering all 9 core user flows. The tests validate the `/v1/chat` endpoint and ChatRouterGraph functionality.

## Test Files

### `test_user_flows.py`
Comprehensive end-to-end tests for all 9 user flows:
1. ✅ Simple pantry add (high confidence)
2. ✅ Pantry consume (partial)
3. ✅ Ambiguous item → clarification interrupt
4. ✅ Non-pantry general chat
5. ✅ Receipt ingest request (handoff)
6. ✅ Product scan request (handoff)
7. ✅ Recipe link ingest request (handoff)
8. ✅ Mixed message (pantry + other chat)
9. ✅ Undo / correction conversational fix

Additional test categories:
- ✅ Error handling (empty input, LLM failure)
- ✅ Stable key generation (no random UUIDs)
- ✅ Routing correctness

### `test_helpers.py`
Test utilities and helpers:
- State builders (`build_base_workflow_state`, `build_pantry_update_state`)
- Mock LLM result factories
- Item and proposal factories
- Assertion helpers
- Test data sets
- Mock configuration helpers

### Existing Files
- `test_chat_workflow.py` - Original workflow tests (kept for compatibility)
- `test_chat_router.py` - Detailed routing and node tests

## Running the Tests

```bash
# Activate virtual environment
source .venv/bin/activate

# Run all chat tests
pytest tests/test_user_flows.py -v

# Run specific flow test
pytest tests/test_user_flows.py::TestFlow1_SimplePantryAdd -v

# Run with coverage
pytest tests/test_user_flows.py --cov=bubbly_chef.workflows.chat_ingest --cov-report=html

# Run all tests
pytest tests/ -v
```

## Test Structure

Each flow test follows this pattern:

```python
@pytest.mark.asyncio
async def test_flow_name(self, mock_llm_client):
    """Test description."""
    
    # 1. Setup mock LLM responses
    intent_result = create_mock_intent_result(...)
    parse_result = create_mock_parse_result(...)
    mock_llm_client.generate_structured.side_effect = [...]
    
    # 2. Execute workflow
    with patch("...get_ollama_client", return_value=mock_llm_client):
        envelope = await run_chat_workflow(USER_INPUT)
    
    # 3. Assert envelope structure
    assert_envelope_structure(envelope)
    
    # 4. Assert intent
    assert envelope.intent == Intent.PANTRY_UPDATE
    
    # 5. Assert proposal structure
    assert isinstance(envelope.proposal, PantryProposal)
    
    # 6. Assert specific behavior
    # - Item names, quantities, categories
    # - Confidence scores
    # - Review requirements
    # - Next actions
    # - Stable keys
```

## Key Assertions

### Envelope Structure
Every test validates the ProposalEnvelope contract:
- `request_id`, `workflow_id` (UUIDs)
- `schema_version` = "1.0.0"
- `intent` (Intent enum)
- `confidence.overall` (0.0-1.0)
- `requires_review` (bool)
- `next_action` (NextAction enum)
- `assistant_message` (string)
- `warnings`, `errors` (lists)

### Pantry Proposals
For pantry update flows:
- Proposal type is `PantryProposal`
- Actions list is non-empty
- Each action has valid `PantryItem`
- Item names are normalized
- Categories are not "other" (when possible)
- Expiry dates are present
- `client_item_key` is deterministic (no UUIDs)
- Quantities and units are valid

### Handoff Proposals
For receipt/product/recipe flows:
- Proposal type is `HandoffProposal`
- `kind` matches intent (RECEIPT, PRODUCT, RECIPE)
- `instructions` are present
- `required_inputs` are specified
- `next_action` matches handoff type

### Stable Keys
Critical for deduplication:
- `client_item_key` is deterministic
- Same input → same key (run twice, compare)
- No UUID patterns (8-4-4-4-12 format)
- Semantic keys like "dairy:milk" or "milk"

## Mock Strategy

### LLM Mocking
- Mock `get_ollama_client()` at workflow level
- Return deterministic `LLMIntentResult` and `LLMParseResult`
- Use `side_effect` for sequential calls
- Never call real Ollama in tests

### Mock Patterns

```python
# Intent classification
intent_result = LLMIntentResult(
    intent="pantry_update",
    confidence=0.90,
    reasoning="User mentions buying items",
    entities=["milk", "eggs"],
)

# Item parsing
parse_result = LLMParseResult(
    items=[
        LLMParsedItem(
            name="milk",
            quantity=1,
            unit="gallon",
            category="dairy",
            action="add",
            confidence=0.90,
        ),
    ],
    confidence=0.90,
)

# Configure mock
mock_llm_client.generate_structured.side_effect = [
    (intent_result, None),  # First call: intent
    (parse_result, None),   # Second call: parse
]
```

## Test Coverage Matrix

| Flow | Intent | Proposal Type | Next Action | Review Required | Key Validations |
|------|--------|---------------|-------------|-----------------|-----------------|
| 1. Simple Pantry Add | PANTRY_UPDATE | PantryProposal | REVIEW_PROPOSAL | True (≥0.90 conf) | 2 items, expiry, stable keys |
| 2. Consume Partial | PANTRY_UPDATE | PantryProposal | REQUEST_CLARIFICATION | True (ambiguous) | USE action, low confidence |
| 3. Ambiguous Item | PANTRY_UPDATE | PantryProposal | REQUEST_CLARIFICATION | True | Clarifying questions present |
| 4. General Chat | GENERAL_CHAT | None | NONE | False | No proposal, message present |
| 5. Receipt Ingest | RECEIPT_INGEST | HandoffProposal | REQUEST_RECEIPT_IMAGE | - | Kind=RECEIPT, required inputs |
| 6. Product Scan | PRODUCT_INGEST | HandoffProposal | REQUEST_PRODUCT_BARCODE | - | Kind=PRODUCT |
| 7. Recipe Ingest | RECIPE_INGEST | HandoffProposal | REQUEST_RECIPE_TEXT | - | Kind=RECIPE |
| 8. Mixed Message | PANTRY_UPDATE | PantryProposal | REVIEW_PROPOSAL | True | Priority to pantry |
| 9. Correction | PANTRY_UPDATE | PantryProposal | REVIEW_PROPOSAL | True | Correction handling |

## Missing Utilities & Implementation Gaps

### Test Infrastructure (Completed ✅)
- ✅ Mock LLM fixtures
- ✅ State builders
- ✅ Assertion helpers
- ✅ Test data factories

### Workflow Implementation (Check These)

#### 1. Stable Key Generation
**Location:** `chat_ingest.py` → `create_actions()` node

**Required:** Generate deterministic `client_item_key` for each item.

```python
def generate_client_item_key(item: dict) -> str:
    """Generate stable, deterministic key for item."""
    category = item.get('category', '').lower()
    name = item.get('name', '').lower().strip()
    
    # Option 1: Simple
    return f"{category}:{name}"
    
    # Option 2: With unit for differentiation
    unit = item.get('unit', '').lower()
    return f"{category}:{name}:{unit}"
```

**Test:** `test_stable_keys_no_random_uuids()`

#### 2. Clarification Logic
**Location:** `chat_ingest.py` → `review_gate()` node

**Required:** Generate clarifying questions for low-confidence items.

```python
def generate_clarifying_questions(items: list[dict]) -> list[str]:
    """Generate questions for ambiguous items."""
    questions = []
    
    for item in items:
        if item.get('confidence', 1.0) < 0.7:
            name = item['name']
            
            # Check what's ambiguous
            if item.get('quantity') == 1 and item.get('unit') == 'item':
                questions.append(f"How much {name} did you get? (e.g., size, weight)")
            
            if item.get('category') == 'other':
                questions.append(f"What type of food is {name}?")
    
    return questions
```

**Test:** `test_ambiguous_item_needs_clarification()`

#### 3. General Chat Response
**Location:** `chat_ingest.py` → `general_chat_response()` node

**Status:** Likely needs LLM integration for conversational responses.

```python
async def general_chat_response(state: WorkflowState) -> WorkflowState:
    """Generate conversational response for general chat."""
    llm = get_ollama_client()
    
    prompt = f"User asks: {state['input_text']}\n\nRespond helpfully about pantry/cooking."
    
    result, error = await llm.generate_structured(
        prompt=prompt,
        response_model=LLMGeneralChatResult,
        system_prompt="You are a helpful pantry management assistant...",
    )
    
    return {
        **state,
        "assistant_message": result.response if result else "I'm here to help!",
    }
```

**Test:** `test_general_chat_intent()`

#### 4. Mixed Message Handling
**Location:** `chat_ingest.py` → `classify_intent()` node

**Policy:** Prioritize pantry_update when both pantry and chat intents detected.

**Current:** Likely handled by LLM or rule priority. Verify intent classification handles this.

**Test:** `test_mixed_message_prioritizes_pantry()`

#### 5. Correction Handling (Optional v0)
**Location:** New conversation context tracking

**Status:** Optional for v0. Can treat as new input for now.

**Future:** Track conversation history, detect "actually", "no", "change that" patterns.

**Test:** `test_correction_handling()` - currently just validates as new pantry update

### API Integration

#### Router Endpoint
**Location:** `bubbly_chef/api/routes/chat.py`

**Required:** POST `/v1/chat` endpoint that calls `run_chat_workflow()`.

```python
from fastapi import APIRouter, HTTPException
from bubbly_chef.workflows.chat_ingest import run_chat_workflow
from bubbly_chef.models.requests import ChatRequest

router = APIRouter()

@router.post("/v1/chat")
async def chat(request: ChatRequest):
    """Process chat message and return proposal envelope."""
    try:
        envelope = await run_chat_workflow(
            input_text=request.message,
            conversation_id=request.conversation_id,
            pantry_snapshot=request.pantry_snapshot,
        )
        return envelope
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### Request/Response Models

#### ChatRequest
**Location:** `bubbly_chef/models/requests.py`

```python
class ChatRequest(BaseModel):
    """Request model for /v1/chat endpoint."""
    
    message: str = Field(description="User's chat message")
    conversation_id: UUID | None = Field(
        default=None,
        description="Optional conversation thread ID for context",
    )
    pantry_snapshot: list[PantryItem] | None = Field(
        default=None,
        description="Current pantry state for consumption calculations",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata (e.g., user_id, device_type)",
    )
```

## Running Tests Against Real API

```bash
# Start the API server
uvicorn bubbly_chef.api.app:app --reload

# Run integration tests (if created)
pytest tests/test_api_integration.py -v

# Or use curl
curl -X POST http://localhost:9000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I bought milk and eggs"}'
```

## Validation Checklist

Before deploying:

- [ ] All 9 user flow tests pass
- [ ] Error handling tests pass
- [ ] Stable key generation verified
- [ ] Mock LLM never calls real Ollama
- [ ] Envelope contract validated
- [ ] Normalization applied
- [ ] Expiry heuristics applied
- [ ] Categories assigned (not "other")
- [ ] Confidence scores reasonable
- [ ] Review thresholds work
- [ ] Clarifying questions generated
- [ ] Handoff proposals correct
- [ ] General chat responds
- [ ] Mixed messages handled
- [ ] `/v1/chat` endpoint implemented
- [ ] API returns correct HTTP codes
- [ ] Error responses structured

## Performance Considerations

### Test Performance
- Mock LLM calls to avoid network latency
- Use deterministic fixtures
- Parallelize independent tests
- Target: < 5 seconds for full test suite

### Production Performance
- LLM calls are the bottleneck
- Consider caching frequent patterns
- Batch similar requests if possible
- Monitor latency and set timeouts

## Future Enhancements

### Test Coverage Expansion
1. **Conversation context tests**
   - Multi-turn conversations
   - Context persistence
   - Correction handling with history

2. **Pantry snapshot tests**
   - Consumption with current quantities
   - Smart deduplication
   - Quantity updates vs new items

3. **Edge cases**
   - Very long inputs
   - Special characters
   - Multiple languages
   - Voice input artifacts

4. **Integration tests**
   - Full API roundtrip
   - Database persistence
   - Multi-workflow handoffs

### Workflow Improvements
1. **Confidence tuning**
   - Adjust review thresholds
   - Per-field confidence tracking
   - User feedback loop

2. **Smart routing**
   - Learn from user corrections
   - Context-aware intent classification
   - Hybrid rule + ML routing

3. **Better clarifications**
   - Structured options (not just free text)
   - Visual pickers for common items
   - Smart defaults based on history

## Troubleshooting

### Test Failures

**"Module not found: langgraph"**
```bash
source .venv/bin/activate
pip install langgraph langchain langchain-community
```

**"Could not connect to Ollama"**
- Tests should NOT connect to Ollama
- Check that mocks are properly configured
- Ensure `@patch` decorator is applied

**"Assertion failed: envelope.proposal is None"**
- Check intent classification mock
- Verify routing logic
- Ensure parse result is returned for pantry_update

**"Keys contain UUID patterns"**
- Implement stable key generation
- Do not use `uuid4()` for client_item_key
- Use semantic keys based on name+category

### Common Issues

1. **Async test not running**
   - Add `@pytest.mark.asyncio` decorator
   - Ensure pytest-asyncio is installed

2. **Mock not being called**
   - Check patch path is correct
   - Verify `generate_structured` is the right method
   - Use `side_effect` for multiple calls

3. **Envelope missing fields**
   - Check workflow returns all required fields
   - Verify envelope builder functions
   - Validate against schema

## Resources

- [Architecture Doc](../ARCH.MD)
- [Workflow Docs](../docs/workflows/chat_ingest_flow.md)
- [API Routes](../bubbly_chef/api/routes/)
- [Models](../bubbly_chef/models/)

## Summary

✅ **Completed:**
- Comprehensive test suite for 9 user flows
- Test helpers and utilities
- Mock LLM fixtures
- Assertion helpers
- Documentation

🔧 **Action Items:**
1. Verify stable key generation in workflow
2. Implement clarifying question logic
3. Ensure general chat response works
4. Create `/v1/chat` API endpoint
5. Add ChatRequest model
6. Run tests and fix failures
7. Add integration tests (optional)

📊 **Test Command:**
```bash
source .venv/bin/activate
pytest tests/test_user_flows.py -v --cov=bubbly_chef.workflows.chat_ingest
```
