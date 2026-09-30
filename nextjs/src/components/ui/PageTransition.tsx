'use client'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'

// Issue #679: there is deliberately no AnimatePresence / `exit` here. The App
// Router's `children` is a slot that renders whatever route is CURRENT, so an
// exiting wrapper (keyed by the old pathname) rendered the NEXT page too, then
// the new wrapper mounted it again. Every page mounted twice per navigation,
// and a seeded /chat sent its seed twice. A key change now unmounts the old
// page at once and mounts the new one once, with the same fade-in.
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{ minHeight: '100%' }}
    >
      {children}
    </motion.div>
  )
}
