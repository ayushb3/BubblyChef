/**
 * Global Jest setup for the jsdom test environment.
 *
 * jsdom does not ship a `fetch` implementation, so any production code that
 * calls the bare global `fetch()` throws a `ReferenceError` in a test that
 * hasn't mocked it — not the same failure mode as a real network error.
 * Rather than have individual API clients special-case "am I in a test"
 * (see the removed `typeof fetch === 'undefined'` guards in
 * `lib/api/pantry.ts`/`lib/api/recipes.ts`, #496 review), give every test a
 * default `fetch` that resolves like an unrelated, uninteresting endpoint
 * would — `ok: true` with an empty body. Tests that care about a specific
 * response still set `global.fetch` themselves (nearly all of them already
 * do); this is only a safety net for ones that render a component that
 * fetches without mocking it (e.g. `NotificationBell`, mounted by
 * `BubblesHeader` on most pages, fetching pantry/recipe data a given page
 * test has no reason to care about).
 *
 * Deliberately *not* a rejection: many existing page-level tests render
 * `BubblesHeader` (and therefore `NotificationBell`) incidentally while
 * testing something unrelated, without mocking `/api/pantry`/`/api/recipes`.
 * A rejecting default would put every one of those queries into a real
 * error state during the test, which surfaces as an unhandled-rejection
 * failure unrelated to what the test is actually checking. Tests that
 * specifically want to exercise the error path (see
 * `notification-bell.test.tsx`) set `global.fetch` to return `ok: false`
 * themselves.
 */
if (typeof global.fetch === 'undefined') {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
  ) as unknown as typeof fetch
}
