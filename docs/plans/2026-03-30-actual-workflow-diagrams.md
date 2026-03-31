# BubblyChef Workflow Diagrams (Post-R1 Refactor)

> Mermaid diagrams of the actual LangGraph workflows as implemented in code.
> Generated from `workflows/router.py`, `workflows/pantry/nodes.py`,
> `workflows/recipe/nodes.py`, `workflows/chat/nodes.py`.

---

## 1. Parent Router Graph

The top-level graph that all `/v1/chat` requests flow through.

**Source:** `workflows/router.py` — `build_chat_router_graph()`

```mermaid
graph TD
    START((START)) --> init["initialize_state<br/><i>Set IDs, defaults</i>"]
    init --> classify["classify_intent<br/><i>Keywords → LLM fallback</i>"]

    classify -->|"pantry_update"| parse["parse_pantry_items"]
    classify -->|"receipt_ingest"| handoff_r["build_handoff_receipt"]
    classify -->|"product_ingest"| handoff_p["build_handoff_product"]
    classify -->|"recipe_ingest"| handoff_re["build_handoff_recipe"]
    classify -->|"cooking_help<br/>(is_recipe_gen=true)"| constraints["extract_recipe_constraints"]
    classify -->|"cooking_help<br/>(is_recipe_gen=false)"| cooking["cooking_help_response"]
    classify -->|"recipe_card<br/>(has selection)"| research["research_recipe"]
    classify -->|"recipe_card<br/>(no selection)"| cooking
    classify -->|"general_chat"| chat["general_chat_response"]

    %% Pantry pipeline
    parse --> normalize["normalize_items"]
    normalize --> expiry["apply_expiry_heuristics"]
    expiry --> dedup["check_for_duplicates"]
    dedup --> actions["create_actions"]
    actions --> gate["review_gate"]
    gate --> finalize["finalize_pantry_proposal"]
    finalize --> END1((END))

    %% Handoffs
    handoff_r --> END2((END))
    handoff_p --> END3((END))
    handoff_re --> END4((END))

    %% Chat/Cooking
    chat --> END5((END))
    cooking --> END6((END))

    %% Recipe brainstorm path
    constraints --> score["score_pantry_ingredients"]
    score --> brainstorm["brainstorm_recipe_ideas"]
    brainstorm --> END7((END))

    %% Grounded recipe path (brainstorm follow-up)
    research --> generate["generate_grounded_recipe"]
    generate --> END8((END))

    %% Styling
    style init fill:#e8f5e9
    style classify fill:#fff3e0
    style gate fill:#fce4ec
    style finalize fill:#e3f2fd
    style brainstorm fill:#f3e5f5
    style generate fill:#f3e5f5
```

---

## 2. Pantry Sub-Graph (Pipeline)

Linear deterministic pipeline — only `parse_pantry_items` calls the LLM.

**Source:** `workflows/pantry/nodes.py`

```mermaid
graph LR
    parse["parse_pantry_items<br/><i>LLM: extract items</i>"]
    norm["normalize_items<br/><i>Rule-based name cleanup</i>"]
    exp["apply_expiry_heuristics<br/><i>Category → shelf life</i>"]
    dedup["check_for_duplicates<br/><i>Batch + pantry snapshot</i>"]
    act["create_actions<br/><i>Build PantryUpsertActions</i>"]
    gate["review_gate<br/><i>Confidence thresholds</i>"]
    fin["finalize_pantry_proposal<br/><i>Wrap as PantryProposal</i>"]

    parse --> norm --> exp --> dedup --> act --> gate --> fin

    style parse fill:#fff3e0
    style gate fill:#fce4ec
```

### Review Gate Decision Logic

