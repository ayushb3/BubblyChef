# AI Workflow Diagrams

Visual Mermaid diagrams for the BubblyChef AI workflow architecture redesign.
See `2026-03-30-ai-workflows-architecture-redesign.md` for full specs.

---

## 1. Parent Router Graph

The router loads the conversation session, classifies intent (with session mode as a fast-path),
dispatches to the correct sub-graph, then wraps the response.

```mermaid
graph TD
    START([START]) --> load_session[Load ConversationSession<br/>from SQLite]
    load_session --> classify[Classify Intent<br/>context-aware]
    classify --> check_mode{Session Mode?}

    check_mode -->|default| full_classify{Intent?}
    check_mode -->|cooking| cooking_sub
    check_mode -->|recipe_exploring| recipe_sub
    check_mode -->|ingesting| ingest_sub
    check_mode -->|pantry_editing| pantry_sub

    full_classify -->|pantry-add| pantry_sub[Pantry<br/>Sub-Graph]
    full_classify -->|recipe-generate| recipe_sub[Recipe<br/>Sub-Graph]
    full_classify -->|cooking-question| cooking_sub[Cooking<br/>Sub-Graph]
    full_classify -->|ingest| ingest_sub[Ingest<br/>Sub-Graph]
    full_classify -->|general| chat_sub[General Chat<br/>Sub-Graph]

    pantry_sub --> update_session[Update Session State]
    recipe_sub --> update_session
    cooking_sub --> update_session
    ingest_sub --> update_session
    chat_sub --> update_session

    update_session --> wrap[Wrap Response in<br/>ProposalEnvelope]
    wrap --> END([END])

    style pantry_sub fill:#b5ead7,stroke:#4a4a4a
    style recipe_sub fill:#ffb5c5,stroke:#4a4a4a
    style cooking_sub fill:#ffdab3,stroke:#4a4a4a
    style ingest_sub fill:#c9b5e8,stroke:#4a4a4a
    style chat_sub fill:#ff9aa2,stroke:#4a4a4a
    style classify fill:#fff9f5,stroke:#4a4a4a
    style check_mode fill:#fff9f5,stroke:#4a4a4a
    style full_classify fill:#fff9f5,stroke:#4a4a4a
```

**Key pattern:** Session mode acts as a fast-path. If the user is mid-flow (cooking, exploring recipes, etc.), the router skips LLM classification entirely and routes directly. Only in `default` mode does it run the full keyword → LLM intent classification.

---

## 2. Pantry Sub-Graph

A deterministic pipeline — no LLM tool-calling loop. Each node calls shared tools directly.
Branching happens only at the review gate based on confidence thresholds.

```mermaid
graph TD
    START([START]) --> parse[parse_items<br/>LLM extracts items from text]
    parse --> normalize[normalize<br/>Name → category, unit, emoji]
    normalize --> expiry[apply_expiry<br/>Category → shelf life estimate]
    expiry --> dedup[check_duplicates<br/>Compare against pantry snapshot]
    dedup --> actions[create_actions<br/>Build PantryUpsertActions]
    actions --> review{review_gate<br/>confidence?}

    review -->|≥ 0.8<br/>High| finalize_ready[finalize<br/>ready_to_add]
    review -->|0.5 – 0.8<br/>Medium| finalize_review[finalize<br/>needs_review<br/>+ clarifying questions]
    review -->|< 0.5<br/>Low| finalize_error[finalize<br/>error response<br/>+ clarifying questions]

    finalize_ready --> END([END])
    finalize_review --> END
    finalize_error --> END

    style parse fill:#b5ead7,stroke:#4a4a4a
    style normalize fill:#b5ead7,stroke:#4a4a4a
    style expiry fill:#b5ead7,stroke:#4a4a4a
    style dedup fill:#b5ead7,stroke:#4a4a4a
    style actions fill:#b5ead7,stroke:#4a4a4a
    style review fill:#fff9f5,stroke:#4a4a4a
    style finalize_ready fill:#ffb5c5,stroke:#4a4a4a
    style finalize_review fill:#ffdab3,stroke:#4a4a4a
    style finalize_error fill:#ff9aa2,stroke:#4a4a4a
```

