# Architecture Deepening — Investigation & Improvement Plans

## Context

BubblyChef is a two-service app (Next.js frontend + FastAPI AI microservice) that has grown organically through 7 phases. The code works, but several modules have become shallow — their interfaces are nearly as complex as their implementations, they lack locality (understanding one concept requires reading 6+ files), and tight coupling to infrastructure makes testing painful. This document investigates each friction point and proposes a concrete deepening plan.

---

## 1. Router Monolith → Intent Classifier + Mode State Machine

### Investigation

**File:** `ai-service/bubbly_chef/workflows/router.py` (1392 lines)

**What it does today:** Single file that:
- Loads session state from DB (lines 180-211)
- Classifies intent via mode-aware routing (lines 214-335), keyword cascades (lines 336-554), and LLM fallback (lines 556-623)
- Routes to handler nodes for each intent
- Manages session mode transitions (lines 736-792)
- Produces ProposalEnvelopes

**Why it's shallow:** The "classify intent" interface is one function call, but understanding what it does requires reading 400+ lines of cascading if-else. Adding a new intent means inserting keyword lists in the middle of the cascade, hoping ordering doesn't break existing classifications. The function is untestable without mocking `get_ai_manager()` and `get_repository()` globals.

**Coupling evidence:**
- Line 40: `from bubbly_chef.repository.supabase_repo import get_repository`
- Line 27: `from bubbly_chef.api.deps import get_ai_manager`
- These are called *inside* node functions (lines 182, 262, 557, 725) — not injected at the graph boundary.

**Session mode logic:** Lines 230-315 implement a state machine via nested if-else. Transitions are implicit — you can only discover valid transitions by reading the code. No diagram, no table, no enum of transitions.

### Improvement Plan

**Step 1: Extract `IntentClassifier` (new file: `workflows/intent_classifier.py`)**
```
class IntentClassifier:
    def __init__(self, ai_manager: AIManager):
        self._ai = ai_manager
        self._rules: list[ClassificationRule] = [...]  # registered rules

    async def classify(self, text: str, context: ClassificationContext) -> IntentResult:
        # 1. Check mode overrides
        # 2. Run keyword rules in priority order
        # 3. Fall back to LLM
```
- Each intent's keyword list becomes a `ClassificationRule` dataclass with `keywords`, `intent`, `confidence`
- Rules are registered declaratively — adding a new intent = adding a rule, not editing a 400-line function
- LLM fallback is the last rule in the chain

**Step 2: Extract `SessionStateMachine` (new file: `workflows/session_mode.py`)**
```
TRANSITIONS: dict[SessionMode, dict[Intent, SessionMode]] = {
    SessionMode.DEFAULT: {
        Intent.RECIPE_BRAINSTORM: SessionMode.RECIPE_EXPLORING,
        Intent.PANTRY_UPDATE: SessionMode.INGESTING,
        ...
    },
    ...
}

class SessionStateMachine:
    def transition(self, current: SessionMode, intent: Intent) -> SessionMode: ...
    def should_force_intent(self, mode: SessionMode, text: str) -> Intent | None: ...
```

**Step 3: Dependency injection for graph nodes**
- Graph builder accepts `repository` and `ai_manager` as parameters
- Nodes receive dependencies via closure or `functools.partial`
- `get_repository()` and `get_ai_manager()` only called once at graph construction time (in the route handler)

**Step 4: Test boundary**
- `IntentClassifier` tested with a mock `AIManager` — no DB, no graph
- `SessionStateMachine` tested as pure function — given (mode, intent), expect new mode
- Graph nodes tested with injected fakes

**Files affected:**
- `workflows/router.py` — shrinks from 1392 to ~600 lines (orchestration only)
- NEW `workflows/intent_classifier.py` — ~200 lines
- NEW `workflows/session_mode.py` — ~80 lines
- `api/deps.py` — add DI wiring for graph construction

**Deletion test:** If you deleted the extracted `IntentClassifier`, the 400 lines of keyword cascades would reappear inside the router. The extraction concentrates classification logic — it earns its keep.

---

## 2. Business Logic in Repository → Pantry Domain Service

### Investigation

**File:** `ai-service/bubbly_chef/repository/supabase_repo.py` (447 lines)

