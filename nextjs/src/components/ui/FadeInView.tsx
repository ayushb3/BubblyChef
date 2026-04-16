'use client'

import { motion } from 'framer-motion'

interface FadeInViewProps {
  children: React.ReactNode
  className?: string
  delay?: number
}

export default function FadeInView({ children, className, delay = 0 }: FadeInViewProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
