/**
 * "Seen" bookkeeping for the kitchen theme unlock toast (issue #523).
 *
 * The toast ("New kitchen theme: Night kitchen 🌙 · Try it") is meant to
 * show exactly once per theme, the first time a browser notices the balance
 * has crossed that theme's threshold. There's no server-side flag for this
 * (unlocks are derived from the balance, not stored — see `themes.ts`), so
 * "seen" lives in `localStorage`, same idiom as `ThemeProvider`'s palette
 * choice. Every call is wrapped in try/catch: `localStorage` can throw in
 * private-browsing/storage-disabled contexts, and losing this state only
 * means the toast shows again later, never a crash.
 */

const STORAGE_KEY = 'bubbly-kitchen-themes-seen'

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** Whether the unlock toast has already been shown for this theme key on this browser. */
export function hasSeenThemeUnlock(key: string): boolean {
  return readSeen().includes(key)
}

/** Marks a theme's unlock toast as shown, so it won't be offered again on this browser. */
export function markThemeUnlockSeen(key: string): void {
  try {
    const seen = readSeen()
    if (seen.includes(key)) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen, key]))
  } catch {
    // Storage unavailable — the toast may reshow later. Not a crash.
  }
}
