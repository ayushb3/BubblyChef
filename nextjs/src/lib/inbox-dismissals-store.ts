/**
 * The notification bell's dismissals, kept in this browser (issue #906).
 *
 * A dismissal only hides an entry; it never touches pantry or grocery data. Each
 * record maps an entry id to the fingerprint of the state it was dismissed in
 * (`lib/inbox-helpers.ts`), so a changed state brings the entry back. Keyed by
 * user id, like `lib/grocery-store.ts`, so two accounts in one browser never
 * share dismissals. Every storage access is wrapped in try/catch (private
 * windows, blocked site data, quota): a broken store reads as "nothing
 * dismissed" and writes as a no-op, never a crash.
 */

import type { InboxDismissals } from '@/lib/inbox-helpers'

const PREFIX = 'bubblychef:inbox-dismissed:'
const VERSION = 1
/** A cap so dismissals can never grow the record without bound. */
const MAX_DISMISSALS = 200
/** Fired on `window` after a save in this tab (the native `storage` event only
 *  reaches other tabs). */
const CHANGE_EVENT = 'bubblychef:inbox-dismissed-changed'

export function inboxDismissalsKey(userId: string): string {
  return `${PREFIX}${userId}`
}

/** The raw stored string ('' when none or unreadable). A primitive, so
 *  `useSyncExternalStore` can compare snapshots by value. */
export function readInboxDismissalsRaw(userId: string): string {
  if (!userId || typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(inboxDismissalsKey(userId)) ?? ''
  } catch {
    return ''
  }
}

/** Parse a stored value: `{}` when absent or unreadable; non-string values are dropped. */
export function parseInboxDismissals(raw: string): InboxDismissals {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = (parsed as { dismissed?: unknown }).dismissed
    if (typeof record !== 'object' || record === null || Array.isArray(record)) return {}
    const out: InboxDismissals = {}
    for (const [id, fingerprint] of Object.entries(record)) {
      if (typeof fingerprint === 'string') out[id] = fingerprint
    }
    return out
  } catch {
    return {}
  }
}

export function loadInboxDismissals(userId: string): InboxDismissals {
  return parseInboxDismissals(readInboxDismissalsRaw(userId))
}

/** Persist the record. Returns false (and changes nothing) when it can't. */
export function saveInboxDismissals(userId: string, dismissals: InboxDismissals): boolean {
  if (!userId || typeof window === 'undefined') return false
  const entries = Object.entries(dismissals).slice(-MAX_DISMISSALS)
  try {
    window.localStorage.setItem(
      inboxDismissalsKey(userId),
      JSON.stringify({ v: VERSION, dismissed: Object.fromEntries(entries) }),
    )
  } catch {
    return false
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // A listener threw; the save itself succeeded.
  }
  return true
}

/** Dismiss entries: merge `additions` (id to fingerprint) into the saved record. */
export function addInboxDismissals(userId: string, additions: InboxDismissals): boolean {
  return saveInboxDismissals(userId, { ...loadInboxDismissals(userId), ...additions })
}

/** Call `callback` whenever the record may have changed, in this tab or another. */
export function subscribeInboxDismissals(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) callback()
  }
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}
