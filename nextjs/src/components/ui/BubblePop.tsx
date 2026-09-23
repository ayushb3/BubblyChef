'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useBubbles } from '@/lib/api/bubbles'

interface Pop {
  key: number
  delta: number
}

/**
 * Fixed-position "🫧 +N" pop, fired whenever the bubbles balance increases
 * (issue #525). Shares the `['bubbles']` query cache with every other
 * `useBubbles()` consumer — mounted once in `Providers` so it sees every
 * balance change regardless of which page triggered it.
 *
 * Deliberately silent on:
 *  - the first observation (balance goes from unknown to a number) — that's
 *    just the initial load, not an award;
 *  - an equal or lower balance — nothing to celebrate.
 *
 * Mounted once in `Providers`, so it outlives sign-out → sign-in in the same
 * tab. Not fetched at all on `/login`, where there's no session to read a
 * balance for. `SignOutButton` clears the whole React Query cache on
 * sign-out, which drops `data` back to `undefined`; the effect below treats
 * that as "unknown" and resets `lastSeenRef`, so the next user's first
 * balance is always treated as an initial load rather than a delta off the
 * previous user's leftover number (issue #525 review).
 */
export default function BubblePop() {
  const pathname = usePathname()
  const { data } = useBubbles({ enabled: pathname !== '/login' })
  const balance = data?.balance
  const lastSeenRef = useRef<number | null>(null)
  const [pop, setPop] = useState<Pop | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefersReducedMotion = useReducedMotion() ?? false

  useEffect(() => {
    if (typeof balance !== 'number') {
      // Balance went from known back to unknown — most commonly a sign-out
      // clearing the query cache. Reset so the next observation (the next
      // user's balance) is treated as an initial load, not a delta.
      lastSeenRef.current = null
      return
    }
    const lastSeen = lastSeenRef.current
    if (lastSeen !== null && balance > lastSeen) {
      const delta = balance - lastSeen
      setPop({ key: Date.now(), delta })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setPop(null), prefersReducedMotion ? 800 : 1000)
    }
    lastSeenRef.current = balance
  }, [balance, prefersReducedMotion])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: '16%',
        left: '50%',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {pop && (
          <motion.span
            key={pop.key}
            data-testid="bubble-pop"
            initial={{ opacity: 0, y: 0, x: '-50%' }}
            animate={
              prefersReducedMotion
                ? { opacity: [0, 1, 1, 0], x: '-50%' }
                : { opacity: [0, 1, 1, 0], y: -40, x: '-50%' }
            }
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.8 : 1, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              whiteSpace: 'nowrap',
              fontWeight: 800,
              fontSize: 18,
              color: 'var(--color-primary-dark)',
              fontFamily: 'Nunito, sans-serif',
            }}
          >
            🫧 +{pop.delta}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
