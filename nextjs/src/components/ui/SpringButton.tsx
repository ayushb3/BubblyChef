'use client'

import { motion } from 'framer-motion'

interface SpringButtonProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
}

export default function SpringButton({
  children,
  className,
  style,
  onClick,
  type = 'button',
  disabled,
}: SpringButtonProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={style}
      whileHover={{ scale: disabled ? 1 : 1.03 }}
      whileTap={{ scale: disabled ? 1 : 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      // `focus-ring` is prepended unconditionally (not folded into the default
      // string below) so every caller gets it — including ones that pass a
      // fully custom `className`, which replaces the default entirely.
      className={`focus-ring ${
        className ??
        'bg-[var(--color-primary)] text-white font-semibold py-3 px-6 rounded-full disabled:opacity-50 disabled:cursor-not-allowed'
      }`}
    >
      {children}
    </motion.button>
  )
}
