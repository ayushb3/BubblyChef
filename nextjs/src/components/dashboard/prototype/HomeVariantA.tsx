'use client'

/**
 * PROTOTYPE ONLY (throwaway) — Variant A, "Bubbles lives in the kitchen".
 *
 * Per Ayush's decision on PR #597 (2026-09-23): "the whole homepage should
 * sort of render within the kitchen view, and we could integrate the tip and
 * the quick actions within the actual scene." This is a second pass on top
 * of the original Variant A lockup — everything that used to live BELOW the
 * scene (the quick-action chip row, the tip line) now lives INSIDE it as
 * hotspots on real kitchen furniture. Only the greeting stays outside, as a
 * one-line header.
 *
 * ## Placeholder art
 * `art/kitchen/MANIFEST.md` (branch `art/v1-assets`) shows every kitchen
 * background and decoration is still `status: todo` — nothing has been
 * generated yet. `KitchenScene` already renders real Bubbles art (issue
 * #527 shipped the mascot half) over a flat gradient "room". This prototype
 * keeps that gradient as the walls/floor placeholder and adds dashed-outline
 * hotspot cards, styled like the scene's own empty-decoration-slot look, so
 * the whole thing reads as "still a mockup" rather than a finished screen.
 *
 * ## Hotspot -> furniture mapping (for the real render)
 * Hotspots are positioned using the SAME percentage grid as
 * `lib/kitchen/slots.ts` (the 12 decoration slots), so they land exactly
 * where that furniture will be once illustrated:
 *   - `fridge_door`   -> tip note ("pinned to the fridge", per the brief)
 *   - `window_sill`   -> Recipes (not one of today's three quick actions —
 *                        see the open question below)
 *   - `counter_left`  -> Use Soon / pantry (carries the same expiring-item
 *                        count the old below-scene chip showed)
 *   - `counter_right` -> Scan (receipt set down on the counter)
 *   - `wall_shelf`, `wall_art`, `lights`, `hanging_plant`, `stove_top`,
 *     `table`, `rug`, `floor_corner` are left as empty placeholder slots —
 *     nothing in the current spec needed a ninth hotspot, and `wall_shelf`
 *     in particular is reserved (see below).
 *   - Bubbles + his speech bubble stand over `table`/`rug`/`floor_corner`,
 *     unchanged from the original lockup. Tapping Bubbles himself opens chat.
 *   - The pantry item-count readout (🧺 N items) sits just below the scene,
 *     not on a slot — see its own comment for why.
 *
 * ## Open questions for the real render (flagged in the PR, not resolved here)
 * - `wall_shelf` (top-left) is deliberately left empty here: the milestone
 *   banner ("New reward at...") is pinned to that same corner
 *   (`top-1.5 left-1.5`, independent of the slot grid) and the two collided
 *   when Recipes lived there in an earlier pass. Recipes moved to
 *   `window_sill` instead. The real render needs to either keep `wall_shelf`
 *   clear whenever a milestone is pending, or move the banner.
 * - `fridge_door`, `window_sill` and `counter_left`/`counter_right` are also
 *   decoration slots in the gamification catalog (`fridge_magnets` /
 *   `fridge_drawing`, `sill_succulent` / `sill_herbs`, etc). Reusing their
 *   coordinates for functional hotspots means the final illustration either
 *   (a) keeps those slots hotspot-only and moves their decorations
 *   elsewhere, or (b) draws the unlocked decoration AS the hotspot's
 *   backdrop (e.g. the herb pots the player unlocked double as the
 *   "Recipes" button). Not decided here.
 */
import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, X, Fire, Camera, BookOpen } from '@phosphor-icons/react/dist/ssr'
import BubblesMascot from '@/components/ui/BubblesMascot'
import KitchenScene from '@/components/kitchen/KitchenScene'
import FadeInView from '@/components/ui/FadeInView'
import { SLOTS } from '@/lib/kitchen/slots'
import type { HomeVariantProps } from './types'

const SLOT_BY_KEY = new Map(SLOTS.map((s) => [s.key, s]))

/** Inline percentage box matching a decoration slot's position, for a hotspot overlay. */
function slotBox(key: string) {
  const slot = SLOT_BY_KEY.get(key)
  if (!slot) return {}
  return {
    left: `${slot.x}%`,
    top: `${slot.y}%`,
    width: `${slot.w}%`,
    height: `${slot.h}%`,
  }
}

