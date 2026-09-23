import { test as base, expect } from '@playwright/test';
import path from 'path';

/**
 * Signed-in fixture for the shared e2e test user.
 *
 * The first-run coach-mark tour (issue #390) auto-opens on `/` for any user
 * whose `user_metadata.onboarding_completed` isn't true, and its full-screen
 * backdrop swallows every click. The shared test user lives in the hosted
 * Supabase project (which is production), so we must not write that flag to
 * it. Instead, every signed-in test sees the flag as already set: the client's
 * `GET /auth/v1/user` response is patched in flight. Nothing is written; PUTs
 * (e.g. display-name edits) pass through untouched.
 *
 * A spec that needs a different answer (e.g. onboarding.spec's TC5) registers
 * its own `page.route` for the same URL; Playwright runs the most recently
 * registered handler first, so the spec's stub wins.
 */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.route('**/auth/v1/user**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        await route.fulfill({ response });
        return;
      }
      if (body && typeof body === 'object' && 'id' in body) {
        const user = body as { user_metadata?: Record<string, unknown> };
        user.user_metadata = { ...(user.user_metadata ?? {}), onboarding_completed: true };
      }
      await route.fulfill({ response, json: body });
    });
    await provide(page);
  },
});
export { expect };

test.use({ storageState: path.join(__dirname, '../.auth/user.json') });
