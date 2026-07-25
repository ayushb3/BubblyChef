import { test as setup } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const authFile = path.join(__dirname, '.auth/user.json');

const email = process.env.TEST_USERNAME;
const password = process.env.TEST_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const hasCredentials = Boolean(email && password && supabaseUrl && supabaseKey);

// Runs as the `auth-setup` project — only ever pulled in as a dependency of
// the `authenticated` project (`--project=smoke` never reaches this file).
//
// Skipping (via `setup.skip` at describe-scope, evaluated before any fixture
// is touched) rather than throwing is deliberate: this makes
// `--project=authenticated` skip cleanly when secrets are absent instead of
// erroring out. A plain `throw` here would still fail the CI job even though
// nothing genuinely broke — there just isn't a test account configured yet.
setup.describe('authenticate', () => {
  setup.skip(
    !hasCredentials,
    'Authenticated e2e suite requires TEST_USERNAME, TEST_PASSWORD, ' +
      'NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY in ' +
      'nextjs/.env.local — skipping (see nextjs/e2e/README.md).'
  );

  setup('login via supabase and save storage state', async ({ page }) => {
    // Authenticate via Supabase REST API
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey!,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase login failed (${res.status}): ${body}`);
    }

    const session = await res.json();

    // @supabase/ssr stores session in a cookie named sb-<project-ref>-auth-token
    // The value is the raw JSON string of the session
    const projectRef = new URL(supabaseUrl!).hostname.split('.')[0];
    const cookieName = `sb-${projectRef}-auth-token`;
    const cookieValue = JSON.stringify(session);

    await page.context().addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // Verify we land on home (not redirected back to login)
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    if (page.url().includes('/login')) {
      throw new Error(
        `Auth setup failed — redirected to login. Cookie "${cookieName}" was not recognized by middleware.`
      );
    }

    await page.context().storageState({ path: authFile });
  });
});
