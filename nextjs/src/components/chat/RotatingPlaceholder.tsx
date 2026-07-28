'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

const PROMPTS = [
  'What can I make for dinner?',
  'How do I poach an egg?',
  'Give me a 30-min weeknight meal',
  'How do I caramelize onions?',
  'What should I cook tonight?',
  'Something ready in 15 minutes',
  'Teach me a Thai curry',
  'Surprise me with something new!',
  "What's a good use for leftover rice?",
  'Help me plan meals for the week',
]

const INTERVAL_MS = 4000

// `prefers-reduced-motion` is a browser API with no server-side equivalent, so
// SSR always sees "not reduced" (getServerSnapshot). useSyncExternalStore is
// the React-sanctioned way to read + subscribe to this kind of external
// store: it renders the server snapshot on the first client pass (matching
// hydration) and re-renders with the real client value right after, with no
// `setState` call inside an effect body.
function subscribeReducedMotion(callback: () => void): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getReducedMotionServerSnapshot(): boolean {
  return false
}

interface RotatingPlaceholderProps {
  visible: boolean
}

export default function RotatingPlaceholder({ visible }: RotatingPlaceholderProps) {
  const [index, setIndex] = useState(0)
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  )

  useEffect(() => {
    if (!visible || reducedMotion) return
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % PROMPTS.length)
    }, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [visible, reducedMotion])

  if (!visible) return null

  if (reducedMotion) {
    return (
      <span className="absolute inset-0 flex items-center px-4 text-sm text-[var(--color-muted)] pointer-events-none">
        {PROMPTS[0]}
      </span>
    )
  }

  return (
    <div className="absolute inset-0 flex items-center px-4 pointer-events-none overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="text-sm text-[var(--color-muted)]"
        >
          {PROMPTS[index]}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
