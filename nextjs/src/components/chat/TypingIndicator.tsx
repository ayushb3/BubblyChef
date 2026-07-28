'use client'

import { motion } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'

const DOT_VARIANTS = {
  animate: (i: number) => ({
    y: [0, -6, 0],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      ease: 'easeInOut' as const,
      delay: i * 0.15,
    },
  }),
}

export default function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex items-start gap-2"
    >
      <BubblesMascot size={32} state="thinking" animate={true} />
      <div className="flex items-center gap-1.5 bg-[var(--color-accent)]/30 border border-[var(--color-accent)] rounded-2xl rounded-bl-md px-4 py-3">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            custom={i}
            variants={DOT_VARIANTS}
            animate="animate"
            className="block w-2 h-2 rounded-full bg-[var(--color-muted)]"
          />
        ))}
      </div>
    </motion.div>
  )
}
