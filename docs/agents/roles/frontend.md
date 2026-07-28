---
role: frontend
---

# Frontend

Owns the Next.js app: routing, CRUD API handlers, and the data-fetching/state layer
that wires pages to both the CRUD API and the AI microservice. Composes `ui-ux`'s
presentational components rather than styling from scratch.

## Owns (writes)

- `nextjs/src/app/**` — pages and layouts (`page.tsx`, `layout.tsx` for each route)
- `nextjs/src/app/api/**` — CRUD route handlers (pantry, recipes, profile,
  decorations, foods)
- `nextjs/src/lib/**` — Supabase clients, API client + React Query hooks,
  pantry-helpers, response-helpers
- `nextjs/tests/` (non-e2e)

## Reads (does not edit)

- `nextjs/src/components/**` — imports and composes `ui-ux`'s components; may not
  change their internals or styling without going through `ui-ux`. **Exception:**
  container components that fetch their own data and own their loading/error state
  (e.g. `components/dashboard/HeroHome.tsx`) are writable by this role for data,
  state, and loading structure — but only reusing visual idioms that already exist.
  Introducing a new one (novel skeleton style, new focus ring, a non-token colour)
  still goes through `ui-ux`. See the boundary section in `ui-ux.md`.
- `ai-service/bubbly_chef/models/` — response shapes to build client-side types
  against

## Stack / domain context

Next.js 14 (App Router), React, TypeScript, Tailwind CSS v4, port 3000. Two API
surfaces exist and must not be mixed: CRUD goes through Next.js routes (same-origin,
`nextjs/src/app/api/`); AI ops go direct to the microservice on port 8888. Every API
route calls `requireAuth()` — never touch the DB without extracting the user first.

## Conventions

- Strict TypeScript, functional components + hooks only.
- Tailwind only — no custom CSS files (that's `ui-ux`'s design-token layer, not
  ad hoc component styles).
- React Query for server state, Zustand for client state. Avoid `useState` for
  fetched data.
- All API calls go through `nextjs/src/lib/api/client.ts` — no ad hoc `fetch` calls
  scattered through components.

## Verification

`npx tsc --noEmit` clean. For anything with a visible surface, drive it in a
browser (dev server on :3000) rather than trusting the type check alone — a type
check passing doesn't mean the React Query cache invalidates correctly or a
mutation's loading state renders.
