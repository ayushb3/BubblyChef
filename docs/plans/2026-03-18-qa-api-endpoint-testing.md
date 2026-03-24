# QA Report: API Endpoint Testing (Automated)

**Date:** 2026-03-18
**Tester:** Automated curl-based API testing (~80 requests)
**Severity:** CRITICAL / HIGH / MEDIUM

---

## CRITICAL: 500 Errors (Server Crashes) — 2 Found

### 1. POST /pantry with negative quantity → 500 (not 422)

```bash
curl -X POST /pantry -d '{"name":"test","quantity":-5}'
# → 500 Internal server error: ValidationError
```

**Root cause:** `CreatePantryItemRequest` has no `ge=0` constraint on `quantity`, but the domain `PantryItem` model does. Validation passes the route model but crashes when constructing the domain model.

**File:** `bubbly_chef/api/routes/pantry.py:22` — needs `quantity: float = Field(default=1.0, ge=0)`

### 2. POST/PUT /pantry with invalid expiry_date format → 500 (not 422)

```bash
curl -X POST /pantry -d '{"name":"test","expiry_date":"not-a-date"}'
# → 500 Internal server error: ValueError: Invalid isoformat string
```

**Root cause:** `expiry_date` is `str | None`, parsed with `fromisoformat()` inside the handler with no try/except. Should use `date` type in Pydantic model or wrap parse.

**File:** `bubbly_chef/api/routes/pantry.py:165,221`

---

## HIGH: Missing Input Validation — 6 Findings

| Issue | Input | Result | Expected |
|-------|-------|--------|----------|
| Empty name accepted | `{"name":""}` | 201 created | 422 reject |
| No max_length on name | 10,000-char name | 201 created | 422 reject |
| No max on quantity | `1e308` | 201 created | 422 reject |
| HTML/script stored verbatim | `<script>alert(1)</script>` | 201 stored | Strip or reject |
| Empty PUT body updates `updated_at` | `{}` | 200 | No-op or 422 |
| Negative quantity | `{"quantity":-5}` | 500 crash | 422 reject |

---

## MEDIUM: Behavioral Issues — 5 Findings

### 1. Ingest endpoints return 200 with failure in body

`POST /ingest/receipt` and `/ingest/product` return HTTP 200 with `"workflow_status":"failed"` in the response body. Clients must inspect the body to detect failure — HTTP status code doesn't reflect it.

### 2. POST /scan/confirm with empty items returns 200

`{"request_id":"x","items":[]}` → `{"added":[],"failed":[]}` with 200. Should warn or reject.

### 3. POST /v1/chat doesn't validate conversation_id

Nonexistent conversation_id silently creates a new conversation instead of 404.

### 4. Ingest product with empty body returns 400

Both `barcode` and `description` are optional in Pydantic but the handler requires at least one. Validation mismatch.

### 5. GET /profile/ with empty ID → 307 redirect (instead of 404)

Path matches `POST /profile` via trailing-slash redirect.

---

## GOOD: Proper Validation Confirmed

All of the following work correctly:

- Missing required fields → 422
- Invalid enum values (category, storage_location, mode) → 422
- Invalid UUID path params → 422
- Nonexistent UUID lookups → 404
- Malformed JSON body → 422
- Wrong HTTP method → 405
- Invalid email format → 422
- Username too short/long → 422
- Duplicate username/email → 400
- Wrong content-type on file upload → 400
- Empty file upload → 400
- Text too long (ChatIngestRequest > 5000) → 422
- Empty prompt (min_length=1) → 422
- Double delete (idempotent) → 404
- **SQL injection in search param → Safe (parameterized queries)**
- Unicode/emoji in names → Accepted correctly
- CORS preflight → 200 with proper headers
- Concurrent creates → All succeed

---

## All Endpoints Working Correctly

| Endpoint | Status |
|----------|--------|
| GET /health, /health/ai | 200 |
| GET /pantry (list, search) | 200 |
| GET /pantry/expiring?days=N | 200, validates 1≤days≤365 |
| POST /pantry (create) | 201, auto-estimates expiry |
| GET/PUT/DELETE /pantry/{id} | All work |
| PATCH /pantry/{id}/slot | 200 |
| GET /scan/ocr-status | 200, Tesseract available |
| POST /scan/receipt, /confirm, /preprocess | Work |
| POST /scan/undo/{id} | 404 for expired sessions |
| GET /recipes/suggestions | 200, up to 5 suggestions |
| POST /recipes/generate | 200, full recipe |
| POST/GET/PUT/DELETE /profile | All CRUD works |
| POST /v1/chat | 200, intent classification |
| POST /apply | 200 |
| GET /decorations, /milestone-check | 200 |
| GET /api/icons/{name} | 200 |