**What it does today:** `apply_pantry_proposal()` (lines 172-265) implements:
- Fuzzy matching via `find_similar_item()` to detect duplicates
- Quantity merging: `new_qty = existing.quantity + action.quantity`
- Base unit normalization: calls `normalize_to_base_unit()` from domain layer
- Use-to-zero deletion: if quantity drops to 0, delete item
- Update/remove action dispatch

**Why it's shallow:** The repository's interface says "apply a proposal" but callers must understand the merge/dedup/normalize semantics to reason about correctness. The repo imports `normalize_to_base_unit` from the domain layer — a data access module depending on domain logic is an inverted dependency. There's no protocol/interface — only SupabaseRepository exists, making it impossible to test business rules without Supabase.

**Evidence of domain logic in wrong layer:**
- Line 14: `from bubbly_chef.domain.normalizer import normalize_to_base_unit`
- Lines 185-205: Dedup + merge decision (if existing → merge, else → create)
- Lines 229-235: Use-to-zero threshold logic

### Improvement Plan

**Step 1: Define `PantryRepository` protocol (new file: `repository/protocol.py`)**
```python
from typing import Protocol

class PantryRepository(Protocol):
    async def find_similar_item(self, user_id: str, name: str) -> PantryItem | None: ...
    async def add_pantry_item(self, user_id: str, item: PantryItem) -> str: ...
    async def update_pantry_item(self, user_id: str, item_id: str, updates: dict) -> None: ...
    async def delete_pantry_item(self, user_id: str, item_id: str) -> None: ...
    async def get_all_pantry_items(self, user_id: str) -> list[PantryItem]: ...
```
- CRUD-only signatures — no business logic
- `SupabaseRepository` satisfies this protocol with no changes to its CRUD methods

**Step 2: Extract `PantryService` (new file: `services/pantry_service.py`)**
```python
class PantryService:
    def __init__(self, repo: PantryRepository):
        self._repo = repo

    async def apply_proposal(self, user_id: str, actions: list[dict]) -> ApplyResult:
        # Merge/dedup/normalize logic moves here
        # Calls self._repo for CRUD only
```

**Step 3: Create `InMemoryPantryRepository` for tests (new file: `repository/memory.py`)**
```python
class InMemoryPantryRepository:
    def __init__(self): self._items: dict[str, list[PantryItem]] = {}
    # Implements PantryRepository protocol with dict storage
```

**Step 4: Wire DI**
- `get_repository()` returns `PantryRepository` protocol type
- Route handlers construct `PantryService(repo)` via FastAPI `Depends`

**Files affected:**
- `repository/supabase_repo.py` — remove `apply_pantry_proposal`, remove `normalize_to_base_unit` import
- NEW `repository/protocol.py` — ~30 lines
- NEW `services/pantry_service.py` — ~100 lines (the extracted logic)
- NEW `repository/memory.py` — ~60 lines (test fake)
- `workflows/router.py` — call `PantryService.apply_proposal()` instead of `repo.apply_pantry_proposal()`

**Deletion test:** If you deleted `PantryService`, the merge/dedup/normalize logic would reappear in the repository (where it currently lives). The extraction concentrates domain rules — callers of the repo no longer need to understand merge semantics.

---

## 3. useChat Hook Sprawl → Layered Composable Hooks

### Investigation

**File:** `nextjs/src/hooks/useChat.ts` (255 lines)

**What it does today:** Single hook manages:
1. **Messages** — `messages` state array, append/update by ID
2. **Streaming** — `isStreaming`, `streamAbortRef`, SSE connection lifecycle
3. **Conversation identity** — `conversationId`, lazy creation, history loading
4. **Proposal state** — `proposalStates` and `workflowIds` as parallel Records

**Why it's shallow:** The hook's return type has 9 values. Understanding proposal approval requires reading through streaming logic. You can't reuse SSE streaming for a different feature (e.g., real-time pantry updates) without importing chat proposal logic. `AI_SERVICE_URL` is duplicated in this file, `lib/api/chat.ts`, and `lib/api/ai-proxy.ts`.

**Specific coupling problems:**
- Lines 181-210: `approveProposal` does a dynamic import of Supabase client, fetches session token, constructs fetch URL — all inline
- Lines 23-26: `proposalStates` and `workflowIds` are parallel Maps that must stay in sync but have no structural guarantee
- Line 7: `AI_SERVICE_URL` defined locally (also in chat.ts and ai-proxy.ts)

