import { defineConfig, devices } from '@playwright/test';
import { launchOptions } from './e2e/browser';

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
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions,
  },

  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        storageState: './e2e/.auth/user.json',
      },
    },
  ],

  webServer: {
    // Run against a production build, not `next dev`. The dev server's HMR
    // websocket can fail to connect in headless CI/agent runs, which leaves the
    // page only partially hydrated — input onChange binds but some onClick
    // handlers do not — silently flaking any spec that drives a client-side
    // click (e.g. the auth sign-up toggle). `next build && next start` has no
    // HMR socket and hydrates deterministically.
    command: 'npm run build && npm start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
