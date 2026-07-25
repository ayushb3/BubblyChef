import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Real secrets, when a developer has them locally.
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// The dev server's middleware constructs a Supabase client on *every*
// request (see src/lib/supabase/middleware.ts), so NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY must be non-empty just for the app to boot —
// even for the unauthenticated `smoke` project, which never talks to
// Supabase itself. These are obviously-fake placeholders, safe to commit:
// they are public anon-style values by design, but do not point at any real
// project. Real values from `.env.local` (loaded above) always win.
const PLACEHOLDER_SUPABASE_URL = 'https://placeholder-project.supabase.co';
const PLACEHOLDER_SUPABASE_ANON_KEY = 'placeholder-anon-key-for-e2e-smoke-tests-only';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: './e2e/.report', open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Unauthenticated surface only. No credentials, no global setup, no
    // storageState — must pass on a totally clean checkout with zero secrets.
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // Logs into Supabase and saves storage state for `authenticated` to
    // reuse. Only ever runs as a dependency of the `authenticated` project
    // (never as part of `--project=smoke`), and skips itself gracefully
    // (see e2e/auth.setup.ts) when credentials are absent instead of
    // throwing — so `--project=authenticated` skips cleanly too, rather
    // than failing, when secrets haven't been configured yet.
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
    },

    // Needs a logged-in session. Depends on auth-setup; each spec file
    // additionally guards itself with `test.skip(...)` so it never tries to
    // load the (possibly nonexistent) storageState file when creds are
    // missing.
    {
      name: 'authenticated',
      testMatch: /authenticated\.spec\.ts/,
      dependencies: ['auth-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: './e2e/.auth/user.json',
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_SUPABASE_ANON_KEY,
    },
  },
});