### Improvement Plan

**Step 1: Consolidate config (`lib/config.ts`)**
```typescript
export const AI_SERVICE_URL = process.env.NEXT_PUBLIC_AI_SERVICE_URL || 'http://localhost:8888'
```
Remove duplicates from `useChat.ts`, `chat.ts`, `ai-proxy.ts`.

**Step 2: Extract `useSSEStream` hook (new file: `hooks/useSSEStream.ts`)**
```typescript
export function useSSEStream() {
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const startStream = useCallback((url, body, handlers: { onToken, onDone, onError }) => { ... }, [])
  const cancelStream = useCallback(() => { ... }, [])

  return { isStreaming, startStream, cancelStream }
}
```

**Step 3: Extract `useProposalState` hook (new file: `hooks/useProposalState.ts`)**
```typescript
type ProposalEntry = { state: 'pending' | 'approved' | 'rejected'; workflowId: string }

export function useProposalState() {
  const [proposals, setProposals] = useState<Record<string, ProposalEntry>>({})

  const trackProposal = useCallback((msgId: string, workflowId: string) => { ... }, [])
  const approve = useCallback(async (msgId: string) => { ... }, [])
  const reject = useCallback(async (msgId: string) => { ... }, [])

  return { proposals, trackProposal, approve, reject }
}
```
- Unifies `proposalStates` and `workflowIds` into one keyed structure
- Auth token fetching extracted into a `getAuthToken()` helper

**Step 4: Slim `useChat` to composition**
```typescript
export function useChat(initialConversationId?: string) {
  const { isStreaming, startStream, cancelStream } = useSSEStream()
  const { proposals, trackProposal, approve, reject } = useProposalState()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState(initialConversationId ?? null)

  // ~40 lines of composition logic
  return { messages, isStreaming, conversationId, proposals, sendMessage, cancelStream, startNewChat, approve, reject }
}
```

**Files affected:**
- `hooks/useChat.ts` — shrinks from 255 to ~80 lines
- NEW `hooks/useSSEStream.ts` — ~50 lines
- NEW `hooks/useProposalState.ts` — ~60 lines
- NEW `lib/config.ts` — ~5 lines
- `lib/api/chat.ts` — import from `config.ts`
- `lib/api/ai-proxy.ts` — import from `config.ts`

**Deletion test:** If you deleted `useSSEStream`, the streaming boilerplate would reappear in `useChat`. If you deleted `useProposalState`, the parallel-record management would reappear. Both extractions concentrate concerns.

---

## 4. Frontend Data Fetching → React Query Adoption

### Investigation

**Files:** `components/recipes/RecipeBookLoader.tsx`, `components/recipes/RecipeBook.tsx`, `components/Providers.tsx`

**What it does today:**
- `Providers.tsx` configures `QueryClientProvider` with 1-minute stale time
- The pantry page uses `useQuery` — proving the pattern works
- RecipeBookLoader uses imperative `fetch()` + `refreshKey` counter
- RecipeBook has 9 `useState` calls mixing server state (recipes, loading) with UI state (modal open, selected)

**Why it's shallow:** The `refreshKey` pattern is a manual, fragile cache invalidation mechanism. Each component re-implements data fetching (loading states, error handling, refetch triggers). There's no deduplication — if two components need recipes, they fetch independently.

**Evidence:**
- RecipeBook lines 39-48: `search`, `sidebarOpen`, `selectedId`, `editOpen`, `deleteOpen`, `importOpen`, `importDraft`, `mutating` — at least `recipes` + loading state should be in React Query
- `onMutate?.()` callback triggers parent's `setRefreshKey(k => k+1)` — prop-drilled imperative refresh

### Improvement Plan

**Step 1: Define query hooks (new file: `hooks/useRecipes.ts`)**
```typescript
export function useRecipes() {
  return useQuery({
    queryKey: ['recipes'],
    queryFn: () => fetch('/api/recipes').then(r => r.json()),
  })
}

export function useUpdateRecipe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: { id: string; updates: Partial<Recipe> }) =>
      fetch(`/api/recipes/${args.id}`, { method: 'PUT', body: JSON.stringify(args.updates) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recipes'] }),
  })
}

export function useDeleteRecipe() { ... }
export function useFavoriteRecipe() { ... }
```

