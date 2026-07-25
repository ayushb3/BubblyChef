import { test as base, expect } from '@playwright/test';

// Thin re-export point for authenticated specs. storageState itself is
// applied at the project level (see playwright.config.ts's `authenticated`
// project) — this file exists so authenticated specs have one place to add
// shared fixtures later without touching playwright.config.ts.
export const test = base;
export { expect };
