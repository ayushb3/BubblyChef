'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'

const tabs = [
  { href: '/', emoji: '🏠', label: 'Home' },
  { href: '/pantry', emoji: '🧺', label: 'Pantry' },
  { href: '/scan', emoji: '📷', label: 'Scan' },
  { href: '/recipes', emoji: '📖', label: 'Recipes' },
  { href: '/chat', emoji: '💬', label: 'Chat' },
]

export default function BottomNav() {
  const pathname = usePathname()

  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    return null
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] rounded-t-3xl">
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = tab.href === '/'
            ? pathname === '/'
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex-1 flex flex-col items-center py-2 pb-4 gap-0.5"
            >
              <motion.span
                className="text-2xl leading-none"
                animate={isActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={isActive ? { type: 'tween', duration: 0.3, ease: 'easeInOut' } : {}}
              >
                {tab.emoji}
              </motion.span>
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="w-4 h-1 rounded-full bg-[var(--color-primary)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              {!isActive && <div className="w-4 h-1" />}
              <span
                className={`text-xs font-medium ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted)]'}`}
              >
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
