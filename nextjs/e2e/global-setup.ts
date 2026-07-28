import { chromium, FullConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const authFile = path.join(__dirname, '.auth/user.json');

async function globalSetup(_config: FullConfig) {
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

  const browser = await chromium.launch();
  const context = await browser.newContext();

  // Set the auth cookie before navigating
  await context.addCookies([
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
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3000/');
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
