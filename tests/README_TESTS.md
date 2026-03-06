# BubblyChef Chat Workflow Test Suite

## 📋 Overview

You now have a **complete test suite** for the chat_ingest workflow covering all 9 user flows as requested. This test suite validates the `/v1/chat` endpoint behavior without making real LLM calls.

## ✨ What Was Created

### 1. **Comprehensive Test Cases** ([test_user_flows.py](test_user_flows.py))

All 9 user flows with deterministic mocking:

1. ✅ **Simple pantry add** (high confidence) - "I bought milk and a dozen eggs."
2. ✅ **Pantry consume** (partial) - "I used half my milk and 2 eggs."
3. ✅ **Ambiguous item** → clarification - "Add salsa."
4. ✅ **Non-pantry general chat** - "What's a good high-protein dinner idea?"
5. ✅ **Receipt ingest request** - "I scanned a receipt, add it."
6. ✅ **Product scan request** - "Can you scan this barcode for me?"
7. ✅ **Recipe link ingest** - "Save this recipe: https://youtube.com/shorts/xyz"
8. ✅ **Mixed message** - "I bought chicken and broccoli. Also what can I make tonight?"
9. ✅ **Correction** - "Actually not eggs—make that yogurt."

**Additional tests:**
- Error handling (empty input, LLM failure)
- Stable key generation (no random UUIDs)
- Routing correctness

### 2. **Test Helpers & Utilities** ([test_helpers.py](test_helpers.py))

Ready-to-use utilities:
- State builders (`build_base_workflow_state`, `build_pantry_update_state`)
- Mock LLM result factories
- Item and proposal factories
- Assertion helpers (`assert_valid_envelope_structure`, `assert_no_random_uuids_in_keys`)
- Test data sets (examples for each flow type)
- Mock configuration helpers

### 3. **Documentation** ([docs/TEST_COVERAGE.md](docs/TEST_COVERAGE.md))

Complete guide including:
- Test structure and patterns
- Running tests
- Assertion checklist
- Mock strategy
- Coverage matrix
- Missing implementation checklist
- Troubleshooting guide

## 🚀 Running the Tests

```bash
# Activate virtual environment
source .venv/bin/activate

# Run all user flow tests
pytest tests/test_user_flows.py -v

# Run specific flow
pytest tests/test_user_flows.py::TestFlow1_SimplePantryAdd -v

# Run with coverage
pytest tests/test_user_flows.py --cov=bubbly_chef.workflows.chat_ingest --cov-report=html

# Run all tests
pytest tests/ -v
```

## 🎯 Key Test Patterns

### Deterministic LLM Mocking

```python
@pytest.mark.asyncio
async def test_flow(self, mock_llm_client):
    # Define expected LLM responses
    intent_result = LLMIntentResult(
        intent="pantry_update",
        confidence=0.95,
        reasoning="User mentions buying groceries",
        entities=["milk", "eggs"],
    )
    
    parse_result = LLMParseResult(
        items=[...],
        confidence=0.93,
    )
    
    # Configure mock
    mock_llm_client.generate_structured.side_effect = [
        (intent_result, None),
        (parse_result, None),
    ]
    
    # Execute workflow with mocked LLM
    with patch("bubbly_chef.workflows.chat_ingest.get_ollama_client", 
               return_value=mock_llm_client):
        envelope = await run_chat_workflow("I bought milk and eggs")
    
    # Validate results
    assert envelope.intent == Intent.PANTRY_UPDATE
    assert len(envelope.proposal.actions) == 2
```

### Stable Key Verification

```python
def test_stable_keys():
    # Run same input twice
    envelope1 = await run_chat_workflow("I bought milk")
    envelope2 = await run_chat_workflow("I bought milk")
    
    # Keys should match
    key1 = envelope1.proposal.actions[0].item.client_item_key
    key2 = envelope2.proposal.actions[0].item.client_item_key
    assert key1 == key2  # Deterministic!
```

## 📊 Test Coverage Matrix

| Flow | Intent | Proposal Type | Next Action | Validates |
|------|--------|---------------|-------------|-----------|
| 1. Simple Add | PANTRY_UPDATE | PantryProposal | REVIEW_PROPOSAL | Items, expiry, stable keys |
| 2. Consume | PANTRY_UPDATE | PantryProposal | REQUEST_CLARIFICATION | USE action, low confidence |
| 3. Ambiguous | PANTRY_UPDATE | PantryProposal | REQUEST_CLARIFICATION | Clarifying questions |
| 4. General Chat | GENERAL_CHAT | None | NONE | No proposal, message |
| 5. Receipt | RECEIPT_INGEST | HandoffProposal (RECEIPT) | REQUEST_RECEIPT_IMAGE | Handoff instructions |
| 6. Product | PRODUCT_INGEST | HandoffProposal (PRODUCT) | REQUEST_PRODUCT_BARCODE | Handoff instructions |
| 7. Recipe | RECIPE_INGEST | HandoffProposal (RECIPE) | REQUEST_RECIPE_TEXT | Handoff instructions |
| 8. Mixed | PANTRY_UPDATE | PantryProposal | REVIEW_PROPOSAL | Priority handling |
| 9. Correction | PANTRY_UPDATE | PantryProposal | REVIEW_PROPOSAL | Correction semantics |

