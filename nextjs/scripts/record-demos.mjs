/**
 * Records the demo videos in `demos/` by driving the real app.
 *
 * These recordings exist so a reviewer can see that a flow actually works
 * end-to-end. That only holds if they are cheap to regenerate, so this replaces
 * the previous hand-driven `playwright-cli` process with something re-runnable.
 *
 *   # both servers up first: Next.js on 3000, ai-service on 8888
 *   node scripts/record-demos.mjs                # record every flow
 *   node scripts/record-demos.mjs theme expiry   # record a subset
 *
 * Auth reuses `e2e/.auth/user.json`, the storage state written by the Playwright
 * global setup — run `npx playwright test e2e/smoke.spec.ts` once to create it.
 * Keeping a single source of truth for login means the demos authenticate the
 * same way the tests do.
 *
 * In a container whose bundled Chromium does not match this Playwright version,
 * set PLAYWRIGHT_CHROMIUM_PATH (see e2e/browser.ts).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEMOS_DIR = path.join(REPO_ROOT, 'demos');
const AUTH_FILE = path.join(__dirname, '../e2e/.auth/user.json');
const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3000';

// iPhone-ish portrait. Matches the app's mobile-first max-width of 480px, and is
// what the existing recordings in demos/ were captured at.
const VIEWPORT = { width: 430, height: 932 };

/** Pacing. Demo videos are watched by humans, so steps need to breathe. */
const BEAT = 900;
const beat = (page, n = 1) => page.waitForTimeout(BEAT * n);

/**
 * Scrolls in small increments rather than jumping, so the recording shows the
 * content moving instead of teleporting.
 */
async function smoothScroll(page, distance, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, distance / steps);
    await page.waitForTimeout(90);
  }
}

