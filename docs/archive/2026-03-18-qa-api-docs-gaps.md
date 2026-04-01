# QA Report: API & Documentation Gaps

**Date:** 2026-03-18
**Tester:** API endpoint analysis
**Severity:** MEDIUM

---

## 1. CLAUDE.md API Documentation Is Wrong

The CLAUDE.md lists endpoints with `/api/` prefix:
```
GET|POST|PUT|DELETE  /api/pantry
GET  /api/pantry/expiring?days=3
POST /api/scan/receipt
...
```

**Actual endpoints have NO `/api/` prefix:**
```
GET|POST  /pantry
PUT  /pantry/{item_id}
DELETE  /pantry/{item_id}
GET  /pantry/expiring
POST /scan/receipt
...
```

Testing confirms: `GET /api/pantry` → 404, `GET /pantry` → 200.

**Impact:** Any developer or tool relying on CLAUDE.md will hit 404s.

---

## 2. Undocumented Endpoints

These endpoints exist in OpenAPI but aren't in CLAUDE.md:

| Endpoint | Purpose |
|----------|---------|
| `POST /ingest/chat` | Chat ingestion |
| `POST /ingest/receipt` | Receipt ingestion (different from /scan/receipt?) |
| `POST /ingest/product` | Product ingestion |
| `POST /recipes/ingest` | Recipe ingestion |
| `POST /apply` | Apply changes |
| `POST /v1/chat` | V1 chat endpoint |
| `POST /v1/workflows/{id}/events` | Workflow events |
| `GET /v1/workflows/{id}` | Get workflow |
| `GET /v1/conversations/{id}/history` | Conversation history |
| `POST /scan/undo/{request_id}` | Undo a scan |
| `GET /api/icons/{name}` | Get item icon |
| `GET /decorations` | List decorations |
| `GET /decorations/milestone-check` | Check milestone unlock |
| `POST /decorations/{name}/unlock` | Unlock a decoration |
| `PATCH /pantry/{item_id}/slot` | Update slot index |

---

## 3. GET /pantry/expiring Query Param Inconsistency

CLAUDE.md says: `GET /api/pantry/expiring?days=3`

Actual:
```
GET /pantry/expiring          (no days param documented in OpenAPI)
```

The `?days=3` parameter may or may not work — needs verification. The frontend `fetchExpiringItems` hardcodes `days=${days}` which defaults to 3.

---

## 4. Profile Endpoints Need Auth Strategy

Profile endpoints use UUID path params:
```
GET /profile/{profile_id}
PUT /profile/{profile_id}
DELETE /profile/{profile_id}
```

But the frontend uses `demo-user-id` (not a UUID). For a single-user app, there should be a simpler profile access pattern:
- `GET /profile` (get the current/only profile)
- Or auto-create a default profile on first access

---

## 5. Duplicate Endpoint Paths

Both `/scan/receipt` and `/ingest/receipt` exist. It's unclear which one the frontend should use and how they differ. Similarly:
- `/v1/chat` vs `/ingest/chat`
- `/recipes/generate` vs `/recipes/ingest`

**Risk:** Confusion about which endpoint to use, potential for stale/unmaintained duplicates.

---

## 6. Missing Error Response Documentation

No documented error response shapes. Through testing, errors come in two formats:
1. FastAPI validation: `{"detail": [{"type":"...", "loc":[...], "msg":"..."}]}`
2. Custom errors: `{"detail": "string message"}`

The frontend only handles generic fetch failures (`throw new Error('Failed to fetch ...')`), losing valuable error details from the API.
