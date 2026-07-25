# Playwright e2e harness

Two projects, split so CI can run one of them with **zero secrets**:

## `smoke` — no credentials required

Tests only the unauthenticated surface: the app boots, a protected route
redirects to `/login`, the login form renders, and there are no console
errors on load. No `global setup`, no `storageState`, no Supabase login.

```bash
npx playwright test --project=smoke
```

This is the project CI runs on every PR (see `.github/workflows/ci.yml`,
job `nextjs-e2e`).

The dev server that Playwright boots for this project still needs
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set to *something*
non-empty — the app's middleware (`src/lib/supabase/middleware.ts`)
constructs a Supabase client on every request, so the process crashes with
undefined values even for routes that never touch Supabase. `playwright.config.ts`
supplies obvious placeholder values for the dev server it launches when real
ones aren't present in `nextjs/.env.local`; they are not real credentials and
don't need to be secret.

## `authenticated` — requires a Supabase test account

Logs in via the Supabase REST API in `e2e/auth.setup.ts` (the `auth-setup`
project, which `authenticated` depends on) and reuses the resulting
`storageState` across its specs.

```bash
npx playwright test --project=authenticated
```

Requires these in `nextjs/.env.local` (or the environment):

| Var | Purpose |
|---|---|
| `TEST_USERNAME` | Email of a real Supabase user to log in as |
| `TEST_PASSWORD` | That user's password |
| `NEXT_PUBLIC_SUPABASE_URL` | Real project URL (placeholders won't authenticate) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Real anon key |

When any of these are missing, both `e2e/auth.setup.ts` and
`e2e/authenticated.spec.ts` **skip themselves cleanly** (via `test.skip(...)`
at describe-scope, evaluated before any fixture is created) instead of
failing or throwing. This project is intentionally **not** wired into CI yet
— see the commented-out step in `.github/workflows/ci.yml` for how to enable
it once the owner adds `TEST_USERNAME` / `TEST_PASSWORD` (and the real
Supabase vars) as repo secrets.

## Adding a new spec

- Unauthenticated behavior → `e2e/smoke.spec.ts`.
- Anything that needs a logged-in session → a new `*.spec.ts` matched by the
  `authenticated` project's `testMatch` in `playwright.config.ts`
  (currently just `authenticated.spec.ts`; broaden the regex if you split
  further), importing `test`/`expect` from `./fixtures/auth`.
