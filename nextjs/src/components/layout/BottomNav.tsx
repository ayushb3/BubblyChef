'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  House,
  Archive,
  ChatCircle,
  BookOpen,
} from '@phosphor-icons/react/dist/ssr'
import type { ComponentType } from 'react'
import { springs } from '@/lib/motion'

interface IconProps {
  size?: number
  weight?: 'fill' | 'regular'
  className?: string
}

interface TabDef {
  href: string
  icon: ComponentType<IconProps>
  label: string
}

const tabs: TabDef[] = [
  { href: '/', icon: House, label: 'Home' },
  { href: '/pantry', icon: Archive, label: 'Pantry' },
  { href: '/chat', icon: ChatCircle, label: 'Chat' },
  { href: '/recipes', icon: BookOpen, label: 'Recipes' },
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
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="focus-ring-inset flex-1 relative flex flex-col items-center py-2 pb-4 gap-0.5"
            >
              {isActive && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-x-1 inset-y-1 rounded-2xl"
                  style={{ background: 'var(--color-primary)', opacity: 0.15 }}
                  transition={springs.snappy}
                />
              )}
              <motion.div
                className="relative z-10"
                animate={isActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={isActive ? { type: 'tween', duration: 0.3, ease: 'easeInOut' } : {}}
              >
                <Icon
                  size={24}
                  weight="fill"
                  className={isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted)]'}
                />
              </motion.div>
              <span
                className={`relative z-10 text-xs font-medium ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted)]'}`}
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