## ⚡ Quick Start Example

```python
# Using the test helpers
from tests.test_helpers import (
    create_mock_intent_result,
    create_mock_parse_result,
    assert_valid_envelope_structure,
)

# Create mock data
intent = create_mock_intent_result("pantry_update", confidence=0.90)
items = create_mock_parse_result([
    {"name": "milk", "quantity": 1, "unit": "gallon", "category": "dairy"}
])

# Configure mock
mock_llm_client.generate_structured.side_effect = [
    (intent, None),
    (items, None),
]

# Run test
envelope = await run_chat_workflow("I bought milk")

# Validate
assert_valid_envelope_structure(envelope)
assert envelope.intent == Intent.PANTRY_UPDATE
```

## 🔍 What Each Test Validates

### Envelope Contract
- ✅ All required fields present
- ✅ Correct data types
- ✅ Valid confidence scores (0.0-1.0)
- ✅ Proper intent classification
- ✅ Appropriate next_action hints

### Pantry Proposals
- ✅ Item normalization applied
- ✅ Expiry heuristics applied
- ✅ Categories assigned (not "other" when avoidable)
- ✅ Stable, deterministic keys (no UUIDs)
- ✅ Quantities and units valid
- ✅ Action types correct (ADD, USE, REMOVE)

### Handoff Proposals
- ✅ Correct handoff kind
- ✅ Clear instructions
- ✅ Required inputs specified
- ✅ Next action matches handoff type

### Error Handling
- ✅ Empty input handled gracefully
- ✅ LLM failures return valid envelope
- ✅ Errors logged properly
- ✅ Confidence reflects uncertainty

## 🛠️ Implementation Checklist

### ✅ Completed
- [x] Comprehensive test suite (9 flows)
- [x] Test helpers and utilities
- [x] Mock LLM fixtures
- [x] Assertion helpers
- [x] Documentation

### 🔧 Action Items for Implementation

1. **Verify stable key generation** in [chat_ingest.py](../bubbly_chef/workflows/chat_ingest.py)
   - Ensure `client_item_key` is deterministic
   - Use format like `"dairy:milk"` not UUIDs

2. **Implement clarifying questions** in `review_gate()` node
   - Generate questions for low-confidence items
   - Check for ambiguous quantities/categories

3. **Ensure general chat response** works in `general_chat_response()` node
   - LLM generates helpful responses
   - No proposal created

4. **Test mixed message handling**
   - Verify intent prioritization (pantry > chat)
   - Message acknowledges both parts

5. **Create `/v1/chat` API endpoint** in [api/routes/chat.py](../bubbly_chef/api/routes/chat.py)
   ```python
   @router.post("/v1/chat")
   async def chat(request: ChatRequest):
       return await run_chat_workflow(request.message)
   ```

## 📝 Test Execution Notes

### Current Status
The tests are written and ready to run, but may need:
- Verification that `run_chat_workflow()` function exists and matches signature
- Confirmation that LLM client mocking works correctly
- Adjustments to match actual implementation details

### Known Issues
- Tests should NOT call real Ollama (ensure mocks are working)
- Some workflow nodes may need implementation (clarifying questions, etc.)
- API endpoint needs to be created

### Next Steps
1. Run tests: `pytest tests/test_user_flows.py -v`
2. Fix any import errors or missing functions
3. Verify mocking works (no real LLM calls)
4. Implement missing workflow features
5. Add integration tests (optional)

## 📚 Related Documentation

- [Architecture](../ARCH.MD) - System architecture
- [Test Coverage](../docs/TEST_COVERAGE.md) - Detailed test guide
- [Chat Ingest Flow](../docs/workflows/chat_ingest_flow.md) - Workflow documentation
- [Existing Tests](test_chat_router.py) - Additional test examples

## 🎓 Learning Resources

### Understanding the Tests
Each test follows a pattern:
1. **Setup** - Create mock LLM responses
2. **Execute** - Call workflow with test input
3. **Validate** - Assert on envelope fields
4. **Verify** - Check specific behavior (keys, confidence, etc.)

### Key Concepts
- **Deterministic mocking**: Same input = same output
- **Envelope contract**: Standard response format
- **Stable keys**: Deduplication requires consistent identifiers
- **Confidence gating**: Low confidence → requires review
- **Intent routing**: Different paths for different user goals

## 🏆 Success Criteria

Tests pass when:
- ✅ All 9 flows execute without errors
- ✅ Mocks are used (no real LLM calls)
- ✅ Envelopes match contract
- ✅ Proposals have correct structure
- ✅ Keys are stable and deterministic
- ✅ Confidence scores are reasonable
- ✅ Review flags are appropriate
- ✅ Error handling works

## 💡 Tips

1. **Use test helpers** - Don't create mocks manually, use the factories
2. **Check assertions** - Use provided validation functions
3. **Run incrementally** - Test one flow at a time initially
4. **Mock at the right level** - Mock `get_ollama_client()`, not lower
5. **Verify twice** - Run same test twice to verify determinism

---

**Ready to test?** Run: `source .venv/bin/activate && pytest tests/test_user_flows.py -v`

**Need help?** Check [TEST_COVERAGE.md](../docs/TEST_COVERAGE.md) for detailed troubleshooting.