const flows = [
  {
    name: '01-auth-dashboard',
    key: 'auth',
    title: 'Auth → dashboard',
    async run(page) {
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await beat(page, 3);
      await smoothScroll(page, 500);
      await beat(page, 2);
      await smoothScroll(page, -500);
      await beat(page);
    },
  },
  {
    name: '02-cook-pantry-match',
    key: 'cook',
    title: 'Cook → pantry ingredient match',
    async run(page) {
      await page.goto(`${BASE_URL}/recipes`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await beat(page, 2);

      await page.getByRole('button', { name: 'Cook this recipe' }).click();

      // "Checking your pantry..." resolves via an LLM-backed match against every
      // pantry row, which routinely takes well over 15s on a large pantry — hence
      // the generous wait rather than a default timeout.
      const confirm = page.getByRole('button', { name: /yes, i cooked this/i });
      await confirm.waitFor({ state: 'visible', timeout: 60_000 });
      await beat(page, 2);

      // The resolved match table is the substance of this flow: which ingredients
      // are ready, which hit a unit conflict, which are missing entirely.
      await smoothScroll(page, 400);
      await beat(page, 3);

      // Deliberately Cancel rather than confirm. "Yes, I cooked this" deducts real
      // quantities from the live pantry, so confirming here would make every
      // re-record destroy stock. The matching — the part worth demonstrating —
      // has already happened by this point.
      await page.getByRole('button', { name: 'Cancel' }).click();
      await beat(page, 2);
    },
  },
  {
    name: '03-recipe-library',
    key: 'recipes',
    title: 'Recipe library',
    async run(page) {
      await page.goto(`${BASE_URL}/recipes`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await beat(page, 2);

      const search = page.getByPlaceholder(/search your recipes/i);
      await search.click();
      await search.pressSequentially('salmon', { delay: 160 });
      await beat(page, 3);
      await search.fill('');
      await beat(page, 2);

      // Page-turn navigation between recipes.
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: 'Next recipe' }).click();
        await beat(page, 2);
      }

      await page.getByRole('button', { name: 'Favorite' }).click();
      await beat(page, 2);
      await smoothScroll(page, 600);
      await beat(page, 2);
    },
  },
  {
    name: '04-pantry-tip-chat',
    key: 'pantry',
    title: 'Pantry + tip → chat',
    async run(page) {
      await page.goto(`${BASE_URL}/pantry`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await beat(page, 2);

      // Location filters — the pantry's primary way of narrowing a long list.
      for (const loc of ['Fridge', 'Pantry', 'All Items']) {
        await page.getByRole('button', { name: loc, exact: true }).click();
        await beat(page, 2);
      }

      await smoothScroll(page, 700);
      await beat(page, 2);

      // The dashboard tip card seeds a chat with an auto-asked prompt.
      await page.goto(`${BASE_URL}/`);
      await beat(page, 2);
      await page.getByRole('link', { name: /ask bubbles about today's tip/i }).click();
      await page.waitForURL(/\/chat/, { timeout: 20_000 });

      // Wait out the streamed answer rather than guessing a beat. Track "Stop",
      // not "Send": a disabled "Send" is already on screen before the auto-asked
      // prompt fires, so waiting for it to appear returns immediately and the
      // recording cuts away on the typing indicator. "Stop" exists only while a
      // response is streaming, so appear-then-detach brackets the real reply.
      const stop = page.getByRole('button', { name: 'Stop' });
      await stop.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      await stop.waitFor({ state: 'detached', timeout: 90_000 }).catch(() => {});
      await beat(page, 3);
      await smoothScroll(page, 400);
      await beat(page, 2);
    },
  },
  {
    name: '05-theme-switch',
    key: 'theme',
    title: 'Theme switch',
    async run(page) {
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await beat(page, 2);

      // The picker is a dropdown, not a cycle button: it has to be reopened before
      // each pick, otherwise the clicks just toggle the menu and the palette never
      // changes. Ending on Sakura leaves the account on the theme it started on,
      // so re-recording doesn't quietly change the look of the other demos.
      for (const theme of ['mint', 'lavender', 'yuzu', 'bluebell', 'sakura']) {
        await page.getByRole('button', { name: /change theme/i }).click();
        await beat(page);
        // Each option's accessible name comes from its aria-label ("Switch to mint
        // theme"), not the visible palette name.
        await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
        await beat(page, 2);
      }
    },
  },
  {
    name: '06-expiry-loop',
    key: 'expiry',
    title: 'Expiry loop',
    async run(page) {
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await beat(page, 3);

      await page.getByRole('link', { name: /use soon/i }).click();
      await page.waitForURL(/\/pantry/, { timeout: 20_000 });
      await beat(page, 2);

      // Expiry badges and the "Cook this" affordance on urgent items.
      await smoothScroll(page, 900, 18);
      await beat(page, 2);
      await smoothScroll(page, 900, 18);
      await beat(page, 2);
    },
  },
];

async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(
      `Missing auth state at ${AUTH_FILE}\n` +
        'Run `npx playwright test e2e/smoke.spec.ts` once to create it.'
    );
    process.exit(1);
  }

  const requested = process.argv.slice(2);
  const selected = requested.length
    ? flows.filter((f) => requested.includes(f.key) || requested.includes(f.name))
    : flows;

  if (!selected.length) {
    console.error(`No flows matched. Available: ${flows.map((f) => f.key).join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(DEMOS_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });

  const failures = [];

  for (const flow of selected) {
    // Playwright names videos itself, so each flow gets its own temp directory
    // and the single file inside it is renamed to the stable demo filename.
    const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.demo-rec-'));
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      recordVideo: { dir: tmpDir, size: VIEWPORT },
    });
    const page = await context.newPage();

    let failed = null;
    try {
      process.stdout.write(`▶ ${flow.name} — ${flow.title}\n`);
      await flow.run(page);
    } catch (err) {
      failed = err;
    }

    const video = page.video();
    await context.close(); // flushes the video file to disk

    if (failed) {
      failures.push({ flow: flow.name, error: failed });
      console.error(`  ✗ ${flow.name}: ${failed.message.split('\n')[0]}`);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      continue;
    }

    const dest = path.join(DEMOS_DIR, `${flow.name}.webm`);
    await video.saveAs(dest);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const kb = Math.round(fs.statSync(dest).size / 1024);
    console.log(`  ✓ ${path.relative(REPO_ROOT, dest)} (${kb} KB)`);
  }

  await browser.close();

  if (failures.length) {
    console.error(`\n${failures.length} flow(s) failed; their videos were discarded.`);
    process.exit(1);
  }
}

await main();
