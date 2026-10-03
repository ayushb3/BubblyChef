/**
 * "The pantry changed" (issue #916).
 *
 * Most screens read the pantry through React Query, so a write marks `['pantry']`
 * stale. The kitchen home keeps its own copy of the pantry in component state, so
 * an invalidation alone never reaches it and the Bubbles card kept reporting the
 * old count (an empty kitchen after the first-run stocking). A writer that is not
 * the home itself calls `notifyPantryChanged`: it does the invalidation and tells
 * the home to read again.
 */
import type { QueryClient } from '@tanstack/react-query'

type Listener = () => void
const listeners = new Set<Listener>()

/** Called when a pantry write lands elsewhere. Returns the unsubscribe. */
export function onPantryChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyPantryChanged(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['pantry'] })
  for (const listener of Array.from(listeners)) listener()
}
