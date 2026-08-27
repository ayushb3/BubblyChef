/**
 * Resolves launch options shared by `playwright.config.ts` and `global-setup.ts`.
 *
 * Containerised environments often ship a pre-baked Chromium whose revision does
 * not match the one this Playwright version expects, and re-downloading browsers
 * is either blocked or wasteful. Setting `PLAYWRIGHT_CHROMIUM_PATH` points both
 * the test runner and the auth bootstrap at that existing binary. Unset — the
 * normal case locally and in CI — this is a no-op and Playwright resolves its own
 * managed browser as usual.
 */
export const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};