**Key pattern:** This is a **linear pipeline** — the simplest LangGraph topology. Compare with the Cooking and General Chat sub-graphs which use the **ReAct loop** pattern (LLM ↔ ToolNode cycle).

**Confidence thresholds:**
- `≥ 0.8` — items are ready to add (user just confirms)
- `0.5 – 0.8` — items need review (user edits before confirming)
- `< 0.5` — too ambiguous, ask clarifying questions

**Shared tools called by nodes:**
| Node | Tool |
|------|------|
| parse_items | `parse_items(text)` → LLM structured output |
| normalize | `normalize_item(name)` → category, unit, emoji |
| apply_expiry | `estimate_expiry(item)` → shelf life |
| check_duplicates | `check_duplicates(items, pantry)` → dedup result |
| create_actions | (internal) builds `PantryUpsertAction` list |
| review_gate | (internal) checks aggregate confidence |
| finalize | (internal) wraps into `PantryProposal` |

---

## Diagram Legend

| Color | Meaning |
|-------|---------|
| 🟢 `#b5ead7` (mint) | Pantry / processing nodes |
| 🩷 `#ffb5c5` (pink) | Recipe / success path |
| 🟠 `#ffdab3` (peach) | Cooking / review path |
| 🟣 `#c9b5e8` (lavender) | Ingest |
| 🔴 `#ff9aa2` (coral) | General Chat / error path |
| ⬜ `#fff9f5` (cream) | Decision / routing nodes |

## 3. Recipe Sub-Graph

Multi-stage pipeline with a **user interaction break** — brainstorm presents options, user picks one,
then the graph continues with research and generation. Uses shared tools directly (no ReAct loop).

```mermaid
graph TD
    START([START]) --> constraints[extract_constraints<br/>Parse dietary prefs, cuisine,<br/>time limits from input]
    constraints --> score[score_pantry<br/>Match pantry items against<br/>recipe constraints]
    score --> brainstorm[brainstorm<br/>LLM generates 3-5 recipe ideas<br/>ranked by pantry coverage]
    brainstorm --> present[Return ideas to user<br/>Session mode → recipe_exploring]

    present -.->|User picks a recipe<br/>next turn| selected[receive_selection<br/>Map user choice to idea]
    selected --> research[research<br/>Web search for reference recipe<br/>+ technique details]
    research --> generate[generate_grounded<br/>LLM creates full RecipeCard<br/>grounded in research + pantry]
    generate --> availability[check_availability<br/>Score each ingredient<br/>against pantry]
    availability --> finalize[finalize<br/>Build RecipeCardProposal<br/>with substitution suggestions]
    finalize --> END([END])

    style constraints fill:#ffb5c5,stroke:#4a4a4a
    style score fill:#ffb5c5,stroke:#4a4a4a
    style brainstorm fill:#ffb5c5,stroke:#4a4a4a
    style present fill:#fff9f5,stroke:#4a4a4a
    style selected fill:#fff9f5,stroke:#4a4a4a
    style research fill:#c9b5e8,stroke:#4a4a4a
    style generate fill:#ffb5c5,stroke:#4a4a4a
    style availability fill:#b5ead7,stroke:#4a4a4a
    style finalize fill:#ffb5c5,stroke:#4a4a4a
```

**Key pattern:** This graph has a **session break** in the middle. After `brainstorm`, the response goes back to the user and the session mode is set to `recipe_exploring`. When the user replies with their pick, the router fast-paths back into this sub-graph at `receive_selection`. This is a form of **human-in-the-loop** — the graph pauses for user input, then resumes.

