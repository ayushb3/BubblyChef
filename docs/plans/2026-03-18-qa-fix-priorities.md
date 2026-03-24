# QA Report: Recommended Fix Priority

**Date:** 2026-03-18

---

## Priority 1 — Fix Now (Broken Core Features)

### P1.1: Fix pantry location filter (5 min)
**File:** `web/src/api/client.ts:51`
Change `searchParams.append('location', params.location)` to `searchParams.append('storage', params.storage)` — or better, rename the backend param to `location` with `Query(None, alias="location")`.

### P1.2: Fix profile page (15 min)
**File:** `web/src/pages/Profile.tsx:7`
Replace hardcoded `demo-user-id` with actual profile discovery. Options:
- Use `GET /profile/username/testuser` to find existing profile
- Auto-create profile on first visit
- Store profile UUID in localStorage after creation

### P1.3: Add backend validation for empty item names (5 min)
**File:** `bubbly_chef/api/routes/pantry.py:21`
Add `@field_validator('name')` or `min_length=1` to `CreatePantryItemRequest.name`.

---

## Priority 2 — Fix Soon (Bad UX, Data Quality)

### P2.1: Add markdown rendering to chat bubbles (15 min)
Install `react-markdown`, wrap chat AI responses in `<ReactMarkdown>`.

### P2.2: Add 404 catch-all route (5 min)
Add `<Route path="*" element={<Navigate to="/" />} />` or a NotFound component.

### P2.3: Add text truncation to dashboard activity feed (5 min)
Add `truncate` or `max-w-*` class to activity item names.

### P2.4: Fix "Add Item" quick action to open modal (10 min)
Pass state through navigation: `navigate('/pantry', { state: { openAddModal: true } })`.

### P2.5: Re-categorize existing "other" items (30 min)
Write a one-time migration script using `catalog.categorize()` to fix the 16 miscategorized items.

### P2.6: Add auto-categorization to manual add flow (20 min)
Call the normalizer/catalog on the backend when creating items, or add a client-side debounced categorize call.

---

## Priority 3 — Nice to Have (Polish)

### P3.1: Item deduplication on add
### P3.2: Consistent item name casing (title case)
### P3.3: Item-specific emojis (use catalog lookup, not just category)
### P3.4: Add `/kitchen` as a standalone route
### P3.5: Clean up test data from DB
### P3.6: Update CLAUDE.md API documentation
### P3.7: Add input sanitization (strip HTML tags from item names)
### P3.8: Better error messages from API to frontend

---

## Testing Summary

| Area | Status | Issues |
|------|--------|--------|
| Dashboard | Mostly works | Activity feed overflow, test data visible |
| Pantry (grid view) | **BROKEN** filter | Location filter does nothing |
| Pantry (kitchen view) | Works well | Beautiful room + interiors |
| Search | Works | Correct filtering |
| Add Item | Works (frontend) | Backend missing validation |
| Edit Item | Works | Modal opens correctly |
| Scan Page | Works (upload UI) | Not tested with actual receipt |
| Chat | Works | Raw markdown in responses |
| Recipe Mode | Works | Personalized suggestions |
| Learn Mode | Works | Good prompt suggestions |
| Profile | **BROKEN** | 422 error, infinite spinner |
| 404 Handling | **MISSING** | Blank page on unknown routes |
| API Validation | Incomplete | Empty names, HTML accepted |
| Data Quality | Poor | 48% miscategorized, many duplicates |
