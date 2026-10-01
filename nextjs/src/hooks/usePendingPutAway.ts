'use client'

/**
 * The pending put-away (issue #753), live: the record `lib/kitchen/pending-putaway.ts`
 * keeps in local storage, as React state.
 *
 * A `useSyncExternalStore`, so it is `null` on the server and the first client
 * render and then the real answer, with no hydration mismatch. It follows every
 * change: a write or clear in this tab (the module announces them on `window`),
 * another tab (`storage`), and a tab brought back to the front.
 *
 * The parsed record is cached against the raw stored string, so the snapshot is
 * referentially stable between changes (React compares it by identity).
 */
import { useSyncExternalStore } from 'react'
import {
  PENDING_PUTAWAY_EVENT,
  PENDING_PUTAWAY_KEY,
  parsePendingPutAway,
  readPendingRaw,
  type PendingPutAway,
} from '@/lib/kitchen/pending-putaway'

let cachedRaw: string | null = null
let cachedRecord: PendingPutAway | null = null

function getSnapshot(): PendingPutAway | null {
  const raw = readPendingRaw()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedRecord = parsePendingPutAway(raw)
  }
  return cachedRecord
}

function getServerSnapshot(): PendingPutAway | null {
  return null
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    // `key` is null when storage was cleared wholesale.
    if (e.key === null || e.key === PENDING_PUTAWAY_KEY) onChange()
  }
  window.addEventListener(PENDING_PUTAWAY_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  window.addEventListener('focus', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    window.removeEventListener(PENDING_PUTAWAY_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('focus', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

export function usePendingPutAway(): PendingPutAway | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
