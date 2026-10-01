/**
 * "A cook session just changed" for the tab that changed it (issue #837).
 *
 * The cook sessions live in `localStorage` (`cook-session.ts`,
 * `meal-cook-session.ts`), and the browser's `storage` event only reaches OTHER
 * tabs: the tab that writes never hears it. So the kitchen scene (Bubbles at the
 * stove, the steam) and the Bubbles card, which both read those sessions, never
 * learned in the same tab that a cook had started or ended, and stayed on the
 * stale answer until a reload.
 *
 * Both session modules call `notifyCookSessionChanged` after every write to their
 * records, which covers every start and every end path (finish, abandon, mark
 * cooked, skip the pantry update) in one place. Readers subscribe with
 * `subscribeCookSessionChanges`, which also keeps the cross-tab events.
 */

export const COOK_SESSION_CHANGED_EVENT = 'bubblychef:cook-session-changed'

/** Tell this tab's readers that a cook session record was written. Safe on the server. */
export function notifyCookSessionChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(COOK_SESSION_CHANGED_EVENT))
}

/**
 * Call `onChange` whenever a cook session may have changed: in this tab (the
 * event above), in another tab (`storage`), or while this tab was hidden and may
 * have missed either (`focus`, `visibilitychange`). Returns the unsubscribe.
 */
export function subscribeCookSessionChanges(onChange: () => void): () => void {
  window.addEventListener(COOK_SESSION_CHANGED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  window.addEventListener('focus', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    window.removeEventListener(COOK_SESSION_CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
    window.removeEventListener('focus', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}
