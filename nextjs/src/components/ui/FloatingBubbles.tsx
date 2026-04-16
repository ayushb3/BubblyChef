'use client'

import { motion } from 'framer-motion'

interface Bubble {
  id: number
  size: number
  x: number
  duration: number
  delay: number
  color: string
}

const bubbles: Bubble[] = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  size: 12 + Math.round((i * 7 + 5) % 13),
  x: 5 + (i * 9) % 90,
  duration: 8 + (i * 1.3) % 7,
  delay: (i * 1.1) % 5,
  color: i % 2 === 0 ? 'var(--color-primary)' : 'var(--color-accent)',
}))

export default function FloatingBubbles() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden pointer-events-none"
    >
      {bubbles.map((bubble) => (
        <motion.div
          key={bubble.id}
          className="absolute rounded-full"
          style={{
            width: bubble.size,
            height: bubble.size,
            left: `${bubble.x}%`,
            bottom: -bubble.size,
            backgroundColor: bubble.color,
            opacity: 0.4,
          }}
          animate={{
            y: [0, -(400 + bubble.size * 10)],
            opacity: [0, 0.4, 0.4, 0],
          }}
          transition={{
            duration: bubble.duration,
            delay: bubble.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  )
}
