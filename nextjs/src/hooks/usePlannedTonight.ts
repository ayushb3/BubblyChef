'use client'

/**
 * Tonight's planned meal (issue #755), live: the record `lib/kitchen/planned-tonight.ts`
 * keeps in local storage, as React state.
 *
 * A `useSyncExternalStore` like `usePendingPutAway`: `null` on the server and the
 * first client render, then the real answer with no hydration mismatch, following
 * every write or clear in this tab (the module announces them on `window`),
 * another tab (`storage`) and a tab brought back to the front. The parsed record
 * is cached against the raw stored string so the snapshot is referentially stable
 * between changes.
 */
import { useSyncExternalStore } from 'react'
import {
  PLANNED_TONIGHT_EVENT,
  PLANNED_TONIGHT_KEY,
  parsePlannedTonight,
  readPlannedRaw,
  type PlannedTonight,
} from '@/lib/kitchen/planned-tonight'

let cachedRaw: string | null = null
let cachedRecord: PlannedTonight | null = null

function getSnapshot(): PlannedTonight | null {
  const raw = readPlannedRaw()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedRecord = parsePlannedTonight(raw)
  }
  return cachedRecord
}

function getServerSnapshot(): PlannedTonight | null {
  return null
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PLANNED_TONIGHT_KEY) onChange()
  }
  window.addEventListener(PLANNED_TONIGHT_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  window.addEventListener('focus', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    window.removeEventListener(PLANNED_TONIGHT_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('focus', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

export function usePlannedTonight(): PlannedTonight | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