```mermaid
graph TD
    RG["review_gate"] --> check_empty{"No actions?"}
    check_empty -->|Yes| CLARIFY["REQUEST_CLARIFICATION<br/>requires_review=true"]
    check_empty -->|No| check_low{"confidence < 0.5?"}
    check_low -->|Yes| CLARIFY
    check_low -->|No| check_items{"Low-conf items<br/>or unusual qty?"}
    check_items -->|Yes| CLARIFY
    check_items -->|No| check_mid{"confidence < 0.95?"}
    check_mid -->|Yes| REVIEW["REVIEW_PROPOSAL<br/>requires_review=true"]
    check_mid -->|No| check_err{"Has errors?"}
    check_err -->|Yes| REVIEW
    check_err -->|No| AUTO["NONE (auto-apply)<br/>requires_review=false"]

    style CLARIFY fill:#ffcdd2
    style REVIEW fill:#fff9c4
    style AUTO fill:#c8e6c9
```

---

## 3. Recipe Sub-Graph

Two paths: **brainstorm** (first request) and **grounded generation** (follow-up selection).

**Source:** `workflows/recipe/nodes.py`

```mermaid
graph TD
    subgraph "Brainstorm Path (first request)"
        EC["extract_recipe_constraints<br/><i>LLM: parse cuisine, diet, time</i>"]
        SP["score_pantry_ingredients<br/><i>Deterministic: expiry + cuisine score</i>"]
        BR["brainstorm_recipe_ideas<br/><i>LLM: 3-4 bold-named ideas</i>"]
        EC --> SP --> BR
    end

    subgraph "Grounded Generation (follow-up)"
        RR["research_recipe<br/><i>DuckDuckGo search</i>"]
        GR["generate_grounded_recipe<br/><i>LLM: full RecipeCard</i>"]
        RR --> GR
    end

    BR -->|"User picks a recipe<br/>(next turn)"| RR

    style EC fill:#fff3e0
    style BR fill:#fff3e0
    style GR fill:#fff3e0
    style SP fill:#e8f5e9
    style RR fill:#e1f5fe
```

### Pantry Scoring Algorithm

```mermaid
graph LR
    item["Pantry Item"] --> expiry_check{"Expiry ≤3d?"}
    expiry_check -->|Yes| plus10["+10 pts"]
    expiry_check -->|No| expiry7{"Expiry ≤7d?"}
    expiry7 -->|Yes| plus5["+5 pts"]
    expiry7 -->|No| cuisine{"Matches cuisine<br/>keywords?"}
    plus10 --> cuisine
    plus5 --> cuisine
    cuisine -->|Yes| plus3["+3 pts"]
    cuisine -->|No| pref{"In preferred<br/>ingredients?"}
    plus3 --> pref
    pref -->|Yes| plus5b["+5 pts"]
    pref -->|No| excl{"In excluded?"}
    plus5b --> excl
    excl -->|Yes| minus100["-100 pts"]
    excl -->|No| final["Final score<br/>Sort desc, top 15"]
    minus100 --> final
```

---

## 4. Chat Sub-Graph

Simple LLM call nodes with pantry context injection.

**Source:** `workflows/chat/nodes.py`

```mermaid
graph TD
    subgraph "General Chat"
        GC["general_chat_response"]
        GC1["1. Fetch pantry (top 20 names)"]
        GC2["2. Build prompt:<br/>mode_prefix + system + pantry + history"]
        GC3["3. ai_manager.complete()"]
        GC4["4. detect_mode_suggestion()"]
        GC1 --> GC2 --> GC3 --> GC4
    end

    subgraph "Cooking Help"
        CH["cooking_help_response"]
        CH1["1. Fetch full pantry + expiring items"]
        CH2["2. Build prompt:<br/>cooking system + pantry detail + history"]
        CH3["3. ai_manager.complete()"]
        CH4["4. detect_mode_suggestion()"]
        CH1 --> CH2 --> CH3 --> CH4
    end

    style GC fill:#e3f2fd
    style CH fill:#e8f5e9
```

---

## 5. Intent Classification Flow

How `classify_intent` in `router.py` decides which path to take.

