'use client'

/**
 * PROTOTYPE ONLY (throwaway) — Variant A, "Bubbles lives in the kitchen".
 *
 * Per Ayush's decision on PR #597 (2026-09-23): "the whole homepage should
 * sort of render within the kitchen view, and we could integrate the tip and
 * the quick actions within the actual scene." This is a second pass on top
 * of the original Variant A lockup — the tip line now lives INSIDE the scene
 * as a hotspot on real kitchen furniture. Only the greeting stays outside,
 * as a one-line header.
 *
 * Per Ayush's follow-up (2026-09-27, first round): "move the quick actions
 * back to the original position as in Option A v1. the pill buttons. the
 * rest were good adjustments." The quick-action chip row (Use Soon / Scan /
 * Ask) is back below the scene, exactly as in the v1 lockup (commit
 * 6b25245) — the in-scene `counter_left`/`counter_right` hotspots that
 * stood in for it are gone.
 *
 * Per Ayush's follow-up (2026-09-27, second round): "get rid of recipes
 * inside the decorations thing. and the open recipe suggestion and tip seem
 * like a similar interaction of an auto suggestion... maybe the tip can be
 * on the footer of the page. i dont want it in a card." Two changes:
 *   - The `window_sill` -> Recipes hotspot is gone outright, no replacement.
 *     Recipes stays reachable through the bottom nav only.
 *   - The tip is no longer a hotspot or a card of any kind. It's a plain,
 *     unboxed line of text at the bottom of the page content (footer area,
 *     above the bottom nav), small and muted with a 💡. Since the
 *     `fridge_door` hotspot existed ONLY to open the tip dialog, its tap
 *     target is removed rather than made a dead decorative box — it's now
 *     just an empty slot like the other unused ones (`wall_shelf`,
 *     `wall_art`, etc). The tip dialog (`tipOpen` sheet) is gone with it.
 *   - "The open recipe suggestion" is read here as the speech bubble's own
 *     mood-specific button (e.g. it reads "Open recipe" in the happy state
 *     with a suggestion) — left exactly as-is, it's the one suggestion
 *     surface on the page now that the tip isn't a second one.
 * Bubbles-as-chat-hotspot and the milestone banner/sheet are unchanged.
 *
 * ## Placeholder art
 * `art/kitchen/MANIFEST.md` (branch `art/v1-assets`) shows every kitchen
 * background and decoration is still `status: todo` — nothing has been
 * generated yet. `KitchenScene` already renders real Bubbles art (issue
 * #527 shipped the mascot half) over a flat gradient "room". This prototype
 * keeps that gradient as the walls/floor placeholder.
 *
 * ## Hotspot -> furniture mapping (for the real render)
 * Bubbles + his speech bubble stand over `table`/`rug`/`floor_corner`,
 * unchanged from the original lockup — tapping Bubbles himself opens chat.
 * Every other slot (`fridge_door`, `window_sill`, `wall_shelf`, `wall_art`,
 * `lights`, `hanging_plant`, `stove_top`, `counter_left`, `counter_right`)
 * is now an empty placeholder, rendered only by `KitchenScene`'s own
 * decoration-slot look — quick actions are the pill row below the scene,
 * Recipes is nav-only, and the tip is the footer line. `wall_shelf` in
 * particular stays clear for the milestone banner pinned to that corner
 * (`top-1.5 left-1.5`, independent of the slot grid).
 */
import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from '@phosphor-icons/react/dist/ssr'
import BubblesMascot from '@/components/ui/BubblesMascot'
import KitchenScene from '@/components/kitchen/KitchenScene'
import FadeInView from '@/components/ui/FadeInView'
import type { HomeVariantProps } from './types'

export default function HomeVariantA({
  displayName,
  greeting,
  emoji,
  loading,
  totalCount,
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

  const ask = quickActions.find((a) => a.label === 'Ask')

  return (
    <div className="flex flex-col items-center pb-10">
      <FadeInView delay={0}>
        <p className="text-sm text-[var(--color-muted)] font-medium mb-2 text-center">
          {greeting}, <span style={{ color: 'var(--color-primary)' }}>{displayName}</span> {emoji}
        </p>
      </FadeInView>

      {/* The whole home page renders inside this box — the kitchen scene is
          the page, not a banner above a list of cards. Quick actions render
          as their own pill row below the scene, and the tip as a plain line
          in the footer (see the 2026-09-27 second-round comment above) —
          neither lives inside the scene as a hotspot any more. */}
      <div className="relative w-full max-w-[480px]">
        <KitchenScene unlocked={kitchen.unlocked} balance={kitchen.balance} loading={kitchen.loading} />

        {/* Bubbles standing on the scene's floor, over `table`/`rug`/
            `floor_corner`. He's the "Bubbles -> chat" hotspot: a real link, not just a
            picture, wrapping the existing `ask` quick action's href so the
            component still only has one source of truth for that route. */}
        <Link
          href={ask?.href ?? '/chat'}
          aria-label="Chat with Bubbles"
          className="absolute left-2 bottom-1 z-20 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
        >
          <BubblesMascot state={mood} size={64} />
        </Link>

        {/* Speech bubble floats to the right of Bubbles, inside the scene.
            Its own button stays mood-specific (issue #593) — tapping Bubbles
            himself is the general "open chat" hotspot above; this button is
            the contextual one ("Review pantry", "Find a recipe", etc). */}
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

      {/* Quick-action chips — one compact row, restored to the Option A v1
          position/style per Ayush's 2026-09-27 feedback (the in-scene
          counter hotspots that briefly replaced these are gone). */}
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

      {/* Pantry-count readout — the dashboard content HeroHome shows as a
          plain caption ("🧺 N items in pantry") below everything today. Kept
          here, outside the scene, since it's informational rather than an
          action; folding it onto e.g. the `stove_top` slot as a non-tappable
          label was considered but read as a fifth hotspot by mistake in a
          quick pass, which is worse for a11y (a static readout announced
          like a button). */}
      {!loading && totalCount > 0 && (
        <FadeInView delay={0.3}>
          <p className="text-xs text-[var(--color-muted)] mt-3">
            🧺 {totalCount} item{totalCount !== 1 ? 's' : ''} in pantry
          </p>
        </FadeInView>
      )}

      {/* Tip — footer of the page content, above the bottom nav. Per Ayush's
          2026-09-27 feedback, this and the speech bubble's suggestion button
          both read as "an auto-suggestion", so this one drops the card
          treatment entirely: no background, border or shadow, just a plain
          muted line of text. Still a Link to `tipHref` (unchanged target —
          same "ask Bubbles about this" destination the old dialog's button
          pointed at), just no longer styled like a button. */}
      {!loading && tip && (
        <FadeInView delay={0.35}>
          <Link
            href={tipHref}
            className="block text-center text-[11px] leading-snug text-[var(--color-muted)] mt-3 px-6 max-w-[480px]"
          >
            <span aria-hidden="true">💡</span>{' '}
            <span className="font-semibold text-[var(--color-text)]">Tip:</span> {tip}
          </Link>
        </FadeInView>
      )}

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
              role="dialog"
              aria-modal="true"
              aria-label="Pick a reward for your kitchen"
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
