import { test as signedIn, expect } from './fixtures/auth';
import { test as anonymous } from '@playwright/test';

// The auth layer is `src/proxy.ts` (the Next.js `proxy` file convention,
// formerly `middleware.ts`, issue #337), delegating to
// `lib/supabase/middleware.ts#updateSession`. It is the only thing gating page
// routes, and it fails open if Next ever stops running it — so this pins its
// observable contract at the HTTP level, where a file that silently stops being
// picked up shows as a wrong status code rather than a passing unit test.
//
// Requests are made with `maxRedirects: 0` so the redirect itself is asserted,
// not wherever it ends up. Unauthenticated *page* visits are deliberately not
// repeated here: sign-out.spec.ts (AC2) already covers that they start a guest
// session, and each one mints a real anonymous user in the hosted project.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : '';
const authCookieName = `sb-${projectRef}-auth-token`;

anonymous.describe('route protection / unauthenticated', () => {
  anonymous.use({ storageState: { cookies: [], origins: [] } });

  anonymous('an API route still answers 401 (and does not mint a guest session)', async ({ request }) => {
    const res = await request.get('/api/pantry', { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(res.headers()['set-cookie'] ?? '').not.toContain('auth-token');
  });

  anonymous('/login is public: served, no redirect, no guest session', async ({ request }) => {
    const res = await request.get('/login', { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()['set-cookie'] ?? '').not.toContain('auth-token');
  });
});

signedIn.describe('route protection / signed in', () => {
  signedIn('a signed-in user hitting /login is redirected home', async ({ request }) => {
    const res = await request.get('/login', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(new URL(res.headers()['location'], 'http://x').pathname).toBe('/');
  });

  signedIn('a signed-in user reaches a protected page and API with no redirect', async ({ request }) => {
    const page = await request.get('/pantry', { maxRedirects: 0 });
    expect(page.status()).toBe(200);
    const api = await request.get('/api/pantry', { maxRedirects: 0 });
    expect(api.status()).toBe(200);
  });

  signedIn('an expired access token is refreshed and the session cookie re-set', async ({ playwright, baseURL }) => {
    signedIn.skip(!supabaseUrl || !supabaseKey || !process.env.TEST_USERNAME, 'needs Supabase + test user env');

    // A session of its own, not the shared storage state: refreshing rotates the
    // refresh token, and doing that to the shared one would invalidate the
    // cookie every other spec is using.
    const login = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey! },
      body: JSON.stringify({ email: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD }),
    });
    expect(login.ok).toBe(true);
    const session = await login.json();
    const stale = { ...session, expires_at: Math.floor(Date.now() / 1000) - 3600 };
    const cookie = `${authCookieName}=base64-${Buffer.from(JSON.stringify(stale)).toString('base64url')}`;

    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } });
    try {
      const res = await ctx.get('/pantry', { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      const setCookies = res
        .headersArray()
        .filter((h) => h.name.toLowerCase() === 'set-cookie')
        .map((h) => h.value);
      expect(setCookies.some((c) => c.startsWith(authCookieName) && !/Max-Age=0/i.test(c))).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });
});
