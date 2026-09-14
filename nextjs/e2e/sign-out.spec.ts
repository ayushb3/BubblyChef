// sign-out.spec.ts — e2e coverage for issue #331
//
// Auth setup assumed:
//   global-setup.ts authenticates via the Supabase REST API using TEST_USERNAME /
//   TEST_PASSWORD from nextjs/.env.local, then writes a storageState file to
//   e2e/.auth/user.json. The `test` fixture from fixtures/auth.ts applies that
//   storageState, so every test in the signed-in describe below starts as an
//   authenticated user.
//
// TODO: AC3 ("sign in as a different account shows that account's data") is
//   intentionally skipped. The harness only provisions a single test account.
//   Covering AC3 would require a second TEST_USERNAME_2 / TEST_PASSWORD_2 pair
//   in .env.local and a matching second storageState file written by global-setup.
//   Leave this as a follow-up once multi-account support lands in the test infra.

import { test as authenticatedTest, expect } from './fixtures/auth';
import { test as unauthenticatedTest } from '@playwright/test';

// ---------------------------------------------------------------------------
// AC1 — signed-in user can sign out
// ---------------------------------------------------------------------------
authenticatedTest.describe('sign-out / AC1: sign out flow', () => {
  authenticatedTest(
    'clicking Sign out on /profile redirects to /login',
    async ({ page }) => {
      // Navigate to /profile via the profile icon in the home header
      // (ProfileHeaderButton, aria-label "Profile", links to /profile).
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // The profile header icon must be present.
      const profileNavLink = page.getByRole('link', { name: 'Profile' });
      await expect(profileNavLink).toBeVisible();
      await profileNavLink.click();
      await expect(page).toHaveURL(/\/profile/);

      // The Sign out button is rendered by components/auth/SignOutButton.tsx.
      // It is a SpringButton whose visible text is "Sign out".
      const signOutButton = page.getByRole('button', { name: /sign out/i });
      await expect(signOutButton).toBeVisible();

      // Stub the Supabase signOut REST call so the test is deterministic and
      // does not depend on real session revocation. supabase-js POST-s to
      // /auth/v1/logout to sign out; return 204 (success, no body).
      await page.route('**/auth/v1/logout**', async (route) => {
        await route.fulfill({ status: 204, body: '' });
      });

      await signOutButton.click();

      // After sign-out the component calls router.push('/login').
      // Allow up to 10 s for the client-side navigation to complete.
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    }
  );
});

// ---------------------------------------------------------------------------
// AC2 — after signing out, protected routes redirect back to /login
// ---------------------------------------------------------------------------
//
// This suite runs in a clean (unauthenticated) browser context so it mirrors
// the state immediately after a real sign-out clears all auth cookies.
unauthenticatedTest.describe('sign-out / AC2: protected routes redirect when unauthenticated', () => {
  // Use a completely empty storage state — no cookies, no localStorage tokens.
  unauthenticatedTest.use({ storageState: { cookies: [], origins: [] } });

  const protectedRoutes = ['/pantry', '/recipes', '/chat', '/profile', '/scan'];

  for (const route of protectedRoutes) {
    unauthenticatedTest(
      `unauthenticated visit to ${route} redirects to /login`,
      async ({ page }) => {
        await page.goto(route);
        // The Next.js middleware (middleware.ts) redirects unauthenticated
        // requests; allow one full navigation + networkidle to settle.
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
      }
    );
  }
});
