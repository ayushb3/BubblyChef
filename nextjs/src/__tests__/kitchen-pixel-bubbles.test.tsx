/**
 * The pixel Bubbles in the scene (issue #752): at rest at a spot, idling with a
 * stepped breathe, walking between spots in stepped frames facing the way it
 * walks, and the stove's steam while a cook is active. Under reduced motion
 * there are no walk frames and no loops: a still pose at the right spot.
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

import PixelBubbles from '@/components/kitchen/PixelBubbles'
import { SPOT_X, BUBBLES_Y, type BubblesSpot } from '@/lib/kitchen/bubbles-spot'

function scene(spot: BubblesSpot, cooking = false) {
  return (
    <svg>
      <PixelBubbles spot={spot} cooking={cooking} />
    </svg>
  )
}

const bubbles = () => screen.getByTestId('pixel-bubbles')
const num = (name: string) => Number(bubbles().getAttribute(name))
const steam = () => screen.queryByTestId('stove-steam')

/** Advance fake time one stepped frame at a time, recording what each frame showed. */
function record(frames: number, ms: number) {
  const seen: Array<{ x: number; pose: string | null; flip: string | null; moving: string | null }> = []
  for (let i = 0; i < frames; i++) {
    act(() => {
      jest.advanceTimersByTime(ms)
    })
    seen.push({
      x: num('data-x'),
      pose: bubbles().getAttribute('data-pose'),
      flip: bubbles().getAttribute('data-flip'),
      moving: bubbles().getAttribute('data-moving'),
    })
  }
  return seen
}

