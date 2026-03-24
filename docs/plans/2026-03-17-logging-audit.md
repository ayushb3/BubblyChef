# BubblyChef Logging Audit Report

**Date:** 2026-03-17  
**Scope:** FastAPI backend + frontend error handling  
**Status:** Current state documentation (no changes made)

---

## Executive Summary

The BubblyChef project has a **solid logging foundation** with:
- Centralized logger configuration in `logger.py` with colored output
- Helper functions for standard patterns (request/response/error/AI call/DB operation)
- Middleware for HTTP request/response logging
- Generally good logging discipline across routes

However, there are **inconsistencies and gaps**:
- Not all routes import and use the logger
- Some routes use bare `except Exception as e:` without logging context
- Frontend error handling is minimal (only throws generic errors)
- No global exception handler middleware to catch unhandled errors
- Missing structured logging context in some high-value operations

---

## Route-by-Route Audit

| Route File | Logger Import | Route Entry Logs | Error Handling | Bare Except | Notes |
|---|---|---|---|---|---|
| **health.py** | ❌ NO | N/A (simple) | N/A | N/A | No logging needed; endpoints are trivial |
| **pantry.py** | ✅ YES | Partial (only expiring endpoint) | No try/catch | ❌ None | 2 log calls total; missing logs on POST/PUT/DELETE |
| **scan.py** | ✅ YES (get_logger) | Partial | Try/catch + logging | ❌ None | 6 log calls; good coverage in scan_receipt; confirm_items missing error logs |
| **recipes.py** | ✅ YES (get_logger) | ✅ YES (detailed) | Try/catch + logging | ❌ None | Excellent logging; uses `extra={}` for structured context; 13+ log calls |
| **profile.py** | ✅ YES | ✅ Partial (create/update/delete) | Try/catch | ❌ None | 5 log calls; missing on GET endpoints |
| **chat.py** | ✅ YES | ✅ Detailed | Try/catch + logging | ❌ None | 8+ log calls; very detailed request/response logging |
| **ingest.py** | ✅ YES | Partial | Try/catch + logging | ❌ None | 4 route handlers; mixed logging coverage |
| **apply.py** | ✅ YES | ✅ Partial | Try/catch + logging | ❌ None | 7+ log calls; error handling is present but minimal context |

---

## Detailed Findings

### 1. **Logger Setup** (`logger.py`)

**Status:** GOOD

**What's included:**
- `setup_logging()` — configures root logger with console + optional file handler
- Colored output (DEBUG=cyan, INFO=green, WARNING=yellow, ERROR=red, CRITICAL=magenta)
- Debug mode verbosity (includes filename:lineno)
- Third-party library noise reduction (urllib3, httpx, httpcore, openai, anthropic)
- Helper functions:
  - `log_request(method, path, **kwargs)` → emoji: ➡️
  - `log_response(method, path, status, duration_ms)` → emoji: ✅/❌
  - `log_error(message, error, **kwargs)` → logs exception class + message
  - `log_ai_call(provider, model, tokens, duration_ms)` → emoji: 🤖
  - `log_db_operation(operation, table, count, **kwargs)` → emoji: 💾

**Issue:** `app.py` calls `logging.basicConfig()` at module level (line 16-19) BEFORE `setup_logging()` is called anywhere. This is a redundant initialization that could interfere with the ColoredFormatter setup. Also, `setup_logging()` is defined but never explicitly called in the app startup.

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/logger.py`

### 2. **Middleware** (`middleware.py`)

**Status:** GOOD (but not wired in)

**What's included:**
- `LoggingMiddleware` — logs all requests/responses with timing
- Uses `log_request()` and `log_response()` helper functions
- Catches exceptions and logs them with context

**Issues:**
- Not registered in `app.py` (line 86-93 only show CORS middleware)
- Controlled by `settings.log_requests` flag (unclear if this is set)
- Doesn't transform responses to standardized error format

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/middleware.py`

### 3. **Route: health.py**

