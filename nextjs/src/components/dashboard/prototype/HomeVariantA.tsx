'use client'

/**
 * PROTOTYPE ONLY (throwaway) — Variant A, "Bubbles lives in the kitchen".
 * The kitchen scene is the hero: Bubbles stands on its floor and his speech
 * bubble + button float over the scene. Below: one row of quick-action
 * chips and the tip as a single tappable line. The milestone picker is a
 * slim banner inside the scene that opens a sheet.
 */
import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, X } from '@phosphor-icons/react/dist/ssr'
import BubblesMascot from '@/components/ui/BubblesMascot'
import KitchenScene from '@/components/kitchen/KitchenScene'
import FadeInView from '@/components/ui/FadeInView'
import type { HomeVariantProps } from './types'

export default function HomeVariantA({
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
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <div className="flex flex-col items-center pb-10">
      <FadeInView delay={0}>
        <p className="text-sm text-[var(--color-muted)] font-medium mb-2 text-center">
          {greeting}, <span style={{ color: 'var(--color-primary)' }}>{displayName}</span> {emoji}
        </p>
      </FadeInView>

      {/* Hero: the kitchen scene, with Bubbles standing on its floor and his
          speech bubble floating over the scene (not below it). */}
      <div className="relative w-full max-w-[480px]">
        <KitchenScene unlocked={kitchen.unlocked} balance={kitchen.balance} loading={kitchen.loading} />

        {/* Bubbles standing on the scene's floor, bottom-left so he doesn't
            collide with the rug/table/floor_corner decoration slots. */}
        <div className="absolute left-2 bottom-1 z-20">
          <BubblesMascot state={mood} size={64} />
        </div>

        {/* Speech bubble floats to the right of Bubbles, inside the scene. */}
        {!loading && (
          <FadeInView delay={0.15} className="absolute right-2 bottom-2 left-[4.5rem] z-20">
            <div
              className="rounded-2xl px-3 py-2 shadow-md border border-white/60"
              style={{ background: 'rgba(255,249,245,0.95)' }}
            >
              <p className="text-[11px] leading-snug font-medium text-[var(--color-text)] line-clamp-3">
                {speechMessage}
              </p>
              <Link
                href={speechButton.href}
                className="inline-block mt-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full text-white"
                style={{ background: 'var(--color-primary)' }}
              >
                {speechButton.label}
              </Link>
            </div>
          </FadeInView>
        )}

        {/* Milestone: slim banner over the scene's top edge, opens a sheet. */}
        {showMilestone && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 rounded-full pl-1.5 pr-3 py-1 text-[10px] font-bold text-[var(--color-text)] shadow-sm border border-[var(--color-border)]"
            style={{ background: 'var(--color-surface)' }}
          >
            <span aria-hidden="true">🎁</span> New reward{milestoneThreshold ? ` at 🫧${milestoneThreshold}` : ''}!
          </button>
        )}
      </div>

      {/* Quick-action chips — one compact row */}
      <div className="flex gap-2 w-full max-w-[480px] mt-4 px-1">
        {quickActions.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.href} href={card.href} className="flex-1">
              <motion.div
                whileTap={{ scale: 0.96 }}
                className="flex items-center justify-center gap-1.5 rounded-full py-2.5 px-2 text-white text-xs font-bold min-h-11"
                style={{ background: card.gradient }}
              >
                <Icon size={16} weight="fill" aria-hidden="true" />
                {card.label}
              </motion.div>
            </Link>
          )
        })}
      </div>

      {/* Tip — reduced to one tappable line */}
      <Link
        href={tipHref}
        className="flex items-center gap-2 w-full max-w-[480px] mt-3 px-3 py-2.5 rounded-full border border-[var(--color-border)] min-h-11"
        style={{ background: 'var(--color-surface)' }}
      >
        <Lightbulb size={16} weight="fill" className="flex-shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
        <span className="text-xs text-[var(--color-muted)] truncate">
          <strong className="text-[var(--color-text)] font-semibold">Tip: </strong>
          {tip}
        </span>
      </Link>

      {/* Milestone sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheetOpen(false)}
            />
            <motion.div
              className="fixed left-0 right-0 bottom-0 z-50 rounded-t-3xl p-5 pb-8 max-w-[480px] mx-auto"
              style={{ background: 'var(--color-surface)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  Pick one for your kitchen 🎉
                </p>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close"
                  className="w-8 h-8 flex items-center justify-center rounded-full"
                  style={{ background: 'var(--color-bg)' }}
                >
                  <X size={16} weight="bold" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {milestoneOptions.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex flex-col items-center gap-1 rounded-xl p-3 border border-[var(--color-border)]"
                    style={{ background: 'var(--color-bg)' }}
                  >
                    <span className="text-2xl" aria-hidden="true">
                      {opt.emoji}
                    </span>
                    <span className="text-xs font-semibold text-[var(--color-text)] text-center">
                      {opt.name}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
