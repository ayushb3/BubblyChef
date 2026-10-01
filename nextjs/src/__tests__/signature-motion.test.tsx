/**
 * Signature motion foundations (issue #741): the stepped helper, the four
 * reaction variants and their reduced-motion forms, and the count-up. Pure
 * functions plus one hook, so no component or framer mock is needed.
 */
import { act, renderHook } from '@testing-library/react'
import {
  COUNT_UP_MAX_TICKS,
  COUNT_UP_MS,
  countUpValues,
  reactionVariants,
  steppedEase,
  steppedTransition,
  useCountUp,
  useSteppedFrame,
} from '@/lib/motion'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

beforeEach(() => {
  mockReduced = false
})

describe('steppedEase', () => {
  it('holds each frame and jumps between them, ending exactly on 1', () => {
    const ease = steppedEase(3)
    expect(ease(0)).toBe(0)
    expect(ease(0.32)).toBe(0)
    expect(ease(0.34)).toBeCloseTo(1 / 3)
    expect(ease(0.7)).toBeCloseTo(2 / 3)
    expect(ease(1)).toBe(1)
  })

  it('steppedTransition is a tween in seconds with a stepped ease', () => {
    const t = steppedTransition(2, 360) as { duration: number; ease: (n: number) => number }
    expect(t.duration).toBeCloseTo(0.36)
    expect(t.ease(0.6)).toBe(0.5)
  })
})

describe('reactionVariants', () => {
  it('motion form: pop scales, droop sags, bounce hops 2px, wiggle shifts 3px', () => {
    const v = reactionVariants(false)
    expect(v.pop.play).toMatchObject({ scale: [1, 1.12, 1] })
    expect(v.droop.play).toMatchObject({ rotate: expect.any(Number), y: expect.any(Number) })
    expect(v.bounce.play).toMatchObject({ y: [0, -2, 0] })
    const wiggle = (v.wiggle.play as { x: number[] }).x
    expect(Math.max(...wiggle.map(Math.abs))).toBe(3)
    expect(wiggle[0]).toBe(0)
    expect(wiggle[wiggle.length - 1]).toBe(0)
  })

  it('reduced form: world reactions are still poses', () => {
    const v = reactionVariants(true)
    for (const name of ['droop', 'bounce'] as const) {
      const play = v[name].play as Record<string, unknown>
      expect(play.rotate ?? 0).toBe(0)
      expect(play.y ?? 0).toBe(0)
      expect((play.transition as { duration: number }).duration).toBe(0)
    }
  })

  it('reduced form: UI reactions are opacity fades with no movement or scale', () => {
    const v = reactionVariants(true)
    for (const name of ['pop', 'wiggle'] as const) {
      const play = v[name].play as Record<string, unknown>
      expect(play.opacity).toBeDefined()
      expect(play.scale).toBeUndefined()
      expect(play.x).toBeUndefined()
      expect(play.y).toBeUndefined()
    }
  })
})

describe('countUpValues', () => {
  it('rises in at most 30 ticks, strictly increasing, ending exactly on the target', () => {
    const values = countUpValues(240, 252)
    expect(values.length).toBeLessThanOrEqual(COUNT_UP_MAX_TICKS)
    expect(values[values.length - 1]).toBe(252)
    expect(values[0]).toBeGreaterThan(240)
    values.forEach((v, i) => i > 0 && expect(v).toBeGreaterThan(values[i - 1]))
  })

  it('caps a big jump at 30 ticks', () => {
    const values = countUpValues(0, 5000)
    expect(values.length).toBeLessThanOrEqual(COUNT_UP_MAX_TICKS)
    expect(values[values.length - 1]).toBe(5000)
  })

  it('eases out: the first step is bigger than the last', () => {
    const values = [240, ...countUpValues(240, 400)]
    const first = values[1] - values[0]
    const last = values[values.length - 1] - values[values.length - 2]
    expect(first).toBeGreaterThan(last)
  })

  it('a drop or no change is a single jump', () => {
    expect(countUpValues(10, 4)).toEqual([4])
    expect(countUpValues(10, 10)).toEqual([10])
  })
})

describe('useCountUp', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('shows the value as is on first render, with no rise', () => {
    const { result } = renderHook(() => useCountUp(240))
    expect(result.current).toEqual({ shown: 240, rise: 0, riseKey: 0 })
  })

  it('counts up from the old value over ~600 ms when the value rises', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 240 } })
    rerender({ v: 252 })
    expect(result.current.shown).toBe(240) // not jumped yet
    expect(result.current.rise).toBe(12)
    expect(result.current.riseKey).toBe(1)
    act(() => jest.advanceTimersByTime(COUNT_UP_MS / 2))
    expect(result.current.shown).toBeGreaterThan(240)
    expect(result.current.shown).toBeLessThan(252)
    act(() => jest.advanceTimersByTime(COUNT_UP_MS))
    expect(result.current.shown).toBe(252)
  })

  it('follows a drop immediately and does not count as a rise', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 50 } })
    rerender({ v: 20 })
    expect(result.current).toEqual({ shown: 20, rise: 0, riseKey: 0 })
  })

  it('under reduced motion the number swaps once, with no steps', () => {
    mockReduced = true
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 240 } })
    rerender({ v: 252 })
    expect(result.current.shown).toBe(252)
    expect(result.current.rise).toBe(12)
  })
})

describe('useSteppedFrame', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('advances one frame per interval and loops', () => {
    const { result } = renderHook(() => useSteppedFrame(3, 160))
    expect(result.current).toBe(0)
    act(() => jest.advanceTimersByTime(160))
    expect(result.current).toBe(1)
    act(() => jest.advanceTimersByTime(160))
    expect(result.current).toBe(2)
    act(() => jest.advanceTimersByTime(160))
    expect(result.current).toBe(0)
  })

  it('holds a still pose under reduced motion', () => {
    mockReduced = true
    const { result } = renderHook(() => useSteppedFrame(3, 160))
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current).toBe(0)
  })
})
