import { chromium, FullConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';
import { launchOptions } from './browser';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const authFile = path.join(__dirname, '.auth/user.json');

async function globalSetup(config: FullConfig) {
  // Derived from the same baseURL playwright.config.ts computes (PLAYWRIGHT_BASE_URL,
  // or 127.0.0.1:PORT) rather than a hardcoded host/port — a mismatch here is a
  // silent auth failure, not a loud one: the cookie gets set for the wrong host,
  // the browser never sends it, and every test looks like it's not signed in.
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error('No baseURL resolved from playwright.config.ts — cannot set the auth cookie domain.');
  }
  const target = new URL(baseURL);
  // Cookies are set without a port; only the hostname matters for `domain`.
  const cookieDomain = target.hostname;

  const email = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!email || !password) {
    throw new Error(
      'Missing TEST_USERNAME or TEST_PASSWORD in nextjs/.env.local'
    );
  }
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in nextjs/.env.local'
    );
  }

  // Authenticate via Supabase REST API
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
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
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = JSON.stringify(session);

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();

  // Set the auth cookie before navigating
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: cookieDomain,
      path: '/',
      httpOnly: false,
      secure: target.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);

  // Verify we land on home (not redirected back to login)
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.waitForLoadState('networkidle');

  const finalUrl = page.url();
  if (finalUrl.includes('/login')) {
    throw new Error(
      `Auth setup failed — redirected to login. Cookie "${cookieName}" was not recognized by middleware.`
    );
  }

  await context.storageState({ path: authFile });
  await browser.close();
}

export default globalSetup;
