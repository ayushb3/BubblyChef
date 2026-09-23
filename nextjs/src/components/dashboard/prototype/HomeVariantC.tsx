'use client'

/**
 * PROTOTYPE ONLY (throwaway) — Variant C, "Full-screen kitchen + sheet".
 * The kitchen fills the viewport above the bottom nav with Bubbles in it and
 * the 🫧 pill + streak in the corner. Everything else lives in a bottom
 * sheet with a peek state (just the message + button) that expands on tap.
 * A simple state toggle stands in for a drag gesture — no gesture library.
 */
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { CaretUp, Fire, Lightbulb } from '@phosphor-icons/react/dist/ssr'
import BubblesMascot from '@/components/ui/BubblesMascot'
import KitchenScene from '@/components/kitchen/KitchenScene'
import type { HomeVariantProps } from './types'

export interface HomeVariantCProps extends HomeVariantProps {
  /** Lifted so screenshots can force the expanded state via `?sheet=expanded`. */
  forceExpanded?: boolean
}

export default function HomeVariantC({
  greeting,
  displayName,
  emoji,
  loading,
  expiringCount,
  tip,
  tipHref,
  speechMessage,
  speechButton,
  mood,
  kitchen,
  showMilestone,
  milestoneOptions,
  milestoneThreshold,
  quickActions,
  forceExpanded = false,
}: HomeVariantCProps) {
  const [expanded, setExpanded] = useState(forceExpanded)

  return (
    <div
      className="fixed inset-x-0 top-0 z-10 flex flex-col"
      style={{
        background: 'var(--color-bg)',
        // Clears both the bottom nav AND the PrototypeSwitcher pill that
        // floats just above it, so the sheet's peek content is never
        // covered by the dev-only switcher (see PrototypeSwitcher.tsx).
        bottom: 'calc(72px + 64px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* Full-viewport kitchen (above the bottom nav, which sits at ~72px + safe
          area). KitchenScene's own box is a fixed 4:3 that would otherwise only
          fill the available WIDTH, leaving letterboxing top/bottom on a portrait
          phone. Sizing the wrapper by the available HEIGHT instead (aspect-ratio
          derives the width) and letting it overflow horizontally, centred and
          cropped by the parent's `overflow-hidden`, makes the scene genuinely
          fill the viewport the way a cover background would. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          {/* `[&>div]:!max-w-none` strips KitchenScene's own 480px cap
              (meant for the compact home layout) so it can grow past it here. */}
          <div className="h-full min-w-full shrink-0 [&>div]:max-w-none!" style={{ aspectRatio: '4 / 3' }}>
            <KitchenScene unlocked={kitchen.unlocked} balance={kitchen.balance} loading={kitchen.loading} />
          </div>
        </div>

        {/* Greeting, top-left, over the scene */}
        <div className="absolute top-3 left-3 z-10">
          <p
            className="text-xs font-semibold px-2.5 py-1 rounded-full text-[var(--color-text)] shadow-sm border border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
          >
            {greeting}, {displayName} {emoji}
          </p>
        </div>

        {/* Bubbles standing in the scene */}
        <div className="absolute left-3 bottom-[38%] z-10">
          <BubblesMascot state={mood} size={72} />
        </div>

        {showMilestone && (
          <div
            className="absolute top-12 right-3 z-10 rounded-full px-2.5 py-1 text-[10px] font-bold text-[var(--color-text)] shadow-sm border border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
          >
            🎁 🫧{milestoneThreshold} reward!
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <motion.div
        className="relative z-20 rounded-t-3xl border-t border-[var(--color-border)] shadow-[0_-4px_20px_rgba(0,0,0,0.08)]"
        style={{ background: 'var(--color-surface)' }}
        animate={{ height: expanded ? '62vh' : 132 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex flex-col items-center pt-2 pb-1"
          aria-expanded={expanded}
        >
          <span className="w-10 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }} />
          <CaretUp
            size={14}
            weight="bold"
            className="mt-1 text-[var(--color-muted)] transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
          />
        </button>

        {/* Peek content — always visible: Bubbles' message + button */}
        {!loading && (
          <div className="px-5 pb-3 text-center">
            <p className="text-sm font-medium text-[var(--color-text)] leading-snug line-clamp-2">
              {speechMessage}
            </p>
            <Link
              href={speechButton.href}
              className="inline-block mt-2 text-xs font-semibold px-5 py-2 rounded-full text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              {speechButton.label}
            </Link>
          </div>
        )}

        {/* Expanded content */}
        {expanded && (
          <div className="px-5 pb-6 overflow-y-auto" style={{ maxHeight: 'calc(62vh - 110px)' }}>
            {showMilestone && (
              <div
                className="rounded-2xl p-3 border border-[var(--color-border)] mb-3"
                style={{ background: 'var(--color-bg)' }}
              >
                <p className="text-xs font-semibold text-[var(--color-text)] text-center mb-2">
                  You reached 🫧 {milestoneThreshold}! Pick one
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {milestoneOptions.map((opt) => (
                    <div
                      key={opt.id}
                      className="flex flex-col items-center gap-0.5 rounded-xl p-2 border border-[var(--color-border)]"
                      style={{ background: 'var(--color-surface)' }}
                    >
                      <span className="text-xl" aria-hidden="true">
                        {opt.emoji}
                      </span>
                      <span className="text-[10px] font-semibold text-[var(--color-text)] text-center">
                        {opt.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 mb-3">
              {quickActions.map((card) => {
                const Icon = card.icon
                return (
                  <Link key={card.href} href={card.href}>
                    <div
                      className="flex flex-col items-center rounded-2xl p-3 text-white text-center min-h-[70px] justify-center"
                      style={{ background: card.gradient }}
                    >
                      <Icon size={22} weight="fill" className="mb-1" aria-hidden="true" />
                      <span className="text-[11px] font-bold">{card.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>

            <div
              className="flex items-start gap-2 rounded-2xl px-3 py-2.5 border border-[var(--color-border)]"
              style={{ background: 'var(--color-bg)' }}
            >
              <Lightbulb size={16} weight="fill" className="flex-shrink-0 mt-0.5 text-[var(--color-primary)]" aria-hidden="true" />
              <p className="flex-1 text-[11px] text-[var(--color-muted)] leading-snug">
                <strong className="text-[var(--color-text)] font-semibold">Tip: </strong>
                {tip}
              </p>
              <Link href={tipHref} className="flex-shrink-0 text-[10px] font-semibold text-[var(--color-primary)] underline">
                Ask
              </Link>
            </div>

            {expiringCount > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[var(--color-muted)] justify-center">
                <Fire size={12} weight="fill" className="text-[var(--color-primary)]" />
                {expiringCount} item{expiringCount > 1 ? 's' : ''} need attention
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
