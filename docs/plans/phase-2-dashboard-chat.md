# Phase 2: Dashboard & Chat Orchestrator

## Goal
Create a home dashboard that surfaces key information and build the chat interface that orchestrates all features.

**Exit Criteria:** Dashboard shows expiring items and quick actions. Chat can route to pantry/scan/recipe flows naturally.

---

## Dependencies
- Phase 1A complete (Pantry)
- Phase 1B complete (Receipt Scan)
- Phase 1C complete (Recipe Generation)

---

## Part A: Dashboard

### 2A.1 Dashboard Layout

- [ ] Three-card layout:
  1. **Expiring Soon** - items expiring in next 3 days
  2. **Quick Actions** - common tasks
  3. **Recent Activity** - last few additions/recipes

### 2A.2 Expiring Soon Widget

- [ ] Fetch from `/api/pantry/expiring?days=3`
- [ ] Show item name, days remaining
- [ ] Color coding: red (expired), orange (1-2 days), yellow (3 days)
- [ ] "Use it" suggestions (link to recipe with ingredient)
- [ ] Tap item → go to pantry detail

### 2A.3 Quick Actions Widget

- [ ] Buttons for:
  - "Scan Receipt" → Scan page
  - "Add Item" → Pantry add modal
  - "What's for dinner?" → Recipe page with random prompt
- [ ] Large, tappable buttons

### 2A.4 Recent Activity Widget

- [ ] Show last 5 events:
  - Items added (manually or via scan)
  - Recipes generated
- [ ] Timestamp for each
- [ ] Tap to see details

---

## Part B: Chat Orchestrator

### 2B.1 Intent Router

- [ ] Classify user input into intents:
  ```python
  class Intent(Enum):
      RECIPE_REQUEST = "recipe_request"      # "What can I make?"
      PANTRY_ADD = "pantry_add"              # "Add milk to pantry"
      PANTRY_QUERY = "pantry_query"          # "Do I have eggs?"
      RECEIPT_SCAN = "receipt_scan"          # "I want to scan a receipt"
      GENERAL_CHAT = "general_chat"          # Cooking questions
  ```
- [ ] Use AI to classify (or simple keyword matching first)
- [ ] Route to appropriate handler

### 2B.2 Chat API

- [ ] `POST /api/chat` - send message
  ```python
  class ChatRequest(BaseModel):
      message: str
      conversation_id: str | None  # For context

  class ChatResponse(BaseModel):
      intent: Intent
      response: str
      data: dict | None            # Recipe, pantry items, etc.
      action_required: str | None  # "upload_receipt", "confirm_add"
  ```

### 2B.3 Intent Handlers

- [ ] **RECIPE_REQUEST**: Call recipe generation, return recipe
- [ ] **PANTRY_ADD**: Parse items, add to pantry, confirm
- [ ] **PANTRY_QUERY**: Search pantry, return results
- [ ] **RECEIPT_SCAN**: Return prompt to upload image
- [ ] **GENERAL_CHAT**: Answer cooking questions

### 2B.4 Chat UI

- [ ] Chat interface with message bubbles
- [ ] User messages (right) vs. assistant (left)
- [ ] Input box with send button
- [ ] Loading indicator while processing
- [ ] Rich responses:
  - Recipe cards (embedded)
  - Pantry item lists
  - Action buttons ("Add these items?")

### 2B.5 Conversation Context

- [ ] Store conversation history in session
- [ ] Include recent context in AI prompt
- [ ] Handle follow-ups: "make it spicier"
- [ ] Clear conversation button

### 2B.6 Action Buttons in Chat

- [ ] For pantry add: "Add these items?" → Yes/No buttons
- [ ] For recipe: "Save recipe?" (Phase 3)
- [ ] For scan: "Upload receipt" button that opens file picker

---

## API Contracts

### ChatRequest
```typescript
interface ChatRequest {
  message: string;
  conversation_id?: string;
}
```

### ChatResponse
```typescript
interface ChatResponse {
  conversation_id: string;
  intent: Intent;
  response: string;           // Natural language response
  data?: ChatData;            // Structured data based on intent
  actions?: ChatAction[];     // Available actions
}

type ChatData =
  | { type: "recipe"; recipe: Recipe; ingredients_status: IngredientStatus[] }
  | { type: "pantry_items"; items: PantryItem[] }
  | { type: "pantry_add_preview"; items: ParsedItem[] }
  | { type: "text"; content: string };

interface ChatAction {
  id: string;
  label: string;              // "Add to pantry", "Generate another"
  action_type: "confirm" | "navigate" | "upload";
  payload?: any;
}
```

---

## Intent Classification

### Simple keyword approach (v1)
```python
INTENT_KEYWORDS = {
    Intent.RECIPE_REQUEST: ["make", "cook", "recipe", "dinner", "lunch", "meal"],
    Intent.PANTRY_ADD: ["add", "bought", "got", "picked up"],
    Intent.PANTRY_QUERY: ["have", "do i have", "check", "what's in"],
    Intent.RECEIPT_SCAN: ["scan", "receipt", "upload"],
}
```

### AI classification (v2)
```
Classify this message into one of these intents:
- RECIPE_REQUEST: User wants recipe suggestions or cooking ideas
- PANTRY_ADD: User wants to add items to their pantry
- PANTRY_QUERY: User is asking what's in their pantry
- RECEIPT_SCAN: User wants to scan a receipt
- GENERAL_CHAT: General cooking questions or conversation

Message: "{user_message}"

Respond with just the intent name.
```

---

## Verification

Phase 2 complete when:

1. Dashboard shows expiring items
2. Quick actions navigate to correct pages
3. Chat can understand "what can I make with chicken?" → recipe
4. Chat can understand "add milk and eggs" → pantry add
5. Chat can understand "do I have butter?" → pantry query
6. Follow-up messages work in context
7. Action buttons in chat work

---

## Time Estimate

~3-4 sessions

---

## Notes

- Start with keyword matching for intents, upgrade to AI later
- Chat history can be in-memory for MVP (no persistence)
- Don't over-engineer conversation state
- Rich chat responses require careful UI work
