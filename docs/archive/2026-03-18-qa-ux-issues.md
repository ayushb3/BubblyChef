# QA Report: UX Issues & Missing Features

**Date:** 2026-03-18
**Tester:** Automated Playwright exploration
**Severity:** MEDIUM / LOW

---

## UX Issues

### 1. Dashboard Activity Feed — No Text Truncation (MEDIUM)

Long item names overflow the activity feed container. The "AAAAAA..." test item extends far beyond the card boundary.

**Fix:** Add `truncate` or `line-clamp-1` class to the item name text in the activity feed.

### 2. Dashboard "Add Item" Quick Action Doesn't Open Modal (MEDIUM)

Clicking "Add Item" on the dashboard navigates to `/pantry` but does NOT open the add item modal. User has to click the "+" button again.

**Expected:** Navigate to `/pantry` AND open the add modal (e.g., via query param `?addItem=true` or state).

### 3. No Auto-Categorization on Manual Add (MEDIUM)

When manually adding "Salmon Fillet" through the Add Item form, category defaults to "Other" instead of "Seafood". The backend has domain/normalizer + catalog logic but it's not triggered from the frontend add form.

**Expected:** After typing an item name, auto-detect and pre-select the correct category. This could be done:
- Client-side: Call a categorize endpoint on blur/debounce
- Server-side: Override category="other" with detected category on POST

### 4. Activity Feed Shows Stale Test Data (LOW)

"Added AAAAAA..." and XSS test items pollute the activity feed. No way to clear activity history.

### 5. Sidebar "Recipes" Link Missing (LOW)

The sidebar has: Home, Pantry, Scan, Chef, Profile — but no "Recipes" link. The `/recipes` route redirects to `/chat?mode=recipe`, which works, but there's no direct nav link.

The sidebar "Chef" link goes to `/chat`. Users wanting recipes need to know to click "Chef" then switch to "Recipe" tab.

### 6. Kitchen View Has No Standalone Route (LOW)

The kitchen scene is only accessible via the toggle button on `/pantry`. There's no `/kitchen` route. If a user bookmarks or shares a kitchen URL, they get a blank page.

### 7. Expiry Badge Inconsistency (LOW)

Some items show "No date" (gray badge), some show expiry in days. Items like "Chicken Breasts" (perishable, no expiry date) should show a warning rather than the neutral "No date" gray badge.

---

## What's Working Well

### Navigation
- Sidebar navigation works on all pages
- Active page highlighted correctly in sidebar
- Quick actions (Scan Receipt, Get Recipe) navigate correctly

### Pantry Page
- Search filtering works correctly (tested with "milk" — correctly filters to 6 items)
- Edit item modal is well-designed with all fields (name, quantity, unit, category, location, expiry)
- Add Item form has proper client-side validation (disabled button when name empty)
- Grid layout is responsive and clean
- Color-coded expiry badges are intuitive (red=expired, orange=soon, green=safe)
- Category-based left border colors work

### Kitchen Scene
- Beautiful Sanrio-style room view with pixel art appliances
- Interior views (fridge, pantry shelf, freezer, counter) load correctly
- Item counts shown on each appliance (Fridge: 5, Pantry: 22, etc.)
- Milestone/decoration system works (all 3 decorations unlocked at 33 items)
- Drag hint tooltip present on first visit
- Back button and zone navigation work

### Chat/Chef
- Three mode tabs (Chat, Recipe, Learn) with distinct personalities and prompts
- Personalized suggestions referencing actual pantry items and expiring foods
- AI responses are contextually aware of pantry contents
- Send button properly disabled when input is empty
- Conversation displayed with user/assistant bubble styling

### Scan Page
- Clean upload area with drag-and-drop support
- File type hints (PNG, JPG, HEIC)
- Helpful tips section for receipt quality
- OCR status endpoint confirms Tesseract availability

### API
- Proper HTTP status codes (422 for validation errors, 404 for not found)
- Consistent JSON response format
- Pagination metadata (total_count, expiring_soon_count, expired_count)
- UUID-based item IDs
- Expiry estimation with `estimated_expiry` flag

### Design System
- Consistent Sanrio/kawaii aesthetic throughout
- Pastel color palette well-applied
- Rounded corners, soft shadows
- Emoji integration feels natural
- Mobile-first layout works well on desktop too
