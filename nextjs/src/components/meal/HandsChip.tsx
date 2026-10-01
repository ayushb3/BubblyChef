/**
 * Issue #745 — the hands-on / hands-off chip, in the timeline's solid /
 * hatched language: hands-on (a step you do) is a solid pill, hands-off
 * (already cooking) is a hatched, dashed one. The words are always printed, so
 * the look is never the only signal.
 *
 * Contract: `handsOn` picks the look and the word; `fillClass` overrides the
 * solid fill (a `DISH_BG` class, so the Now card's chip wears its dish's
 * pastel; defaults to the theme primary); `testId` is passed through.
 */

import { HATCHED, SOLID_EDGE } from './dish-style'

export interface HandsChipProps {
  handsOn: boolean
  fillClass?: string
  className?: string
  testId?: string
}

export default function HandsChip({
  handsOn,
  fillClass = 'bg-[var(--color-primary)]',
  className = '',
  testId,
}: HandsChipProps) {
  return (
    <span
      data-look={handsOn ? 'solid' : 'hatched'}
      data-testid={testId}
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] leading-4 font-extrabold whitespace-nowrap text-[color:var(--color-text)] ${
        handsOn ? `${SOLID_EDGE} ${fillClass}` : HATCHED
      } ${className}`}
    >
      {handsOn ? 'Hands-on' : 'Hands-off'}
    </span>
  )
}
