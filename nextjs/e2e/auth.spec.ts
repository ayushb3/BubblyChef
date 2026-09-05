import { test, expect } from '@playwright/test';

// This suite exercises the login page itself, so it must run WITHOUT the
// pre-authenticated storage state the other specs rely on. Override to a clean
// (unauthenticated) context for every test here.
test.use({ storageState: { cookies: [], origins: [] } });

// Every test below stubs the Supabase signUp response at the network boundary,
// so nothing touches the real project and no throwaway user is created — hence
// no admin cleanup. The password value is arbitrary; the field just has to be
// filled for the form to submit.
const password = 'e2e-testpass-123';

/** Toggle the form from sign-in to sign-up mode via the footer link. */
async function switchToSignUp(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('p', { hasText: "Don't have an account?" })
    .getByRole('button', { name: 'Sign Up' }).click();
}

test.describe('auth / login page', () => {
  test('renders both fields and can toggle to sign-up', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    // The mode toggle lives in the footer paragraph; the submit button is the
    // one inside the form. Scope to the footer to avoid matching the submit.
    await switchToSignUp(page);

    // After toggling, the footer flips to the sign-in prompt.
    await expect(page.getByText('Already have an account?')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// The regression #330 actually fixes — deterministic, no live Supabase needed.
// ---------------------------------------------------------------------------
//
// The bug: signUp only checked the `error` field. With email confirmation ON,
// signUp succeeds with `session: null`; the page pushed to `/`, the auth
// middleware bounced it back to `/login`, and the user saw the login form with
// no message. The fix inspects `data.session` and, when null, stays on the form
// and shows a "check your inbox" banner.
//
// We can't toggle the real project's confirmation setting from a test, so we
// stub the signUp response at the network boundary to force each shape. This is
// the only test that proves the fixed branch, and it can't flake on remote
// config.
test.describe('auth / sign-up session handling (stubbed)', () => {
  test('email-confirmation response (no session) stays on the form and shows the inbox prompt', async ({ page }) => {
    // supabase-js posts signUp to {url}/auth/v1/signup. Return the
    // confirmation-pending shape: a user, but no session/access_token.
    await page.route('**/auth/v1/signup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-0000-0000-000000000000',
          email: 'confirm-me@bubbly-e2e.local',
          role: 'authenticated',
          // No session / access_token — this is what confirmation-required
          // sign-up returns.
          session: null,
        }),
      });
    });

    await page.goto('/login');
    await switchToSignUp(page);
    await page.getByRole('textbox', { name: 'Email' }).fill('confirm-me@bubbly-e2e.local');
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // The fix: no dead redirect. We stay on /login and tell the user to confirm.
    await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
    // The banner must not masquerade as an error.
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test('a returned session does not show the inbox prompt (takes the redirect branch)', async ({ page }) => {
    // Confirmation-OFF shape: signUp returns an access_token + session, so the
    // fix skips the checkEmail branch and calls router.push('/'). We can't
    // assert the dashboard renders — the stub's fake tokens don't mint a session
    // cookie the middleware will accept, so it bounces back to /login. What we
    // *can* assert deterministically is the branch decision: the inbox banner
    // must NOT appear when a session came back. The null-session test above
    // covers the other branch, so together they pin both sides of the `if`.
    await page.route('**/auth/v1/signup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'stub-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'stub-refresh-token',
          user: {
            id: '00000000-0000-0000-0000-000000000001',
            email: 'has-session@bubbly-e2e.local',
            role: 'authenticated',
          },
        }),
      });
    });

    await page.goto('/login');
    await switchToSignUp(page);
    await page.getByRole('textbox', { name: 'Email' }).fill('has-session@bubbly-e2e.local');
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // Give the submit handler time to run its branch, then assert the banner
    // never showed — the session path must not surface the confirmation prompt.
    await page.waitForTimeout(1000);
    await expect(page.getByText(/check your inbox/i)).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Duplicate-registration error handling is real Supabase behaviour, not part of
// this fix, and it's awkward to exercise live: with email confirmation OFF the
// first sign-up logs the user straight in, so a second /login visit is bounced
// to the dashboard by the middleware and the form is never reachable. The
// deterministic stubbed tests above cover both branches of the #330 fix without
// depending on the project's confirmation setting; a live duplicate-signup test
// is deferred rather than shipped flaky.

