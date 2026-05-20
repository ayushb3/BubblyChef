import { useReducedMotion, type Transition, type Variants } from 'framer-motion'

export const springs = {
  soft: { type: 'spring', stiffness: 260, damping: 24, mass: 0.7 },
  snappy: { type: 'spring', stiffness: 500, damping: 30, mass: 0.7 },
  pop: { type: 'spring', stiffness: 700, damping: 18, mass: 0.5 },
  page: { type: 'spring', stiffness: 260, damping: 28, mass: 0.8 },
} as const satisfies Record<string, Transition>

const reducedTransition: Transition = { duration: 0.01 }

export const heartPopVariants: Variants = {
  idle: { scale: 1, rotate: 0 },
  pop: {
    scale: [1, 1.4, 0.95, 1.1, 1],
    rotate: [0, -12, 8, -4, 0],
    transition: springs.pop,
  },
}

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
}

export const staggerItem: Variants = {
  hidden: { y: 6, opacity: 0 },
  show: { y: 0, opacity: 1, transition: springs.snappy },
}

type SpringName = keyof typeof springs

export interface MotionConfig {
  springs: Record<SpringName, Transition>
  reduced: boolean
}

export function useMotionConfig(): MotionConfig {
  const reduced = useReducedMotion() ?? false
  if (reduced) {
    return {
      reduced: true,
      springs: {
        soft: reducedTransition,
        snappy: reducedTransition,
        pop: reducedTransition,
        page: reducedTransition,
      },
    }
  }
  return { reduced: false, springs }
}
