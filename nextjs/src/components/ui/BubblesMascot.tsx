'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

type BubblesState = 'happy' | 'surprised' | 'thinking'

interface BubblesMascotProps {
  state?: BubblesState
  size?: number
  className?: string
  animate?: boolean
}

const STATE_SRC: Record<BubblesState, string> = {
  happy: '/mascot/bubbles-happy.png',
  surprised: '/mascot/bubbles-surprised.png',
  thinking: '/mascot/bubbles-thinking.png',
}

export default function BubblesMascot({
  state = 'happy',
  size = 80,
  className,
  animate = true,
}: BubblesMascotProps) {
  const floatAnimation = animate
    ? {
        y: [0, -6, 0],
      }
    : {}

  const floatTransition = animate
    ? {
        duration: 3,
        repeat: Infinity,
        ease: 'easeInOut' as const,
      }
    : {}

  const wobbleAnimation =
    animate && state === 'thinking'
      ? { rotate: [0, -3, 3, -2, 2, 0] }
      : {}

  const wobbleTransition =
    animate && state === 'thinking'
      ? {
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut' as const,
          type: 'tween' as const,
        }
      : {}

  const combinedAnimate =
    animate && state === 'thinking'
      ? { ...floatAnimation, ...wobbleAnimation }
      : floatAnimation

  const combinedTransition =
    animate && state === 'thinking'
      ? wobbleTransition
      : floatTransition

  return (
    <motion.div
      className={className}
      animate={combinedAnimate}
      transition={combinedTransition}
      style={{ display: 'inline-block', lineHeight: 0 }}
    >
      <Image
        src={STATE_SRC[state]}
        alt={`Bubbles ${state}`}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain' }}
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
        }}
      />
    </motion.div>
  )
}
