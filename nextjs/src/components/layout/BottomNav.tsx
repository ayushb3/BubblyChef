'use client'

/**
 * The bottom nav (issue #750, board A of the Kitchen Home canvas): Kitchen,
 * Chat, Recipes, Scan. The Pantry tab is gone ("The Pantry tab goes, and the
 * list stays"): the pantry is reached through the kitchen's storage sheets, and
 * Scan goes to the scan page.
 *
 * Drawn to the board: a 3 px ink rule on top, a surface bar, and the current
 * page as a pressed key (the primary fill with a 2 px ink edge). Colours are
 * theme variables.
 */
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { BookOpen, ChatCircle, CookingPot, Receipt } from '@phosphor-icons/react/dist/ssr'
import type { ComponentType } from 'react'
import { useMotionConfig } from '@/lib/motion'

interface IconProps {
  size?: number
  weight?: 'fill' | 'regular' | 'bold'
  className?: string
}

interface TabDef {
  href: string
  icon: ComponentType<IconProps>
  label: string
  tourId?: string
}

const tabs: TabDef[] = [
  { href: '/', icon: CookingPot, label: 'Kitchen' },
  { href: '/chat', icon: ChatCircle, label: 'Chat', tourId: 'nav-chat' },
  { href: '/recipes', icon: BookOpen, label: 'Recipes', tourId: 'nav-recipes' },
  { href: '/scan', icon: Receipt, label: 'Scan' },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { springs } = useMotionConfig()

  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    return null
  }

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-0 right-0 z-50 flex gap-1.5 border-t-[3px] px-3 pt-2 pb-3"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-text)' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            {...(tab.tourId ? { 'data-tour': tab.tourId } : {})}
            className="relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 border-2 border-transparent py-1.5 text-xs font-bold text-[color:var(--color-text)]"
          >
            {isActive && (
              <motion.span
                aria-hidden="true"
                layoutId="nav-key"
                className="absolute inset-0 border-2"
                style={{ background: 'var(--color-primary)', borderColor: 'var(--color-text)' }}
                transition={springs.snappy}
              />
            )}
            <span className="relative z-10 flex flex-col items-center gap-0.5">
              <Icon size={22} weight="regular" />
              <span>{tab.label}</span>
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