**Step 2: Eliminate RecipeBookLoader**
- Page component calls `useRecipes()` directly
- Loading/error states handled by React Query's `isLoading`, `isError`
- `RecipeBookLoader` becomes unnecessary — delete it

**Step 3: Slim RecipeBook to UI-only state**
After React Query handles server state, RecipeBook keeps only:
- `search`, `sidebarOpen`, `selectedId`, `editOpen`, `deleteOpen`, `importOpen`, `importDraft`
- `mutating` replaced by `useMutation`'s `isPending`

**Step 4: Remove `onMutate` prop drilling**
- Mutations call `queryClient.invalidateQueries(['recipes'])` directly
- No more `refreshKey`, no more `onMutate` callbacks

**Files affected:**
- NEW `hooks/useRecipes.ts` — ~60 lines
- `components/recipes/RecipeBookLoader.tsx` — DELETE
- `components/recipes/RecipeBook.tsx` — remove server-state logic, keep UI state
- `app/recipes/page.tsx` — use `useRecipes()` directly
- `components/recipes/RecipeEditModal.tsx` — call `useUpdateRecipe()` instead of `onSave` callback

**Deletion test:** If you deleted `useRecipes`, the imperative fetch + refreshKey pattern would reappear in components. The hook concentrates data-fetching concerns behind a declarative interface.

---

## 5. AI Manager Shallow Depth → Configurable Retry + Narrower Protocol

### Investigation

**File:** `ai-service/bubbly_chef/ai/manager.py` (301 lines), `ai/provider.py` (103 lines)

**What it does today:**
- `AIManager.complete()` (lines 56-160): loops through providers, tries each with hardcoded 2-retry on `StructuredOutputError`, logs timing, falls back on any exception
- `AIManager.vision_complete()` (lines 162-199): same loop but filters by `supports_vision` at runtime
- `AIProvider` base class: `complete()` abstract, `vision_complete()` raises `NotImplementedError` by default, `stream_complete()` defaults to calling `complete()` and yielding result

**Why it's shallow:**
- 275 lines of orchestration that adds minimal leverage beyond "try providers in order"
- Callers can't customize retry behavior (structured output retries always = 2)
- `supports_vision` is a runtime bool — callers must check it before calling `vision_complete()`
- Provider ABC has optional methods that raise — the interface promises capabilities it doesn't enforce

### Improvement Plan

**Step 1: Introduce `RetryPolicy` dataclass**
```python
@dataclass
class RetryPolicy:
    max_structured_retries: int = 2
    backoff_base: float = 0.0  # seconds, 0 = no backoff
```
- `complete()` accepts optional `retry_policy: RetryPolicy | None`
- Default policy preserves current behavior (2 retries, no backoff)
- Receipt scanning can pass `RetryPolicy(max_structured_retries=3)` for more tolerance

**Step 2: Narrow provider protocol**
```python
class AIProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def complete(self, prompt, response_schema, temperature) -> T | str: ...

    @abstractmethod
    async def is_available(self) -> bool: ...

class VisionProvider(AIProvider):
    @abstractmethod
    async def vision_complete(self, prompt, image_bytes, ...) -> T | str: ...

class StreamingProvider(AIProvider):
    @abstractmethod
    async def stream_complete(self, prompt, temperature) -> AsyncIterator[str]: ...
```
- `vision_complete()` only available on providers that explicitly implement `VisionProvider`
- Manager methods can accept `VisionProvider` type — checked at construction, not runtime
- Remove `supports_vision` property

**Step 3: Extract retry loop into utility**
```python
async def with_provider_fallback(
    providers: list[AIProvider],
    operation: Callable[[AIProvider], Awaitable[T]],
    filter_fn: Callable[[AIProvider], bool] = lambda _: True,
) -> T:
    # The retry + fallback loop, parameterized
```
- Both `complete()` and `vision_complete()` become thin calls to `with_provider_fallback`
- Manager shrinks from 301 to ~120 lines

**Files affected:**
- `ai/provider.py` — split into `AIProvider`, `VisionProvider`, `StreamingProvider`
- `ai/manager.py` — shrinks significantly, retry loop extracted
- `ai/gemini.py` — implements `VisionProvider` + `StreamingProvider`
- `ai/ollama.py` — implements `StreamingProvider` only

