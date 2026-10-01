'use client'

import type { Ref } from 'react'
import { useSteppedFrame } from '@/lib/motion'

/**
 * The keycap button (signature component #2, issue #741).
 *
 * A pill on an ink shadow: a 2px text-colour border, a 3px bottom "key" shadow,
 * ink text on every fill (never white on primary), a 44px minimum height. A
 * press sinks the key 2px and shrinks the shadow to 1px (60 ms), and it springs
 * back in 180 ms with a hint of overshoot. Disabled keys drop the shadow, go
 * muted and never sink. With reduced motion the press darkens the fill instead
 * of dropping, instantly.
 *
 * The press is pure CSS (`:active`), so mouse, touch and the Space/Enter keys
 * all get it with no JS, and it can't desync from the real pressed state.
 *
 * Callers that pass their own `className` (every caller that predates #741) keep
 * their fill, padding and width: the keycap chrome (border, shadow, pill, ink
 * text, press) is layered on top with `!important` utilities, so they become
 * keycaps with no change. Callers that pass no `className` get the full
 * `variant` / `size` / `fullWidth` look. `variant="plain"` opts out of the
 * chrome for text-link style or tile buttons that aren't keys.
 */
interface SpringButtonProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  /** Native tooltip / accessibility hint. */
  title?: string
  /** Accessible name override, e.g. to name the dish a generic label acts on. */
  'aria-label'?: string
  /**
   * `primary` (theme primary fill) or `secondary` (surface fill). `plain` is
   * not a key: no border, shadow or press, for text-link buttons and tiles.
   * Only fills the button when no `className` is passed.
   */
  variant?: 'primary' | 'secondary' | 'plain'
  /** `sm` is 36px tall with a 2px shadow, inside a 44px hit area. */
  size?: 'md' | 'sm'
  fullWidth?: boolean
  /**
   * Shows the three stepped pixel dots before the label, sets `aria-busy` and
   * ignores clicks. The caller supplies the in-flight label ("Planning…").
   */
  loading?: boolean
  /**
   * React 19 ref-as-prop, forwarded to the underlying `<button>`. Added for
   * issue #651 so `CompactMealCard` can scroll/focus its own Save meal
   * button; no `forwardRef` wrapper needed under React 19.
   */
  ref?: Ref<HTMLButtonElement>
}

// Keycap chrome. `!` (Tailwind v4 suffix form) makes these win over the
// legacy callers' own border / shadow / text / radius classes.
const CHROME = [
  'min-h-[44px] rounded-full! border-2! border-[color:var(--color-text)]! text-[color:var(--color-text)]! font-extrabold!',
  'shadow-[0_3px_0_var(--color-text)]! cursor-pointer',
  // press: sink 2px + shadow to 1px in 60 ms; release springs back in 180 ms.
  'transition-[translate,box-shadow,filter]! duration-[180ms]! ease-[cubic-bezier(0.34,1.56,0.64,1)]!',
  'active:duration-[60ms]! active:ease-out! active:scale-100!',
  'motion-safe:active:enabled:translate-y-[2px] motion-safe:active:enabled:shadow-[0_1px_0_var(--color-text)]!',
  // reduced motion: instant, darken the fill instead of dropping.
  'motion-reduce:transition-none! motion-reduce:active:enabled:brightness-90',
  // disabled: no shadow, muted edge and text, never sinks.
  'disabled:shadow-none! disabled:border-[color:var(--color-muted)]! disabled:text-[color:var(--color-muted)]! disabled:cursor-not-allowed',
].join(' ')

const SMALL_CHROME = [
  'min-h-[36px]! shadow-[0_2px_0_var(--color-text)]!',
  'motion-safe:active:enabled:translate-y-[1px] motion-safe:active:enabled:shadow-[0_1px_0_var(--color-text)]!',
  // 36px look, 44px hit area.
  "relative before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
].join(' ')

const VARIANT_FILL: Record<'primary' | 'secondary', string> = {
  primary:
    'bg-[var(--color-primary)] disabled:bg-[color-mix(in_srgb,var(--color-primary)_40%,var(--color-surface))]',
  secondary: 'bg-[var(--color-surface)] disabled:bg-[var(--color-bg)]',
}

const OWN_LAYOUT = {
  md: 'inline-flex items-center justify-center gap-2 px-[18px] py-2.5 text-sm leading-5 whitespace-nowrap',
  sm: 'inline-flex items-center justify-center gap-2 px-3.5 py-1.5 text-[13px] leading-[18px] whitespace-nowrap',
} as const

/** Three pixel dots stepping through 3 frames (160 ms each); still when reduced. */
function PixelDots() {
  const frame = useSteppedFrame(3, 160)
  const raised = (frame + 1) % 3 // reduced motion holds the board's middle-up pose
  return (
    <svg
      width="22"
      height="8"
      viewBox="0 0 11 4"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="block shrink-0 fill-current"
      data-testid="keycap-loading-dots"
    >
      {[0, 4, 8].map((x, i) => (
        <rect key={x} x={x} y={i === raised ? 0 : 2} width="2" height="2" />
      ))}
    </svg>
  )
}

export default function SpringButton({
  children,
  className,
  style,
  onClick,
  type = 'button',
  disabled,
  title,
  'aria-label': ariaLabel,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  ref,
}: SpringButtonProps) {
  const own = className === undefined
  const classes =
    variant === 'plain'
      ? [className ?? '', 'active:opacity-70 disabled:cursor-not-allowed']
      : [
          CHROME,
          size === 'sm' ? SMALL_CHROME : '',
          own ? OWN_LAYOUT[size] : '',
          own ? VARIANT_FILL[variant] : '',
          fullWidth ? 'w-full' : '',
          className ?? '',
        ]

  return (
    <button
      ref={ref}
      type={type}
      onClick={(e) => {
        if (loading) {
          // a loading key swallows the tap, including a submit button's form submit
          e.preventDefault()
          return
        }
        onClick?.()
      }}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      style={style}
      data-keycap={variant === 'plain' ? undefined : variant}
      className={classes.filter(Boolean).join(' ')}
    >
      {loading ? (
        <span className="inline-flex items-center justify-center gap-2">
          <PixelDots />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  )
}