**Status:** NO LOGGING (acceptable)

- No logger import
- Simple read-only operations (no side effects)
- Minimal logging value

### 4. **Route: pantry.py**

**Status:** INCONSISTENT

**Logging present:**
- `list_expiring_items()` (lines 117, 136): 2 log calls
  ```python
  logger.info(f"Fetching expiring items within {days} days")
  logger.info(f"Found {len(expiring_items)} items expiring within {days} days")
  ```

**Logging missing:**
- `list_pantry()` — no entry/exit logs
- `create_pantry_item()` — no logging on success or error
- `update_pantry_item()` — no logging
- `get_pantry_item()` — no logging
- `delete_pantry_item()` — no logging

**Error handling:** No try/catch blocks (relies on FastAPI default exception handling).

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/pantry.py`

### 5. **Route: scan.py**

**Status:** GOOD (but gaps in confirm_items)

**Logging present:**
- `scan_receipt()` (lines 136, 138, 153):
  - Preprocessing result logging
  - OCR failure logging
  - Error handling with context
- `preprocess_receipt()` (lines 421, 440, 457, 460):
  - Good error logging on image load failure
  - Success logging with image dimensions
  - Unexpected error logging

**Logging missing:**
- `confirm_items()` (lines 266-298) — **bare `except Exception` with no logging** (line 295)
  ```python
  except Exception as e:
      failed.append(f"{item.name}: {str(e)}")  # Swallowed; no logger.error()
  ```
- `undo_auto_added()` (lines 323) — has warning log, but no entry/exit logs
- `ocr_status()` — no logging

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/scan.py:295`

### 6. **Route: recipes.py**

**Status:** EXCELLENT

**Logging present:**
- `generate_recipe_endpoint()` (lines 74-82, 87, 111-121, 134-143):
  - Entry: request metadata (prompt preview, constraints, context)
  - Info: pantry items count
  - Success: recipe details with timing (structured `extra={}`)
  - Error: full exception context with `exc_info=True` (stack trace logged)
- `get_recipe_suggestions()` (lines 160, 192-199, 204-209):
  - Entry: request logged
  - Success: suggestions count + pantry stats
  - Error: fallback with logging

**Pattern used:** Structured logging with `extra={}` dict for JSON-compatible context (best practice).

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/recipes.py`

### 7. **Route: profile.py**

**Status:** PARTIAL

**Logging present:**
- `create_profile()` (lines 106, 121, 125): entry + success + error
- `update_profile()` (lines 148, 176, 180): entry + success + error
- `delete_profile()` (lines 194, 203): entry + success

**Logging missing:**
- `get_profile()` — no logs
- `get_profile_by_email()` — no logs
- `get_profile_by_username()` — no logs

**Error handling:** Try/catch with logger.error() on ValueError (lines 123-126, 174-181).

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/profile.py`

### 8. **Route: chat.py**

**Status:** EXCELLENT

**Logging present:**
- `chat()` (lines 132-141, 179-192, 198-207):
  - Entry: message preview, length, conversation_id, mode, pantry snapshot flag
  - Success: intent, requires_review, next_action, confidence, proposal flag, workflow_id, timing, warnings/errors counts
  - Error: full exception context with `exc_info=True`
- `submit_workflow_event()` (lines 244-253, 257, 293, 324, 347):
  - Entry: workflow_id, event_type, decision, edits flag, idempotency_key
  - Mid-process: approval/rejection logging
  - Error: exception logging
- Logging middleware integration attempted (`log_ingestion` calls)

**Pattern:** Consistent structured logging with `extra={}`.

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/chat.py`

### 9. **Route: ingest.py**

**Status:** GOOD (mixed coverage)

**Logging present:**
- `ingest_chat()` (lines 46, 61-65, 70): entry + success (action count + confidence) + error
- `ingest_receipt()` (lines 89, 112-115, 120): entry + success + error
- `ingest_product()` (lines 142-144, 169-172, 177): entry + success + error
- `ingest_recipe()` (lines 201, 224-227, 232): entry + success (recipe title) + error

**Error handling:** Try/catch with logger.error() + exc_info=True on all endpoints.

**Pattern:** Good consistency across all 4 endpoints; uses action count + confidence as key metrics.

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/ingest.py`

