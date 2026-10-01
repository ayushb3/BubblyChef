'use client'

/**
 * The wall's stock (issue #751): the category sprites and the wilting items, as
 * SVG nodes in wall units for `KitchenWall`'s `spritesLayer`, and the wilting
 * items' pixel-lettered tags as HTML for its `tagsLayer`.
 *
 * Category sprites are static. A wilting item is the same picture drooped (one
 * row shorter, drained of colour: `spriteArt(kind, true)`), so it reads as wilted
 * with no help from motion. On arrival it plays the world's droop reaction in
 * stepped frames, a 1-unit sag and a fade, then holds. With reduced motion it
 * renders at the held pose with no animation (`useMotionConfig`, the app's one
 * reduced-motion switch).
 *
 * Everything here is decoration for sighted users: the SVG is `aria-hidden` and
 * the tags are too, because each place's button already says "to use soon".
 */
import { motion } from 'framer-motion'
import PixelSprite from '@/components/kitchen/sprites/PixelSprite'
import { spriteArt } from '@/lib/kitchen/sprites/category'
import { steppedTransition, useMotionConfig } from '@/lib/motion'
import { WALL_H, WALL_W } from '@/lib/kitchen/slots'
import type { PlacedSprite, PlacedTag } from '@/lib/kitchen/sprite-layout'

/** How faded a wilting item is once it has drooped. */
export const WILT_OPACITY = 0.85

function WiltingSprite({ sprite, still }: { sprite: PlacedSprite; still: boolean }) {
  const { reduced: reducedMotion } = useMotionConfig()
  const reduced = reducedMotion || still
  const { rows, palette } = spriteArt(sprite.kind, true)
  return (
    <motion.g
      data-testid="kitchen-wilting"
      data-item-id={sprite.wilting?.id}
      data-place={sprite.place}
      data-kind={sprite.kind}
      data-pose="drooped"
      // Arrives a unit higher and un-faded, then sags in 2 stepped frames and
      // holds. Reduced motion has nothing to play: it starts at the held pose.
      initial={reduced ? false : { y: -1, opacity: 1 }}
      animate={{ y: 0, opacity: WILT_OPACITY }}
      transition={reduced ? { duration: 0 } : steppedTransition(2, 360)}
    >
      <PixelSprite rows={rows} palette={palette} x={sprite.x} y={sprite.y} />
    </motion.g>
  )
}

/**
 * `still` draws every wilting item at its held pose with no arrival animation:
 * for a small icon of the place (the storage sheet's header, issue #794), which
 * re-mounts on every tab switch and should not replay the wall's droop.
 */
export function KitchenSprites({
  sprites,
  still = false,
}: {
  sprites: readonly PlacedSprite[]
  still?: boolean
}) {
  return (
    <g data-testid="kitchen-sprites">
      {sprites.map((s) => {
        if (s.wilting) return <WiltingSprite key={`${s.key}-${s.wilting.id}`} sprite={s} still={still} />
        const { rows, palette } = spriteArt(s.kind, false)
        return (
          <g key={s.key} data-testid="kitchen-sprite" data-place={s.place} data-kind={s.kind}>
            <PixelSprite rows={rows} palette={palette} x={s.x} y={s.y} />
          </g>
        )
      })}
    </g>
  )
}

const PCT = (n: number, of: number) => `${Math.round((n / of) * 10000) / 100}%`

/**
 * The tags ("today", "1 day", "2 days", "expired"): the world's own type (Pixelify)
 * in a stepped frame, as on board "Category sprites". They take no taps: a tap on
 * one reaches the place's button underneath.
 */
export function WiltTags({ tags }: { tags: readonly PlacedTag[] }) {
  return (
    <>
      {tags.map((t) => (
        <span
          key={t.id}
          data-testid="kitchen-wilt-tag"
          data-item-id={t.id}
          aria-hidden="true"
          style={{ left: PCT(t.x, WALL_W), top: PCT(t.y, WALL_H) }}
          className="font-pixel pointer-events-none absolute border-2 border-[color:var(--color-text)] bg-[#fff3c4] px-[5px] py-px text-[12px] leading-[15px] font-medium whitespace-nowrap text-[#7b5a00] shadow-[2px_2px_0_var(--color-text)]"
        >
          {t.text}
        </span>
      ))}
    </>
  )
}