```mermaid
graph TD
    MSG["User Message"] --> BF{"Brainstorm<br/>follow-up?"}
    BF -->|Yes| RC["RECIPE_CARD"]
    BF -->|No| KW{"Keyword match?"}

    KW -->|"receipt keywords"| RI["RECEIPT_INGEST"]
    KW -->|"product keywords"| PI["PRODUCT_INGEST"]
    KW -->|"URL pattern"| REI["RECIPE_INGEST"]
    KW -->|"save/import recipe"| REI
    KW -->|"cooking help keywords"| CH["COOKING_HELP"]
    KW -->|"generic 'recipe'"| CH
    KW -->|"pantry action keywords"| PU["PANTRY_UPDATE"]
    KW -->|"no match"| LLM{"LLM Classification<br/><i>(Gemini → Ollama)</i>"}

    LLM --> MAP["Map to intent enum"]
    MAP --> ROUTE["route_by_intent()"]

    RI --> ROUTE
    PI --> ROUTE
    REI --> ROUTE
    CH --> ROUTE
    PU --> ROUTE
    RC --> ROUTE

    style BF fill:#f3e5f5
    style LLM fill:#fff3e0
    style ROUTE fill:#e8f5e9
```

---

## 6. Streaming vs Non-Streaming

`run_chat_workflow_streaming()` in `router.py` decides whether to stream or batch.

```mermaid
graph TD
    REQ["POST /v1/chat"] --> INIT["initialize_state()"]
    INIT --> CLASS["classify_intent()"]
    CLASS --> CHECK{"Intent streamable?"}

    CHECK -->|"general_chat,<br/>cooking_help,<br/>recipe_brainstorm"| STREAM["Stream tokens via<br/>ai_manager.stream_complete()"]
    CHECK -->|"pantry_update,<br/>receipt/product/recipe_ingest,<br/>recipe_card"| BATCH["Full graph.ainvoke()"]

    CHECK -->|"cooking_help +<br/>recipe mode"| BATCH

    STREAM --> COLLECT["Collect full text"]
    COLLECT --> MODE["detect_mode_suggestion()"]
    MODE --> ENV1["Build envelope"]
    ENV1 --> SSE1["Yield: tokens → done → envelope"]

    BATCH --> ENV2["_build_envelope_from_state()"]
    ENV2 --> SSE2["Yield: single envelope chunk"]

    style STREAM fill:#e8f5e9
    style BATCH fill:#e3f2fd
```

---

## 7. Envelope Type by Intent

What `run_chat_workflow()` returns based on the classified intent.

| Intent | Envelope Type | Proposal | Next Action |
|--------|--------------|----------|-------------|
| `pantry_update` | `PantryProposal` | Items + actions | `REVIEW_PROPOSAL` or `REQUEST_CLARIFICATION` |
| `receipt_ingest` | `HandoffProposal(RECEIPT)` | None | `REQUEST_RECEIPT_IMAGE` |
| `product_ingest` | `HandoffProposal(PRODUCT)` | None | `REQUEST_PRODUCT_BARCODE` |
| `recipe_ingest` | `HandoffProposal(RECIPE)` | None | `REQUEST_RECIPE_TEXT` |
| `recipe_brainstorm` | General chat envelope | None | `PICK_RECIPE` |
| `recipe_card` | `RecipeCardProposal` | Full recipe | `REVIEW_PROPOSAL` |
| `cooking_help` | General chat envelope | None | `NONE` |
| `general_chat` | General chat envelope | None | `NONE` |

---

## File Map

| File | Lines | Role |
|------|-------|------|
| `workflows/router.py` | 1029 | Parent graph, classify, route, envelope build, streaming |
| `workflows/shared_state.py` | 417 | LLM schemas, envelope factories, sub-state TypedDicts |
| `workflows/state.py` | 134 | WorkflowState TypedDict + re-exports from shared_state |
| `workflows/pantry/nodes.py` | 508 | 7 pantry pipeline nodes |
| `workflows/recipe/nodes.py` | 679 | Recipe constraints, brainstorm, research, grounded gen |
| `workflows/chat/nodes.py` | 329 | General chat + cooking help nodes |
| `workflows/chat_ingest.py` | 23 | Backward-compat shim (re-exports only) |