**Shared tools called by nodes:**
| Node | Tool |
|------|------|
| extract_constraints | (internal) parse user message + profile prefs |
| score_pantry | `score_pantry_for_recipe(constraints)` |
| brainstorm | LLM call via `AIManager.complete()` |
| research | `search_recipes(query, cuisine)` |
| generate_grounded | LLM call via `AIManager.complete()` with research context |
| check_availability | `score_pantry_for_recipe()` per ingredient |
| finalize | (internal) wraps into `RecipeCardProposal` |

---

## 4. Cooking Sub-Graph (ReAct Pattern)

The first **agentic** sub-graph — uses the ReAct loop where the LLM decides which tools to call.
Active when a user is cooking a pinned recipe and asking questions.

```mermaid
graph TD
    START([START]) --> call_llm[call_cooking_llm<br/>System prompt includes:<br/>full recipe + current step<br/>+ pantry summary]
    call_llm --> check{Tool calls<br/>in response?}

    check -->|Yes| tool_node[ToolNode<br/>Execute tool calls]
    tool_node --> call_llm

    check -->|No| respond[respond<br/>Format final answer<br/>Update current_step if needed]
    respond --> END([END])

    subgraph tools [Available LLM Tools]
        t1[suggest_substitution<br/>ingredient, available_items]
        t2[explain_technique<br/>technique name]
        t3[get_pantry_items<br/>check what user has]
    end

    tool_node -.-> tools

    style call_llm fill:#ffdab3,stroke:#4a4a4a
    style check fill:#fff9f5,stroke:#4a4a4a
    style tool_node fill:#c9b5e8,stroke:#4a4a4a
    style respond fill:#ffdab3,stroke:#4a4a4a
    style t1 fill:#b5ead7,stroke:#4a4a4a
    style t2 fill:#b5ead7,stroke:#4a4a4a
    style t3 fill:#b5ead7,stroke:#4a4a4a
```

**Key pattern:** This is the **ReAct loop** from the video. The LLM calls → checks if it wants tools → executes tools → feeds results back to LLM → repeat until the LLM responds without tool calls. LangGraph's `ToolNode` handles the tool execution automatically.

**Why ReAct here?** The cooking companion needs to dynamically decide: "Should I check the pantry for a substitution, or just answer the question directly?" That decision is best left to the LLM, not hardcoded.

---

## 5. Ingest Sub-Graph (Unified)

Routes different media types through specialized handlers, then delegates to
Pantry or Recipe sub-graphs for the actual processing.

```mermaid
graph TD
    START([START]) --> detect[detect_media_type<br/>Classify: photo, URL,<br/>video, receipt, text]
    detect --> route{Media type?}

    route -->|receipt_image| ocr[receipt_handler<br/>Tesseract OCR → raw text]
    route -->|photo| vision[photo_handler<br/>Gemini Vision API<br/>→ identified items]
    route -->|video_url| video[video_handler<br/>Extract transcript<br/>→ recipe text]
    route -->|url| fetch[url_handler<br/>Fetch + clean HTML<br/>→ recipe text]
    route -->|text| text_classify{text_handler<br/>Items or recipe?}

    ocr --> pantry_sub[Pantry Sub-Graph]
    vision --> pantry_sub

    video --> recipe_sub[Recipe Sub-Graph]
    fetch --> recipe_sub

    text_classify -->|Items detected| pantry_sub
    text_classify -->|Recipe detected| recipe_sub

    pantry_sub --> END([END])
    recipe_sub --> END

    style detect fill:#c9b5e8,stroke:#4a4a4a
    style route fill:#fff9f5,stroke:#4a4a4a
    style ocr fill:#c9b5e8,stroke:#4a4a4a
    style vision fill:#c9b5e8,stroke:#4a4a4a
    style video fill:#c9b5e8,stroke:#4a4a4a
    style fetch fill:#c9b5e8,stroke:#4a4a4a
    style text_classify fill:#fff9f5,stroke:#4a4a4a
    style pantry_sub fill:#b5ead7,stroke:#4a4a4a
    style recipe_sub fill:#ffb5c5,stroke:#4a4a4a
```

