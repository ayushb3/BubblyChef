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
// AC2 — after signing out, protected routes start a guest session instead
// of redirecting to /login
// ---------------------------------------------------------------------------
//
// This suite runs in a clean (unauthenticated) browser context so it mirrors
// the state immediately after a real sign-out clears all auth cookies.
//
// Historically this asserted a redirect to /login. Issue #382 (closed —
// added guest mode) changed that: the middleware (lib/supabase/middleware.ts
// / auth-routing.ts) now calls Supabase `signInAnonymously()` for an
// unauthenticated visitor on a protected page route instead of bouncing them
// to the login wall, since every RLS policy here is already
// `auth.uid() = user_id` and an anonymous user satisfies that with zero
// other changes. Issue #458 rewrites this test to match: it now asserts the
// visitor stays on the requested route AND that a guest session was
// actually established (a Supabase auth-token cookie appears), rather than
// the old redirect-to-/login expectation which failed 5/5 on main because it
// no longer describes what the app does.
unauthenticatedTest.describe('sign-out / AC2: protected routes start a guest session when unauthenticated', () => {
  // Use a completely empty storage state — no cookies, no localStorage tokens.
  unauthenticatedTest.use({ storageState: { cookies: [], origins: [] } });

  const protectedRoutes = ['/pantry', '/recipes', '/chat', '/profile', '/scan'];

  for (const route of protectedRoutes) {
    unauthenticatedTest(
      `unauthenticated visit to ${route} starts a guest session instead of redirecting to /login`,
      async ({ page }) => {
        await page.goto(route);
        // The Next.js middleware settles the anonymous sign-in and any
        // resulting navigation; allow one full networkidle to finish.
        await page.waitForLoadState('networkidle');

        // No login-wall redirect — the visitor stays on the route they asked for.
        await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
        await expect(page).toHaveURL(new RegExp(`${route}$`));

        // A guest session was actually established, not just "didn't
        // redirect by accident": the middleware's signInAnonymously() call
        // runs server-side and isn't observable via page.route, so the
        // closest available signal from the browser page is the
        // Supabase auth-token cookie it sets.
        const cookies = await page.context().cookies();
        const authCookie = cookies.find((cookie) => /^sb-.*-auth-token/.test(cookie.name));
        expect(authCookie).toBeDefined();
      }
    );
  }
});