**Deletion test:** If you deleted the `RetryPolicy` and `with_provider_fallback` utility, the retry loops would reappear duplicated in `complete()` and `vision_complete()`. The extraction concentrates retry semantics.

---

## 6. No Shared Contract → Schema-Driven Type Generation

### Investigation

**Files:** `nextjs/src/types/` (TS types), `ai-service/bubbly_chef/models/` (Pydantic models)

**What it does today:** TypeScript interfaces and Pydantic models are written and maintained independently. When the AI service adds a field to `ProposalEnvelope`, the frontend won't know until the field is accessed (or not accessed) at runtime. There's no CI check for drift.

**Evidence of implicit contract:**
- `nextjs/src/types/chat.ts` defines `ChatResponse` with fields like `workflow_id`, `requires_review`
- `ai-service/bubbly_chef/models/base.py` defines `ProposalEnvelope` with the same fields in Python
- If backend renames `workflow_id` → `wf_id`, frontend breaks silently

**Risk assessment:** Currently low blast radius (one team, one app), but this is the kind of bug that causes production incidents after a "simple rename."

### Improvement Plan

**Step 1: Export OpenAPI spec from FastAPI (already available)**
- FastAPI auto-generates `/openapi.json` from Pydantic models
- Add a script: `cd ai-service && python -c "from bubbly_chef.main import app; import json; print(json.dumps(app.openapi()))" > openapi.json`

**Step 2: Generate TypeScript types from OpenAPI**
- Install `openapi-typescript` as dev dependency in `nextjs/`
- Script: `npx openapi-typescript ../ai-service/openapi.json -o src/types/generated/ai-service.d.ts`

**Step 3: CI gate**
- GitHub Actions step: regenerate types, `git diff --exit-code src/types/generated/`
- If diff is non-empty → fail with message "AI service schema changed — regenerate frontend types"

**Step 4: Migrate frontend types incrementally**
- Don't rewrite all types at once
- Start with `ChatResponse` and `ProposalEnvelope` — the highest-traffic contract types
- Import from generated types, delete hand-written duplicates one by one

**Files affected:**
- NEW `ai-service/scripts/export_openapi.py` — ~10 lines
- NEW `nextjs/src/types/generated/ai-service.d.ts` — auto-generated
- `nextjs/package.json` — add `openapi-typescript` dev dep + generate script
- `.github/workflows/ci.yml` — add schema drift check step
- `nextjs/src/types/chat.ts` — gradually replace with imports from generated types

**Deletion test:** If you deleted the generated types and CI check, the manual type duplication would return. The generation step concentrates the contract definition in one place (Pydantic models).

---

## Verification Strategy

For each improvement:

| # | How to verify |
|---|---|
| 1 | `cd ai-service && pytest tests/test_intent_classifier.py` — new unit tests for classification rules. Run full `pytest` to ensure graph still routes correctly. |
| 2 | `cd ai-service && pytest tests/test_pantry_service.py` — test merge/dedup with `InMemoryPantryRepository`. Run `pytest tests/` for integration. |
| 3 | Component tests with `@testing-library/react` + `renderHook` for each extracted hook. Manual test in browser: send chat, approve proposal. |
| 4 | `cd nextjs && npx tsc --noEmit` + manual browser test of recipe CRUD (create, edit, delete, favorite, search). Verify no `refreshKey` remnants. |
| 5 | `cd ai-service && pytest tests/test_ai_manager.py` — test retry policy with mock provider. `mypy bubbly_chef/ --strict` to verify type narrowing. |
| 6 | CI script: `npm run generate:types && git diff --exit-code src/types/generated/` passes. Rename a field in Pydantic → CI fails as expected. |

---

## Implementation Order

Recommended sequence (each is independently shippable):

1. **#2 (Pantry Domain Service)** — smallest scope, highest testability gain, no frontend changes
2. **#1 (Router decomposition)** — high impact, depends on #2's protocol being in place
3. **#3 (useChat hooks)** — independent of backend, mechanical decomposition
4. **#4 (React Query)** — builds on #3's patterns, mechanical adoption
5. **#5 (AI Manager)** — moderate impact, can be done anytime
6. **#6 (Shared contract)** — CI/tooling, do last when the API surface is stable
