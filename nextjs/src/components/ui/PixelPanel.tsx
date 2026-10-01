'use client'

/**
 * PixelPanel: the pixel-framed card (signature component #1, issue #742).
 *
 * Drawn to the Signature "Panel" board: a 3 px text-colour ("ink") border with
 * 4 px stepped corners, a surface fill, 16 px padding and a hard 4 px offset
 * shadow in the theme's `primary-dark`. Every colour is a theme CSS variable,
 * so switching the kitchen theme recolours the whole frame.
 *
 * The stepped corners are `clip-path` polygons, not images: any size works at
 * 1x and 2x with no art. The offset shadow is a `drop-shadow` filter on a
 * wrapper (a `box-shadow` would be clipped away by the polygon).
 *
 * Contract for `frontend`:
 *  - `as`: the root element ('div' by default; 'a' / 'button' make the whole
 *    card the control, which turns on the stepped focus ring).
 *  - `className`: layout classes for the root (width, margin, flex item).
 *  - `contentClassName`: replaces the default `p-4` on the surface, for the
 *    rare panel that needs different padding.
 *  - `entrance`: spring in (scale 0.96 to 1 with a fade, 180 ms), or a plain
 *    150 ms fade under reduced motion.
 *  - everything else (href, onClick, aria-*, data-*) goes to the root.
 */

import {
  createElement,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from 'react'
import { motion } from 'framer-motion'
import { useMotionConfig } from '@/lib/motion'

/** Ink: the frame, the ring and the sheet edge all use the text colour. */
export const PIXEL_INK = 'var(--color-text)'

/** The hard offset shadow of a panel (4 px, theme `primary-dark`). */
export const PIXEL_SHADOW = 'drop-shadow(4px 4px 0 var(--color-primary-dark))'

/**
 * Stepped-corner polygon, 2 steps per corner. `step` is the size of one step
 * in px (the board uses 4 px outside, 3 px for the inner surface). `inset` pulls
 * the whole shape in from the box edge; a negative value pushes it out, which
 * is how the focus ring is drawn around the panel.
 */
function stepPoints(step: number, inset: number): string[] {
  const s1 = inset + step
  const s2 = inset + step * 2
  const l = `${inset}px`
  const r = `calc(100% - ${inset}px)`
  const t = l
  const b = r
  const x = (n: number) => `${n}px`
  const rx = (n: number) => `calc(100% - ${n}px)`
  return [
    `${l} ${x(s2)}`,
    `${x(s1)} ${x(s2)}`,
    `${x(s1)} ${x(s1)}`,
    `${x(s2)} ${x(s1)}`,
    `${x(s2)} ${t}`,
    `${rx(s2)} ${t}`,
    `${rx(s2)} ${x(s1)}`,
    `${rx(s1)} ${x(s1)}`,
    `${rx(s1)} ${x(s2)}`,
    `${r} ${x(s2)}`,
    `${r} ${rx(s2)}`,
    `${rx(s1)} ${rx(s2)}`,
    `${rx(s1)} ${rx(s1)}`,
    `${rx(s2)} ${rx(s1)}`,
    `${rx(s2)} ${b}`,
    `${x(s2)} ${b}`,
    `${x(s2)} ${rx(s1)}`,
    `${x(s1)} ${rx(s1)}`,
    `${x(s1)} ${rx(s2)}`,
    `${l} ${rx(s2)}`,
  ]
}

const polygon = (points: string[]) => `polygon(${points.join(', ')})`

/** The 3 px ink frame (outer) and the surface (inner) clip paths. */
const OUTER_CLIP = polygon(stepPoints(4, 0))
const INNER_CLIP = polygon(stepPoints(3, 0))

/**
 * The focus ring: 3 px ink, 3 px gap, following the stepped shape. Built as a
 * ring-shaped polygon (outer path, then the inner path wound the other way, so
 * the middle is a hole), 6 px outside the panel for the outer edge and 3 px
 * outside for the inner edge.
 */
const RING_CLIP = (() => {
  const outer = stepPoints(4, 0)
  // The ring box is the panel grown by 6 px, so the panel edge sits at 6 px in
  // and the gap/ring edges at 3 px / 0 px. Inner edge = panel grown by 3 px.
  const inner = stepPoints(4, 3).reverse()
  return polygon([...outer, outer[0], ...inner, inner[0], outer[0]])
})()

type Tag = ElementType

export type PixelPanelProps<T extends Tag = 'div'> = {
  as?: T
  className?: string
  contentClassName?: string
  entrance?: boolean
  children?: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>

const INLINE_TAGS = new Set<string>(['a', 'button', 'span', 'label'])

export default function PixelPanel<T extends Tag = 'div'>({
  as,
  className = '',
  contentClassName = 'p-4',
  entrance = false,
  children,
  ...rest
}: PixelPanelProps<T>) {
  const { reduced } = useMotionConfig()
  const tag: Tag = as ?? 'div'
  const interactive = tag === 'a' || tag === 'button'
  // A control can only hold phrasing content, so its frame layers are spans.
  const Layer = typeof tag === 'string' && INLINE_TAGS.has(tag) ? 'span' : 'div'

  const frame = createElement(
    Layer,
    {
      className: 'block',
      style: { filter: PIXEL_SHADOW },
    },
    createElement(
      Layer,
      {
        className: 'block',
        style: { background: PIXEL_INK, clipPath: OUTER_CLIP, padding: 3 },
      },
      createElement(
        Layer,
        {
          className: `block ${contentClassName}`,
          style: { background: 'var(--color-surface)', clipPath: INNER_CLIP },
        },
        children,
      ),
    ),
  )

  const root = createElement(
    tag,
    {
      ...rest,
      'data-pixel-panel': '',
      className: `group relative block ${className}`.trim(),
      // The stepped ring below replaces the global rectangular focus outline.
      style: interactive ? { outline: 'none' } : undefined,
    },
    frame,
    interactive
      ? createElement(Layer, {
          'aria-hidden': true,
          'data-pixel-panel-ring': '',
          className: 'pointer-events-none absolute opacity-0 group-focus-visible:opacity-100',
          style: {
            inset: -6,
            background: PIXEL_INK,
            clipPath: RING_CLIP,
          },
        })
      : null,
  )

  if (!entrance) return root
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={
        reduced
          ? { duration: 0.15 }
          : { type: 'spring', stiffness: 380, damping: 34, duration: 0.18 }
      }
    >
      {root}
    </motion.div>
  )
}
