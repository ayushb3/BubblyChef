'use client'

import { useState, useEffect } from 'react'
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

interface RotatingPlaceholderProps {
  visible: boolean
}

export default function RotatingPlaceholder({ visible }: RotatingPlaceholderProps) {
  const [index, setIndex] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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
