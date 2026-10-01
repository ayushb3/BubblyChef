'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  onResolveSettled,
  undoResolve,
  useDeferredResolves,
} from '@/lib/pantry-undo'
import { titleCase } from '@/lib/format'

interface FailedToast {
  key: number
  name: string
}

const ERROR_MS = 5000

/**
 * The "Used it" undo toast (issue #851). Mounted once in `Providers`, beside the
 * timer dock, so it outlives the row that was tapped and the page that row was
 * on: navigating away does not cancel the write or the undo (`lib/pantry-undo`).
 *
 * Sits above everything a sheet can cover (the storage sheet is where "Used it"
 * is tapped) and above the bottom nav. A write that fails brings the item back
 * and says so here.
 *
 * Keyboard note: an open sheet traps Tab inside itself, so while the storage
 * sheet is up the Undo key is reached by pointer or screen reader; it is the
 * first stop after the sheet closes.
 */
export default function UndoToastHost() {
  const queryClient = useQueryClient()
  const deferred = useDeferredResolves()
  const [failed, setFailed] = useState<FailedToast[]>([])
  const nextKey = useRef(0)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => {
    const pending = timers.current
    const off = onResolveSettled((event) => {
      if (event.ok) {
        // The resolve may have awarded rescue bubbles and the pantry changed.
        void queryClient.invalidateQueries({ queryKey: ['pantry'] })
        void queryClient.invalidateQueries({ queryKey: ['bubbles'] })
        return
      }
      const key = nextKey.current++
      setFailed((prev) => [...prev, { key, name: event.name }])
      pending.push(
        setTimeout(() => setFailed((prev) => prev.filter((f) => f.key !== key)), ERROR_MS),
      )
    })
    return () => {
      off()
      pending.forEach(clearTimeout)
    }
  }, [queryClient])

  const waiting = deferred.filter((d) => !d.committing)
  if (waiting.length === 0 && failed.length === 0) return null

  const toast =
    'pointer-events-auto flex items-center gap-3 rounded-2xl border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] py-1.5 pr-1.5 pl-4 text-sm font-bold text-[color:var(--color-text)] shadow-[2px_2px_0_var(--color-text)]'

  return (
    <div
      className="pointer-events-none fixed right-0 left-0 z-[9980] flex flex-col items-center gap-2 px-3"
      style={{ bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
    >
      {waiting.map((d) => {
        const name = titleCase(d.name)
        return (
          <div key={d.id} role="status" className={toast}>
            <span>{name} marked as used up.</span>
            <button
              type="button"
              onClick={() => undoResolve(d.id)}
              aria-label={`Undo marking ${name} as used up`}
              className="min-h-[44px] min-w-[44px] rounded-full border-2 border-[color:var(--color-text)] bg-[var(--color-primary)] px-4 font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-text)] active:translate-y-px"
            >
              Undo
            </button>
          </div>
        )
      })}
      {failed.map((f) => (
        <div key={f.key} role="status" className={`${toast} py-3 pr-4`}>
          <span>Couldn’t mark {titleCase(f.name)} as used up. It’s back in your pantry.</span>
        </div>
      ))}
    </div>
  )
}