beforeEach(() => {
  mockReduced = false
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('PixelBubbles at rest (#752)', () => {
  it('stands at the stove, facing us, on the floor', () => {
    render(scene('stove'))
    expect(bubbles()).toHaveAttribute('data-spot', 'stove')
    expect(bubbles()).toHaveAttribute('data-pose', 'front')
    expect(num('data-x')).toBe(SPOT_X.stove)
    expect(bubbles().getAttribute('transform')).toContain(`${SPOT_X.stove} ${BUBBLES_Y}`)
    expect(bubbles()).toHaveAttribute('data-moving', 'false')
  })

  it('stands at the fridge turned toward it, and at the door with its back to us', () => {
    const { unmount } = render(scene('fridge'))
    expect(bubbles()).toHaveAttribute('data-pose', 'threeQuarter')
    expect(num('data-x')).toBe(SPOT_X.fridge)
    unmount()
    render(scene('door'))
    expect(bubbles()).toHaveAttribute('data-pose', 'back')
    expect(num('data-x')).toBe(SPOT_X.door)
  })

  it('is decorative: hidden from assistive tech, never a tap target, nothing named', () => {
    const { container } = render(scene('stove'))
    expect(bubbles()).toHaveAttribute('aria-hidden', 'true')
    expect(bubbles().getAttribute('class')).toContain('pointer-events-none')
    expect(container.querySelector('title')).toBeNull()
    expect(container.querySelector('[role="img"]')).toBeNull()
    expect(container.querySelector('a, button')).toBeNull()
  })

  it('is made of crisp rects, with no image request', () => {
    const { container } = render(scene('stove'))
    expect(container.querySelector('img, image')).toBeNull()
    expect(bubbles().querySelectorAll('path').length).toBeGreaterThan(5)
  })

  it('idles in place with a stepped loop: two frames, one pixel apart', () => {
    render(scene('stove'))
    const seen = new Set<string | null>()
    for (let i = 0; i < 6; i++) {
      seen.add(bubbles().getAttribute('data-frame'))
      act(() => {
        jest.advanceTimersByTime(750)
      })
    }
    expect(seen).toEqual(new Set(['base', 'squash']))
    // it never leaves the spot while idling
    expect(num('data-x')).toBe(SPOT_X.stove)
  })
})

describe('PixelBubbles walking (#752)', () => {
  it('walks from the stove to the fridge in stepped frames, facing left, and ends resting there', () => {
    const { rerender } = render(scene('stove'))
    rerender(scene('fridge'))

    const seen = record(40, 130)
    const walking = seen.filter((f) => f.pose === 'side')
    expect(walking.length).toBeGreaterThan(3)
    // facing the way it walks: leftwards, art unmirrored
    expect(walking.every((f) => f.flip === 'false')).toBe(true)
    // along the floor, never backwards
    const xs = seen.map((f) => f.x)
    expect([...xs].sort((a, b) => b - a)).toEqual(xs)
    // stepped: each frame jumps a whole step, not a glide
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i]).toBeLessThanOrEqual(3)
    expect(seen.some((f) => f.moving === 'true')).toBe(true)

    expect(num('data-x')).toBe(SPOT_X.fridge)
    expect(bubbles()).toHaveAttribute('data-pose', 'threeQuarter')
    expect(bubbles()).toHaveAttribute('data-moving', 'false')
  })

  it('walks to the right with the art mirrored, to the door', () => {
    const { rerender } = render(scene('stove'))
    rerender(scene('door'))
    const seen = record(40, 130)
    const walking = seen.filter((f) => f.pose === 'side')
    expect(walking.length).toBeGreaterThan(3)
    expect(walking.every((f) => f.flip === 'true')).toBe(true)
    expect(num('data-x')).toBe(SPOT_X.door)
    expect(bubbles()).toHaveAttribute('data-pose', 'back')
  })

  it('alternates its foot frames as it goes', () => {
    const { rerender } = render(scene('fridge'))
    rerender(scene('door'))
    const variants = new Set<string | null>()
    for (let i = 0; i < 12; i++) {
      act(() => {
        jest.advanceTimersByTime(130)
      })
      if (bubbles().getAttribute('data-pose') === 'side') variants.add(bubbles().getAttribute('data-frame'))
    }
    expect(variants).toEqual(new Set(['squash', 'passing']))
  })

  it('turns round and heads for the new spot when the target changes mid-walk', () => {
    const { rerender } = render(scene('fridge'))
    rerender(scene('door'))
    record(6, 130)
    const mid = num('data-x')
    expect(mid).toBeGreaterThan(SPOT_X.fridge)
    expect(mid).toBeLessThan(SPOT_X.door)
    rerender(scene('fridge'))
    record(40, 130)
    expect(num('data-x')).toBe(SPOT_X.fridge)
    expect(bubbles()).toHaveAttribute('data-spot', 'fridge')
  })

  it('does not move at all when the spot has not changed', () => {
    render(scene('stove'))
    const seen = record(10, 130)
    expect(new Set(seen.map((f) => f.x))).toEqual(new Set([SPOT_X.stove]))
  })

  it('leaves no timer running once it unmounts', () => {
    const { rerender, unmount } = render(scene('stove', true))
    rerender(scene('door', true))
    record(2, 130)
    unmount()
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('the stove’s steam (#752)', () => {
  it('is not there when nothing is cooking', () => {
    render(scene('stove', false))
    expect(steam()).toBeNull()
  })

  it('rises in stepped frames while a cook is active', () => {
    render(scene('stove', true))
    expect(steam()).not.toBeNull()
    const frames = new Set<string | null>()
    for (let i = 0; i < 8; i++) {
      frames.add(steam()!.getAttribute('data-frame'))
      act(() => {
        jest.advanceTimersByTime(450)
      })
    }
    expect(frames.size).toBe(3)
  })

  it('is drawn over the pot, not over Bubbles', () => {
    render(scene('stove', true))
    const wisp = steam()!
    expect(wisp.getAttribute('aria-hidden')).toBe('true')
    // every wisp sits above the pot's rim (row 36) and inside the stove's width
    for (const path of Array.from(wisp.querySelectorAll('path'))) {
      const nums = (path.getAttribute('d') ?? '').match(/M(\d+) (\d+)/g) ?? []
      for (const m of nums) {
        const [x, y] = m.slice(1).split(' ').map(Number)
        expect(y).toBeLessThan(36)
        expect(x).toBeGreaterThanOrEqual(44)
        expect(x).toBeLessThan(60)
      }
    }
  })

  it('goes away when the cook ends', () => {
    const { rerender } = render(scene('stove', true))
    expect(steam()).not.toBeNull()
    rerender(scene('stove', false))
    expect(steam()).toBeNull()
  })
})

describe('PixelBubbles under reduced motion (#752)', () => {
  beforeEach(() => {
    mockReduced = true
  })

  it('appears at the spot in a still pose, with no timer of any kind', () => {
    render(scene('stove'))
    expect(bubbles()).toHaveAttribute('data-pose', 'front')
    expect(bubbles()).toHaveAttribute('data-frame', 'base')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('does not idle', () => {
    render(scene('stove'))
    const seen = new Set<string | null>()
    for (let i = 0; i < 6; i++) {
      seen.add(bubbles().getAttribute('data-frame'))
      act(() => {
        jest.advanceTimersByTime(750)
      })
    }
    expect(seen).toEqual(new Set(['base']))
  })

  it('does not walk: it is at the new spot at once, with no walk frame at any point', () => {
    const { rerender } = render(scene('stove'))
    rerender(scene('fridge'))
    expect(num('data-x')).toBe(SPOT_X.fridge)
    expect(bubbles()).toHaveAttribute('data-pose', 'threeQuarter')
    const seen = record(30, 130)
    expect(seen.some((f) => f.pose === 'side')).toBe(false)
    expect(seen.some((f) => f.moving === 'true')).toBe(false)
    expect(new Set(seen.map((f) => f.x))).toEqual(new Set([SPOT_X.fridge]))
    expect(jest.getTimerCount()).toBe(0)

    rerender(scene('door'))
    expect(num('data-x')).toBe(SPOT_X.door)
    expect(bubbles()).toHaveAttribute('data-pose', 'back')
  })

  it('shows the steam as one still frame while cooking, with no loop', () => {
    render(scene('stove', true))
    expect(steam()).not.toBeNull()
    const frames = new Set<string | null>()
    for (let i = 0; i < 8; i++) {
      frames.add(steam()!.getAttribute('data-frame'))
      act(() => {
        jest.advanceTimersByTime(450)
      })
    }
    expect(frames.size).toBe(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})
