/**
 * "Used it" with an undo (issue #851).
 *
 * One tap on "Used it" used to delete the item on the spot (a resolve writes an
 * event, deletes the row and can award rescue bubbles), with no way back. Now the
 * tap only queues the resolve: the item is hidden at once and the write is held
 * for `UNDO_WINDOW_MS`. Undo inside that window cancels the write, so nothing was
 * ever recorded and the same row is simply visible again, with its id, expiry and
 * history intact. A deferred commit rather than an optimistic delete that is
 * re-created: re-creating would leave a "used" event behind, could not take back a
 * rescue award, and would hand the item a new id.
 *
 * The queue is module state, not component state, so it survives navigating away:
 * the timer keeps running and `UndoToastHost` (mounted once in `Providers`) keeps
 * showing the toast. If the page itself is closing, `pagehide` commits whatever is
 * waiting (the user did use it; only an undo within the window is lost).
 *
 * Consumers: `useDeferredResolves()` for what is hidden or toasted,
 * `onResolveSettled()` for the write landing (so a mounted home re-reads the
 * pantry), `deferResolve` / `undoResolve` to drive it.
 */
import { useSyncExternalStore } from 'react'
import { resolvePantryItem, type ResolveOutcome } from '@/lib/api/pantry'

export const UNDO_WINDOW_MS = 5000

export interface DeferredResolve {
  id: string
  name: string
  outcome: ResolveOutcome
  /** The write is on its way (the undo window is over). The item stays hidden until it lands. */
  committing: boolean
}

export interface ResolveSettled {
  ids: string[]
  name: string
  outcome: ResolveOutcome
  ok: boolean
}

let windowMs = UNDO_WINDOW_MS
let queue: DeferredResolve[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const storeListeners = new Set<() => void>()
const settledListeners = new Set<(event: ResolveSettled) => void>()

function emitStore() {
  storeListeners.forEach((l) => l())
}

function setQueue(next: DeferredResolve[]) {
  queue = next
  emitStore()
}

/** What is queued right now (an immutable snapshot: same array until it changes). */
export function getDeferredResolves(): DeferredResolve[] {
  return queue
}

function subscribe(listener: () => void) {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}

const NONE: DeferredResolve[] = []

export function useDeferredResolves(): DeferredResolve[] {
  return useSyncExternalStore(subscribe, getDeferredResolves, () => NONE)
}

/** Called after each deferred write lands or fails. The item is still hidden while it runs. */
export function onResolveSettled(listener: (event: ResolveSettled) => void): () => void {
  settledListeners.add(listener)
  return () => {
    settledListeners.delete(listener)
  }
}

async function commit(id: string): Promise<void> {
  const entry = queue.find((d) => d.id === id)
  if (!entry || entry.committing) return
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  setQueue(queue.map((d) => (d.id === id ? { ...d, committing: true } : d)))

  let ok = true
  try {
    await resolvePantryItem(id, entry.outcome)
  } catch {
    ok = false
  }
  // Listeners run first, while the item is still hidden: a mounted home drops the
  // row from its own copy, so it never flashes back before the re-read.
  settledListeners.forEach((l) => l({ ids: [id], name: entry.name, outcome: entry.outcome, ok }))
  setQueue(queue.filter((d) => d.id !== id))
}

/** Hide `item` now and write its outcome after the undo window. */
export function deferResolve(item: { id: string; name: string }, outcome: ResolveOutcome): void {
  if (queue.some((d) => d.id === item.id)) return
  setQueue([...queue, { id: item.id, name: item.name, outcome, committing: false }])
  timers.set(
    item.id,
    setTimeout(() => void commit(item.id), windowMs),
  )
}

/** Cancel a queued resolve: nothing is written and the item is visible again. */
export function undoResolve(id: string): void {
  const entry = queue.find((d) => d.id === id)
  // Once the write is on its way there is nothing left to cancel.
  if (!entry || entry.committing) return
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  setQueue(queue.filter((d) => d.id !== id))
}

/** Commit everything waiting now (the page is closing). */
export async function flushDeferredResolves(): Promise<void> {
  await Promise.all(queue.filter((d) => !d.committing).map((d) => commit(d.id)))
}

/** Test seam: a shorter undo window, for tests that run through real timers. */
export function setUndoWindowMsForTests(ms: number): void {
  windowMs = ms
}

/** Test seam: forget everything, timers included, and restore the real window. */
export function resetDeferredResolvesForTests(): void {
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
  windowMs = UNDO_WINDOW_MS
  queue = []
  storeListeners.clear()
  settledListeners.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushDeferredResolves())
}