**Key pattern:** This is a **fan-out router** — one entry point, multiple specialized handlers, converging back into existing sub-graphs. The Ingest graph doesn't duplicate Pantry or Recipe logic; it delegates. This is **sub-graph composition** — a graph calling other graphs.

**Shared tools called by handlers:**
| Handler | Tool |
|---------|------|
| receipt_handler | `ocr_receipt(image, preprocess)` |
| photo_handler | `identify_items_from_photo(image)` (Gemini Vision) |
| video_handler | `extract_video_transcript(url)` |
| url_handler | `fetch_url_content(url)` |

---

## 6. General Chat Sub-Graph (ReAct Pattern)

The second agentic sub-graph — handles open-ended cooking questions with
tool access for pantry-aware answers.

```mermaid
graph TD
    START([START]) --> call_llm[call_chat_llm<br/>System prompt includes:<br/>personality + pantry summary<br/>+ conversation history]
    call_llm --> check{Tool calls<br/>in response?}

    check -->|Yes| tool_node[ToolNode<br/>Execute tool calls]
    tool_node --> call_llm

    check -->|No| respond[respond<br/>Format answer<br/>+ suggest mode/action if relevant]
    respond --> END([END])

    subgraph tools [Available LLM Tools]
        t1[get_pantry_items<br/>what do I have?]
        t2[search_recipes<br/>find me a pasta recipe]
        t3[score_pantry_for_recipe<br/>what can I make?]
        t4[suggest_substitution<br/>what can replace butter?]
    end

    tool_node -.-> tools

    style call_llm fill:#ff9aa2,stroke:#4a4a4a
    style check fill:#fff9f5,stroke:#4a4a4a
    style tool_node fill:#c9b5e8,stroke:#4a4a4a
    style respond fill:#ff9aa2,stroke:#4a4a4a
    style t1 fill:#b5ead7,stroke:#4a4a4a
    style t2 fill:#b5ead7,stroke:#4a4a4a
    style t3 fill:#b5ead7,stroke:#4a4a4a
    style t4 fill:#b5ead7,stroke:#4a4a4a
```

**Key pattern:** Same ReAct loop as Cooking, but with different tools and a broader system prompt. The `respond` node can also suggest mode transitions (e.g., "Want me to help you cook that?" → sets `suggested_mode: "cooking"`), which the router picks up on the next turn.

**Cooking vs General Chat — why two ReAct sub-graphs?**
| | Cooking | General Chat |
|---|---|---|
| **Context** | Pinned recipe + current step | Open-ended, no pinned recipe |
| **Tools** | Substitution, technique, pantry | Pantry, recipe search, scoring, substitution |
| **System prompt** | Focused: "help cook this recipe" | Broad: "friendly cooking assistant" |
| **Session mode** | `cooking` (sticky until exit) | `default` (no sticky mode) |

---

## Graph Topology Summary

| Sub-Graph | Topology | LLM Tool Access | Session Break |
|-----------|----------|-----------------|---------------|
| Pantry | Linear pipeline | No (deterministic) | No |
| Recipe | Pipeline with break | No (deterministic) | Yes (brainstorm → user picks) |
| Cooking | ReAct loop | Yes (3 tools) | No |
| Ingest | Fan-out router | No (delegates to other sub-graphs) | No |
| General Chat | ReAct loop | Yes (4 tools) | No |

---

## Diagram Legend

| Color | Meaning |
|-------|---------|
| `#b5ead7` (mint) | Pantry / shared tool nodes |
| `#ffb5c5` (pink) | Recipe nodes |
| `#ffdab3` (peach) | Cooking nodes |
| `#c9b5e8` (lavender) | Ingest / ToolNode execution |
| `#ff9aa2` (coral) | General Chat nodes |
| `#fff9f5` (cream) | Decision / routing nodes |
