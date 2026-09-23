'use client'

/**
 * PROTOTYPE ONLY (throwaway) — Variant B, "Bubbles first".
 * A big mood-driven Bubbles card leads (greeting + mascot + speech bubble +
 * primary button). A milestone card (when active) sits between Bubbles and
 * the kitchen. The kitchen is a short banner underneath (tap to expand full).
 * Then a 3-tile quick-action grid, then the tip.
 */
import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, CaretDown, X } from '@phosphor-icons/react/dist/ssr'
import BubblesMascot from '@/components/ui/BubblesMascot'
import KitchenScene from '@/components/kitchen/KitchenScene'
import FadeInView from '@/components/ui/FadeInView'
import type { HomeVariantProps } from './types'

export default function HomeVariantB({
  displayName,
  greeting,
  emoji,
  loading,
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
}: HomeVariantProps) {
  const [kitchenExpanded, setKitchenExpanded] = useState(false)

  return (
    <div className="flex flex-col items-center pb-10">
      {/* Bubbles card — leads the screen */}
      <FadeInView delay={0} className="w-full max-w-[480px]">
        <div
          className="rounded-3xl p-5 text-center border border-[var(--color-border)] shadow-sm"
          style={{ background: 'linear-gradient(160deg, var(--color-surface) 0%, var(--color-bg) 100%)' }}
        >
          <p className="text-sm text-[var(--color-muted)] font-medium mb-1">
            {greeting}, <span style={{ color: 'var(--color-primary)' }}>{displayName}</span> {emoji}
          </p>
          <BubblesMascot state={mood} size={110} className="my-2" />
          {!loading && (
            <div className="relative max-w-xs mx-auto mt-1">
              <div
                className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-l border-t border-[var(--color-border)]"
                style={{ background: 'var(--color-surface)' }}
              />
              <div
                className="relative rounded-2xl p-3 border border-[var(--color-border)]"
                style={{ background: 'var(--color-surface)' }}
              >
                <p className="text-sm font-medium text-[var(--color-text)] leading-relaxed">{speechMessage}</p>
                <Link
                  href={speechButton.href}
                  className="inline-block mt-2.5 text-xs font-semibold px-5 py-2 rounded-full text-white"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {speechButton.label}
                </Link>
              </div>
            </div>
          )}
        </div>
      </FadeInView>

      {/* Milestone — inline card between Bubbles and the kitchen */}
      {showMilestone && (
        <FadeInView delay={0.1} className="w-full max-w-[480px] mt-3">
          <div
            className="rounded-2xl p-3 border border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
          >
            <p className="text-xs font-semibold text-[var(--color-text)] text-center mb-2">
              🎁 You reached 🫧 {milestoneThreshold}! Pick one for your kitchen
            </p>
            <div className="grid grid-cols-3 gap-2">
              {milestoneOptions.map((opt) => (
                <div
                  key={opt.id}
                  className="flex flex-col items-center gap-0.5 rounded-xl p-2 border border-[var(--color-border)]"
                  style={{ background: 'var(--color-bg)' }}
                >
                  <span className="text-xl" aria-hidden="true">
                    {opt.emoji}
                  </span>
                  <span className="text-[10px] font-semibold text-[var(--color-text)] text-center">{opt.name}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeInView>
      )}

      {/* Kitchen — short strip, tap to expand full */}
      <FadeInView delay={0.15} className="w-full max-w-[480px] mt-3">
        <button
          type="button"
          onClick={() => setKitchenExpanded(true)}
          className="relative w-full rounded-2xl overflow-hidden border border-[var(--color-border)] block"
          style={{ height: kitchenExpanded ? undefined : 96 }}
          aria-label="Expand kitchen scene"
        >
          <div className={kitchenExpanded ? '' : '-translate-y-1/3'}>
            <KitchenScene unlocked={kitchen.unlocked} balance={kitchen.balance} loading={kitchen.loading} />
          </div>
          {!kitchenExpanded && (
            <div className="absolute bottom-1 right-1.5 flex items-center gap-0.5 text-[10px] font-semibold text-white bg-black/40 rounded-full px-2 py-0.5">
              <CaretDown size={10} weight="bold" /> Kitchen
            </div>
          )}
        </button>
      </FadeInView>

      {/* Quick-action 3-tile grid */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[480px] mt-4">
        {quickActions.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.href} href={card.href}>
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="flex flex-col items-center rounded-2xl p-4 shadow-sm border border-white/30 text-white text-center min-h-[76px] justify-center"
                style={{ background: card.gradient }}
              >
                <Icon size={26} weight="fill" className="mb-1" aria-hidden="true" />
                <span className="text-xs font-bold">{card.label}</span>
              </motion.div>
            </Link>
          )
        })}
      </div>

      {/* Tip */}
      <div
        className="flex items-start gap-3 rounded-2xl px-4 py-3 border border-[var(--color-border)] max-w-[480px] w-full mt-4"
        style={{ background: 'var(--color-surface)' }}
      >
        <Lightbulb size={20} weight="fill" className="flex-shrink-0 mt-0.5 text-[var(--color-primary)]" aria-hidden="true" />
        <p className="flex-1 text-xs text-[var(--color-muted)] leading-snug line-clamp-2">
          <strong className="text-[var(--color-text)] font-semibold">Tip: </strong>
          {tip}
        </p>
        <Link
          href={tipHref}
          className="flex-shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-full text-white"
          style={{ background: 'var(--color-primary)' }}
        >
          Ask
        </Link>
      </div>

      {/* Full-kitchen overlay */}
      <AnimatePresence>
        {kitchenExpanded && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setKitchenExpanded(false)}
            />
            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-[480px]"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            >
              <KitchenScene unlocked={kitchen.unlocked} balance={kitchen.balance} loading={kitchen.loading} />
              <button
                type="button"
                onClick={() => setKitchenExpanded(false)}
                aria-label="Close"
                className="absolute -top-3 -right-3 w-9 h-9 flex items-center justify-center rounded-full shadow-md"
                style={{ background: 'var(--color-surface)' }}
              >
                <X size={16} weight="bold" />
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
