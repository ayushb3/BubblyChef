# QA Report: Critical Bugs

**Date:** 2026-03-18
**Tester:** Automated Playwright + API testing
**Severity:** CRITICAL / HIGH

---

## 1. CRITICAL: Pantry Location Filter Broken (Frontend ↔ Backend Mismatch)

**Severity:** CRITICAL — core feature completely non-functional
**Affects:** Pantry page location filter chips (Fridge, Freezer, Pantry, Counter)

**Root Cause:** Parameter name mismatch between frontend and backend.
- Frontend sends: `?location=freezer`
- Backend expects: `?storage=freezer`

**Files:**
- `web/src/api/client.ts:51` — sends `location` param
- `bubbly_chef/api/routes/pantry.py:62` — expects `storage` param

**Impact:** Clicking any location filter chip does nothing — always returns all items. The API silently ignores the unrecognized `location` param.

**Fix:** Either rename the frontend param to `storage` or add `alias="location"` to the backend Query parameter.

---

## 2. CRITICAL: Profile Page Permanently Broken (422 Error Loop)

**Severity:** CRITICAL — entire page unusable
**Affects:** `/profile` page

**Root Cause:** Frontend hardcodes `demo-user-id` as the profile ID, but the backend expects a valid UUID.
- `web/src/pages/Profile.tsx:7` — `const MOCK_PROFILE_ID = 'demo-user-id'`
- Backend returns 422: "Input should be a valid UUID"

**Impact:** Profile page shows infinite "Loading profile..." spinner. Console shows 3 retry attempts, all 422.

**Fix:** Need proper profile discovery — either use username/email lookup endpoints (`GET /profile/username/{username}`) or store the actual UUID after creation. Single-user app could have a default profile auto-created on first launch.

---

## 3. HIGH: Backend Accepts Empty Item Names

**Severity:** HIGH — data integrity issue
**Affects:** `POST /pantry` endpoint

**Evidence:** Successfully created an item with `name=""` via API. Frontend blocks this (Add Item button disabled when name empty) but API has no server-side validation.

**Impact:** Garbage data can enter the DB via API calls. Dashboard shows "Added " with no name in activity feed.

**Fix:** Add Pydantic validator `@field_validator('name')` to reject empty/whitespace-only names.

---

## 4. HIGH: No Input Sanitization on Item Names

**Severity:** HIGH — defense-in-depth concern
**Affects:** `POST /pantry`, `PUT /pantry/{id}` endpoints

**Evidence:** Successfully stored `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` in item names via API.

**Mitigated by:** React auto-escapes HTML on render, so no actual XSS in the current frontend. But any non-React consumer of the API/DB (mobile app, CLI tool, admin panel) would be vulnerable.

**Fix:** Add HTML tag stripping or rejection in the backend Pydantic model. Strip `< > " '` from item names at minimum.

---

## 5. HIGH: No 404/Catch-All Route

**Severity:** HIGH — poor UX
**Affects:** All unmatched routes (e.g., `/kitchen`, `/nonexistent`, `/anything`)

**Evidence:** Navigating to `/kitchen` or any unknown path shows a completely blank page with only the sidebar. No 404 message, no redirect to home.

**Console:** "No routes matched location" warning — but user sees nothing helpful.

**Fix:** Add a catch-all `<Route path="*" element={<NotFound />} />` in the router config that either shows a friendly 404 page or redirects to `/`.

---

## 6. HIGH: Chat Responses Show Raw Markdown

**Severity:** HIGH — poor UX
**Affects:** Chat page (`/chat`) responses

**Evidence:** AI responses contain `**bold**` text that renders as literal asterisks instead of formatted bold text. The chat bubble does not parse markdown.

**Fix:** Add a markdown renderer (e.g., `react-markdown`) to the chat message component.