### 10. **Route: apply.py**

**Status:** PARTIAL (missing entry logs, mixed action logging)

**Logging present:**
- Entry: `logger.info(f"Apply request: {request.request_id}, intent={request.intent}")` (line 91)
- During processing: per-action logs (lines 125, 129, etc.)
  ```python
  logger.info(f"Updated existing item: {existing.name}")
  logger.info(f"Added new item: {item.name}")
  logger.info(f"Removed depleted item: {existing.name}")
  ```
- Errors: per-action error logging (lines 222, 283, 292)
  ```python
  logger.error(f"Failed to apply action: {e}")
  logger.error(f"Failed to apply recipe: {e}")
  logger.error(f"Apply failed: {e}", exc_info=True)
  ```

**Issues:**
- No structured context with `extra={}` (unlike recipes.py/chat.py)
- No timing information
- No summary log on completion
- Line 271 (`await repo.get_recipe(recipe_id)`) — calls undocumented method (may not exist)
- Line 274 (`await repo.update_recipe(recipe)`) — calls undocumented method
- Line 276 (`await repo.add_recipe(recipe)`) — calls undocumented method

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/apply.py`

---

## Frontend: Error Handling (`web/src/api/client.ts`)

**Status:** MINIMAL

**Current approach:**
- Generic error messages: `"Failed to [operation]"`
- Reads error text from response but doesn't log or format it
- No console logging
- No user-facing error context (e.g., "Server returned 500: Internal error")

**Example:** Lines 55-56
```typescript
const response = await fetch(url);
if (!response.ok) throw new Error('Failed to fetch pantry items');
```

**Issues:**
- No logging of HTTP status codes
- No indication of network vs. API errors
- Frontend has no visibility into backend error details
- No retry logic
- No timing information

**Location:** `/Users/I589687/Documents/Personal/BubblyChef/web/src/api/client.ts`

---

## Global Exception Handling

**Status:** NOT IMPLEMENTED

**Current state:**
- No global `@app.exception_handler()` in FastAPI
- No custom error response formatter
- Relies on FastAPI's default 500 Internal Server Error responses

**Gap:** Unhandled exceptions in middleware or async tasks may not be logged properly.

---

## Logging Configuration

**Status:** INCOMPLETE

**Config variables in settings:**
- Checked: `settings.debug` (used in logger.py)
- Checked: `settings.log_file` (conditional file handler)
- Found: `settings.log_requests` (used in middleware)

**Not found:** No explicit call to `setup_logging()` in app startup.

---

## Key Observations & Patterns

### Good Patterns (Model These)

1. **recipes.py** — Best-in-class logging:
   ```python
   logger.info(
       "Recipe generation requested",
       extra={
           "prompt": request.prompt[:100],
           "prompt_length": len(request.prompt),
           "has_constraints": request.constraints is not None,
           "has_context": request.previous_recipe_context is not None,
       },
   )
   ```
   - Structured context via `extra={}`
   - Truncated sensitive data
   - Boolean flags for optional fields
   - Timing measurements

2. **chat.py** — Detailed workflow logging:
   ```python
   logger.info(
       "Chat workflow completed",
       extra={
           "intent": envelope.intent.value,
           "requires_review": envelope.requires_review,
           "next_action": envelope.next_action.value,
           "confidence": envelope.confidence.overall,
           "has_proposal": envelope.proposal is not None,
           "workflow_id": str(envelope.workflow_id),
           "elapsed_seconds": elapsed,
           "warnings_count": len(envelope.warnings) if envelope.warnings else 0,
           "errors_count": len(envelope.errors) if envelope.errors else 0,
       },
   )
   ```

3. **scan.py** — Error context logging:
   ```python
   except Exception as e:
       logger.error(f"OCR failed: {e}")
       raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")
   ```

### Anti-Patterns (Avoid)

1. **scan.py line 295** — Silently swallowing exceptions:
   ```python
   except Exception as e:
       failed.append(f"{item.name}: {str(e)}")  # Not logged!
   ```

2. **pantry.py** — No logging on mutation endpoints:
   - POST, PUT, DELETE have zero visibility

3. **profile.py** — Inconsistent GET logging:
   - GET operations (read-only) have no logs
   - Mutations (POST, PUT, DELETE) are logged

4. **app.py** — Redundant logging.basicConfig():
   ```python
   logging.basicConfig(  # Line 16-19
       level=logging.DEBUG if settings.debug else logging.INFO,
       format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
   )
   ```
   Should call `setup_logging()` instead.

---

## Coverage Summary

| Metric | Status | Notes |
|---|---|---|
| Logger imports | ✅ Mostly | health.py missing (acceptable) |
| Route entry logs | ⚠️ Partial | Good on complex routes; missing on simple CRUD |
| Route exit logs | ⚠️ Partial | recipes.py/chat.py good; others minimal |
| Error handling | ✅ Good | Try/catch present in most; some bare except remain |
| Structured context | ⚠️ Partial | recipes.py/chat.py excellent; others use f-strings |
| Exception details | ✅ Good | exc_info=True used appropriately |
| Middleware | ❌ Not wired | LoggingMiddleware exists but not registered |
| Global exception handler | ❌ Missing | No custom error response formatter |
| Frontend logging | ❌ None | Only generic error strings |
| Timing/metrics | ✅ Good | Present in complex workflows |

---

## Recommendations (For Future Work)

### HIGH PRIORITY

1. **Register LoggingMiddleware** in app.py
   - Add `app.add_middleware(LoggingMiddleware)` after CORS
   - Verify `settings.log_requests` is configured

2. **Fix scan.py:295** (confirm_items exception)
   - Replace silent exception handling with `logger.error(f"Failed to add item {item.name}: {e}")`

3. **Add entry/exit logs to pantry.py mutations**
   - POST: log item name, category, quantity
   - PUT: log item_id, fields updated
   - DELETE: log item_id

4. **Global exception handler**
   - Add `@app.exception_handler(Exception)` to catch unhandled errors
   - Log with full stack trace
   - Return standardized error response

### MEDIUM PRIORITY

5. **Standardize structured logging**
   - Apply `extra={}` pattern from recipes.py/chat.py to all routes
   - Consistently log timing (elapsed_seconds) for complex operations

6. **Frontend error handling**
   - Log HTTP status codes and response text in client.ts error handlers
   - Consider console.error() for debugging
   - Add user-friendly error messages beyond generic text

7. **Health check startup**
   - Explicitly call `setup_logging()` in app.py lifespan (before logging.basicConfig)

### LOW PRIORITY

8. **Database operation logging**
   - Use `log_db_operation()` helper in repository methods
   - Log SELECT/INSERT/UPDATE/DELETE operations with row counts

9. **AI call logging**
   - Use `log_ai_call()` helper in AI manager
   - Track provider, model, token usage, duration

10. **Request/response context variables**
    - Use Python contextvars to track request_id through the call stack
    - Include request_id in all log messages

---

## File Locations Summary

**Logger setup:**
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/logger.py` (88 lines)
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/app.py` (112 lines)
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/middleware.py` (51 lines)

**Routes (audit table above):**
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/health.py`
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/pantry.py`
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/scan.py`
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/recipes.py` (BEST EXAMPLE)
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/profile.py`
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/chat.py` (GOOD)
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/ingest.py`
- `/Users/I589687/Documents/Personal/BubblyChef/bubbly_chef/api/routes/apply.py`

**Frontend:**
- `/Users/I589687/Documents/Personal/BubblyChef/web/src/api/client.ts`

---

*Report generated: 2026-03-17*
