# Issue #41 — Unify Scan and Manual Add into Single Pantry Add Flow

## Decisions

| Question | Answer |
|---|---|
| Unification approach | Scan results + manual add rows in same confirm step |
| Manual add UX | Multi-row spreadsheet style (add multiple items before confirming) |
| Entry point | Single "+" button on pantry page opens inline bottom sheet |
| Sheet modes | Two tabs: "Scan" (camera/upload) and "Type" (multi-row form) |
| /scan page | Remove — all adding happens via pantry page sheet |
| Dashboard "Scan" card | Navigates to /pantry with sheet auto-opened in scan mode |
| Pantry Quick Add modal | Replaced by the unified sheet |

## Architecture

```
/pantry page
    │
    ├── [+] button (FAB or header)
    │       │
    │       ▼
    │   ┌─────────────────────────────────┐
    │   │ Add to Pantry (bottom sheet)    │
    │   │                                 │
    │   │ [📷 Scan]  [✍️ Type]  ← tabs    │
    │   │ ─────────────────────────       │
    │   │                                 │
    │   │ Scan tab:                       │
    │   │   Drop/camera → AI parse →     │
    │   │   Items appear in review list   │
    │   │                                 │
    │   │ Type tab:                       │
    │   │   Multi-row form                │
    │   │   [name] [qty] [unit] [cat]     │
    │   │   [name] [qty] [unit] [cat]     │
    │   │   [+ Add another item]          │
    │   │                                 │
    │   │ ── Review (both sources) ──     │
    │   │ ✅ Chicken Breast  2x (scan)    │
    │   │ ✅ Whole Milk      1L (scan)    │
    │   │ ✚ Bananas         6x (manual)  │
    │   │                                 │
    │   │  ┌──────────────────────┐       │
    │   │  │ Add 3 Items 🛒       │       │
    │   │  └──────────────────────┘       │
    │   └─────────────────────────────────┘
    │
    └── POST /api/pantry (bulk: array of items)
```

## Component Breakdown

### New Components

1. **`PantryAddSheet.tsx`** — main bottom sheet container
   - Manages open/close state
   - Two-tab layout (Scan / Type)
   - Shared item list state (combines both sources)
   - Confirm button triggers bulk POST

2. **`ScanTab.tsx`** — receipt upload + AI parsing
   - Reuses upload logic from current `/scan` page
   - Parsed items flow into shared item list
   - Tiered review: ready / needs-review / skipped

3. **`TypeTab.tsx`** — multi-row manual entry
   - Dynamic row list (starts with 1 empty row)
   - "+ Add another item" appends a row
   - Each row: name (text), qty (number), unit (select), category (select)
   - Remove button per row (X)

4. **`AddItemRow.tsx`** — single editable row component
   - Controlled inputs
   - Category dropdown with food catalog suggestions
   - Unit dropdown (common units)

### Removed

- `/scan` page (`nextjs/src/app/scan/page.tsx`) — deleted
- `AddItemModal.tsx` (if it exists) — replaced by PantryAddSheet

### Modified

- `/pantry` page — add [+] button, mount PantryAddSheet
- Dashboard page — "Scan" card links to `/pantry?add=scan` (auto-opens sheet in scan mode)
- Navigation — remove /scan from nav bar

## API Changes

### Bulk pantry add (new or extend existing)

The existing `POST /api/pantry` takes a single item. We need bulk support:

```typescript
// POST /api/pantry/bulk
// Body: { items: PantryAddItem[] }

interface PantryAddItem {
  name: string
  quantity: number
  unit: string
  category: string
  storage_location: string
  expiry_date?: string | null
  source: 'scan' | 'manual'
}
```

Alternatively, extend existing `POST /api/pantry` to accept both single item and array.

## Implementation Steps

### Phase A: Backend

1. **Bulk endpoint** — `POST /api/pantry/bulk` route that accepts array of items, inserts all in one transaction
2. **Remove scan-specific confirm** — or keep for backwards compat during transition

### Phase B: Frontend — Component Build

1. **PantryAddSheet** — bottom sheet with tab switcher
2. **TypeTab** — multi-row form with dynamic rows
3. **ScanTab** — extract upload + parsing logic from current scan page into this component
4. **AddItemRow** — individual row component

### Phase C: Frontend — Integration

1. **Mount on pantry page** — [+] button triggers sheet open
2. **Dashboard link** — update Scan card to `/pantry?add=scan`
3. **Remove /scan** — delete page, update nav
4. **Remove AddItemModal** — replaced by sheet

### Phase D: Polish

1. **Auto-open via URL param** — `/pantry?add=scan` or `/pantry?add=type`
2. **Empty state** — prompt user to scan or type when sheet first opens
3. **Mobile UX** — sheet is full-height on mobile, half-screen on desktop
4. **Success feedback** — items added toast, sheet closes, pantry list refreshes

## Acceptance Criteria

- [ ] Single [+] button on pantry page opens the add sheet
- [ ] Scan tab: upload receipt → items appear in review list
- [ ] Type tab: multi-row form, add/remove rows dynamically
- [ ] Both sources combine into one item list with shared confirm button
- [ ] Confirm POSTs all items in bulk, pantry list refreshes
- [ ] /scan page removed, dashboard links to /pantry?add=scan
- [ ] Navigation updated (no /scan in nav)
- [ ] TypeScript compiles: `cd nextjs && npx tsc --noEmit`
- [ ] Existing scan API integration still works through the new component
