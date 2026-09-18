import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, devices } from '@playwright/test';
import { launchOptions } from './e2e/browser';

// ---------------------------------------------------------------------------
// Environment contract (docs/plans/2026-09-17-autonomous-agent-loop.md step 5)
//
// - PLAYWRIGHT_BASE_URL — if set, tests run against it directly (e.g. a
//   deployed production URL) and this config does NOT start a local
//   webServer. This is how the post-merge smoke run targets production.
//   AI_SERVICE_URL must then be set explicitly too — see the check below.
// - Otherwise, a local production build is started: `next build && next
//   start` on port PORT (default 3000), plus the ai-service on AI_PORT
//   (default 8888), with NEXT_PUBLIC_AI_SERVICE_URL pointed at that AI port
//   so the client bundle (built with that env baked in) talks to the right
//   place.
// - AI_SERVICE_URL — base URL used by tests/health checks to reach the
//   ai-service directly; defaults to http://127.0.0.1:${AI_PORT} only in
//   local-server mode.
//
// Host is always 127.0.0.1, never localhost: e2e/global-setup.ts sets the
// Supabase auth cookie with an explicit `domain`, and browsers do not share
// cookies between 127.0.0.1 and localhost. Mixing the two silently breaks
// sign-in. baseURL and the webServer's own url must match exactly, or
// `reuseExistingServer` can attach to an unrelated process on the same
// default port and report green against code that was never started here.
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || '3000';
const AI_PORT = process.env.AI_PORT || '8888';
const HOST = '127.0.0.1';

// Only start local servers when no external target was given.
const useLocalServers = !process.env.PLAYWRIGHT_BASE_URL;

if (!useLocalServers && !process.env.AI_SERVICE_URL) {
  // Defaulting here would be a silent lie in exactly the mode this suite
  // exists for: pointed at a deployed frontend with no AI_SERVICE_URL, the
  // ai-service health test would fall back to a local 127.0.0.1:8888 —
  // either a stray local process (false green, unrelated server) or nothing
  // at all (false revert). Fail fast instead of guessing.
  throw new Error(
    'PLAYWRIGHT_BASE_URL is set but AI_SERVICE_URL is not. When targeting an ' +
      "external deploy, AI_SERVICE_URL must be set explicitly to that deploy's " +
      'ai-service URL — it will not be inferred or defaulted.',
  );
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://${HOST}:${PORT}`;
const aiServiceUrl = process.env.AI_SERVICE_URL || `http://${HOST}:${AI_PORT}`;

// Current commit SHA, injected into both local servers so the smoke suite's
// health checks can assert a real deployed-looking SHA rather than the
// health endpoints' own "unknown" fallback (which would pass even if the
// deploy pipeline never set one).
function currentGitSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    return '';
  }
}
const gitSha = useLocalServers ? currentGitSha() : '';

const authState = './e2e/.auth/user.json';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: './e2e/.report', open: 'never' }]],

  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions,
  },

  projects: [
    {
      name: 'chromium-mobile',
      // The smoke suite makes a real Gemini call and writes to the shared,
      // hosted-Supabase test account on every run — unlike every other live
      // test in this repo, which is opt-in via an env flag. It must not run
      // as part of the default `npm run test:e2e` sweep. Excluding it here
      // (rather than gating behind an env var) means `npx playwright test
      // e2e/smoke` still works with zero extra env vars, per the verify
      // skill's contract — it explicitly names the path, which only the
      // 'smoke' project below actually matches.
      testIgnore: ['**/smoke/**'],
      use: {
        ...devices['Pixel 5'],
        storageState: authState,
      },
    },
    {
      name: 'smoke',
      testDir: './e2e/smoke',
      use: {
        ...devices['Pixel 5'],
        storageState: authState,
      },
    },
  ],

  ...(useLocalServers
    ? {
        webServer: [
          {
            // ai-service, production-mode uvicorn (no --reload). Started
            // first so the Next.js build below can bake NEXT_PUBLIC_AI_SERVICE_URL
            // in at build time — that env is inlined into the client bundle,
            // not read at runtime, so it must be correct before `next build` runs.
            // `python -m uvicorn`, not a bare `uvicorn`, so this works whether or
            // not the venv's Scripts/bin directory is on PATH.
            command: `python -m uvicorn bubbly_chef.main:app --host ${HOST} --port ${AI_PORT}`,
            cwd: path.resolve(__dirname, '../ai-service'),
            url: `${aiServiceUrl}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            env: {
              // Allow the exact Next.js origin the browser will actually send —
              // the ai-service's .env default only lists localhost origins, and
              // this suite deliberately uses 127.0.0.1 (see host note above).
              BUBBLY_CORS_ORIGINS: JSON.stringify([`http://${HOST}:${PORT}`, 'http://localhost:3000']),
              BUBBLY_GIT_SHA: gitSha,
            },
          },
          {
            // Run against a production build, not `next dev`. The dev server's HMR
            // websocket can fail to connect in headless CI/agent runs, which leaves the
            // page only partially hydrated — input onChange binds but some onClick
            // handlers do not — silently flaking any spec that drives a client-side
            // click (e.g. the auth sign-up toggle). `next build && next start` has no
            // HMR socket and hydrates deterministically.
            command: `npm run build && npm start -- -p ${PORT} -H ${HOST}`,
            url: baseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
            env: {
              PORT,
              NEXT_PUBLIC_AI_SERVICE_URL: aiServiceUrl,
              // Read at `next build` time (NEXT_PUBLIC_* is inlined into the
              // client bundle, not read at runtime) — must be set before the
              // build half of the command above runs, not just the start half.
              NEXT_PUBLIC_GIT_SHA: gitSha,
            },
          },
        ],
      }
    : {}),
});
