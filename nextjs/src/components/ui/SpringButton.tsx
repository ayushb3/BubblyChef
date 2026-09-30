'use client'

import { motion } from 'framer-motion'
import type { Ref } from 'react'

interface SpringButtonProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  /** Native tooltip / accessibility hint. */
  title?: string
  /**
   * React 19 ref-as-prop, forwarded to the underlying `<button>`. Added for
   * issue #651 so `CompactMealCard` can scroll/focus its own Save meal
   * button; no `forwardRef` wrapper needed under React 19.
   */
  ref?: Ref<HTMLButtonElement>
}

export default function SpringButton({
  children,
  className,
  style,
  onClick,
  type = 'button',
  disabled,
  title,
  ref,
}: SpringButtonProps) {
  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      whileHover={{ scale: disabled ? 1 : 1.03 }}
      whileTap={{ scale: disabled ? 1 : 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className={
        className ??
        'bg-[var(--color-primary)] text-white font-semibold py-3 px-6 rounded-full disabled:opacity-50 disabled:cursor-not-allowed'
      }
    >
      {children}
    </motion.button>
  )
}