export default function HomeVariantA({
  displayName,
  greeting,
  emoji,
  loading,
  totalCount,
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
}: HomeVariantProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)

  const useSoon = quickActions.find((a) => a.label === 'Use Soon')
  const scan = quickActions.find((a) => a.label === 'Scan')
  const ask = quickActions.find((a) => a.label === 'Ask')

  return (
    <div className="flex flex-col items-center pb-10">
      <FadeInView delay={0}>
        <p className="text-sm text-[var(--color-muted)] font-medium mb-2 text-center">
          {greeting}, <span style={{ color: 'var(--color-primary)' }}>{displayName}</span> {emoji}
        </p>
      </FadeInView>

      {/* The whole home page renders inside this box — the kitchen scene is
          the page, not a banner above a list of cards. Everything below
          (tip, quick actions, pantry count) sits as an absolutely-positioned
          hotspot layered over KitchenScene's own 12 decoration slots +
          balance pill, sharing their coordinate grid. */}
      <div className="relative w-full max-w-[480px]">
        <KitchenScene unlocked={kitchen.unlocked} balance={kitchen.balance} loading={kitchen.loading} />

        {!loading && (
          <>
            {/* PLACEHOLDER hotspot: fridge door -> today's tip, "pinned to
                the fridge" per the brief. Real render: a sticky note or
                magnet-clip graphic on the fridge door illustration. */}
            <div className="absolute z-10" style={slotBox('fridge_door')}>
              <button
                type="button"
                onClick={() => setTipOpen(true)}
                aria-haspopup="dialog"
                className="group w-full h-full flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/70 bg-white/15 backdrop-blur-[1px] px-1.5 py-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2 hover:bg-white/25 transition-colors"
              >
                <Lightbulb size={20} weight="fill" aria-hidden="true" />
                <span className="text-[9px] font-bold leading-tight text-center line-clamp-2">
                  Tip: {tip}
                </span>
              </button>
            </div>

            {/* PLACEHOLDER hotspot: window sill -> Recipes. This isn't one of
                the three chips HeroHome passes as `quickActions` today, so
                its href is written directly rather than threaded through the
                shared prop contract — flagged in the PR as an open question
                (should Recipes become a fourth quick action?). Placed at
                `window_sill` rather than `wall_shelf` (its more obvious
                "cookbook stack" namesake) because `wall_shelf` shares its
                top-left corner with the milestone banner below — see the
                banner's own comment. */}
            <div className="absolute z-10" style={slotBox('window_sill')}>
              <Link
                href="/recipes"
                className="group w-full h-full flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/70 bg-white/15 backdrop-blur-[1px] px-1.5 py-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2 hover:bg-white/25 transition-colors"
              >
                <BookOpen size={20} weight="fill" aria-hidden="true" />
                <span className="text-[10px] font-bold">Recipes</span>
              </Link>
            </div>

            {/* PLACEHOLDER hotspot: counter -> Scan a receipt. */}
            {scan && (
              <div className="absolute z-10" style={slotBox('counter_right')}>
                <Link
                  href={scan.href}
                  className="group w-full h-full flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/70 bg-white/15 backdrop-blur-[1px] px-1.5 py-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2 hover:bg-white/25 transition-colors"
                >
                  <Camera size={20} weight="fill" aria-hidden="true" />
                  <span className="text-[10px] font-bold">Scan</span>
                </Link>
              </div>
            )}

            {/* PLACEHOLDER hotspot: counter (opposite side) -> Use Soon /
                pantry, carrying the same expiring-item count the old
                below-scene chip showed, so nothing here is lost. */}
            {useSoon && (
              <div className="absolute z-10" style={slotBox('counter_left')}>
                <Link
                  href={useSoon.href}
                  // Explicit aria-label rather than relying on the <br/>-split
                  // text content, whose accessible-name whitespace handling
                  // isn't guaranteed to insert a word boundary the way the
                  // visual line break does.
                  aria-label={`Use Soon — ${expiringCount > 0 ? `${expiringCount} item${expiringCount > 1 ? 's' : ''}` : 'all fresh'}`}
                  className="group w-full h-full flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/70 bg-white/15 backdrop-blur-[1px] px-1.5 py-1 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2 hover:bg-white/25 transition-colors"
                >
                  <Fire size={20} weight="fill" aria-hidden="true" />
                  <span className="text-[10px] font-bold leading-tight text-center" aria-hidden="true">
                    Use Soon
                    <br />
                    {expiringCount > 0 ? `${expiringCount} item${expiringCount > 1 ? 's' : ''}` : 'All fresh!'}
                  </span>
                </Link>
              </div>
            )}
          </>
        )}

        {/* Bubbles standing on the scene's floor, over `table`/`rug`/
            `floor_corner` — the row the other four hotspots leave clear.
            He's the "Bubbles -> chat" hotspot: a real link, not just a
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

      {/* Tip dialog — opened by the fridge-note hotspot. A modal (rather than
          the old below-scene tappable line) because the hotspot itself is
          too small to show the full tip text and its "Ask Bubbles" action. */}
      <AnimatePresence>
        {tipOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setTipOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Today's tip"
              className="fixed left-0 right-0 bottom-0 z-50 rounded-t-3xl p-5 pb-8 max-w-[480px] mx-auto"
              style={{ background: 'var(--color-surface)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="flex items-start justify-between mb-2 gap-3">
                <p className="text-sm font-bold text-[var(--color-text)] flex items-start gap-2">
                  <Lightbulb size={18} weight="fill" className="flex-shrink-0 text-[var(--color-primary)] mt-0.5" aria-hidden="true" />
                  <span>{tip}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setTipOpen(false)}
                  aria-label="Close"
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full"
                  style={{ background: 'var(--color-bg)' }}
                >
                  <X size={16} weight="bold" />
                </button>
              </div>
              <Link
                href={tipHref}
                onClick={() => setTipOpen(false)}
                className="inline-block mt-2 text-xs font-semibold px-4 py-2 rounded-full text-white"
                style={{ background: 'var(--color-primary)' }}
              >
                Ask Bubbles about this
              </Link>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
