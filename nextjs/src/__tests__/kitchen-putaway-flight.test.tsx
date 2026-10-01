/**
 * The put-away flight (issue #754, board A3): after a successful put-away each
 * item hops from its row to its own place, one by one, and the place's +N ticks
 * up as each lands. A tap anywhere jumps to the end state. Under reduced motion
 * nothing flies: the counts just update.
 *
 * The component only plays a plan it is handed (the write already succeeded:
 * `PutAwaySheet` never starts a flight after a failed write, see
 * `kitchen-putaway-sheet.test.tsx`). Timers are fake, so the whole sequence is
 * stepped through deterministically. No model is called.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import PutAwayFlight, { type PutAwayHop } from '@/components/kitchen/PutAwayFlight'
import { HOP_MS, planFlight } from '@/lib/kitchen/put-away-flight'
import type { PlaceKey } from '@/lib/kitchen/places'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

const ROTATION: PlaceKey[] = ['fridge', 'freezer', 'shelves', 'basket']

function hops(n: number): PutAwayHop[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    place: ROTATION[i % 4],
    emoji: '🥛',
    name: `Item ${i}`,
    from: { x: 200, y: 600 },
  }))
}

function renderFlight(list: PutAwayHop[]) {
  const onLanded = jest.fn()
  const onDone = jest.fn()
  const view = render(
    <>
      <div data-testid="kitchen-wall" />
      <PutAwayFlight hops={list} onLanded={onLanded} onDone={onDone} />
    </>,
  )
  return { onLanded, onDone, ...view }
}

function lastLanded(onLanded: jest.Mock) {
  return onLanded.mock.calls[onLanded.mock.calls.length - 1]?.[0]
}

beforeEach(() => {
  mockReduced = false
  jest.useFakeTimers()
  // A 390 px wall at the top of the page: the board's render.
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const wall = (this as HTMLElement).dataset?.testid === 'kitchen-wall'
    return (
      wall ? { left: 0, top: 80, width: 390, height: 325, right: 390, bottom: 405 } : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
    ) as DOMRect
  })
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('PutAwayFlight', () => {
  it('sends each item off one by one, in list order, and lands them in turn', () => {
    const list = hops(11)
    const plan = planFlight(list)
    const { onLanded } = renderFlight(list)

    // The first item is on its way, the second has not left yet.
    act(() => jest.advanceTimersByTime(1))
    expect(screen.getAllByTestId('put-away-chip')).toHaveLength(1)
    expect(screen.getByTestId('put-away-chip')).toHaveAttribute('data-item-id', 'i0')
    expect(onLanded).not.toHaveBeenCalled()

    // It lands (the fridge ticks to 1) just as the second is in the air.
    act(() => jest.advanceTimersByTime(HOP_MS))
    expect(lastLanded(onLanded)).toEqual({ fridge: 1, freezer: 0, shelves: 0, basket: 0 })
    const flying = screen.getAllByTestId('put-away-chip').map((c) => c.getAttribute('data-item-id'))
    expect(flying).not.toContain('i0')
    expect(flying).toContain('i1')

    // Every item lands, one place at a time: each tick is exactly one more.
    act(() => jest.advanceTimersByTime(plan.totalMs))
    const ticks = onLanded.mock.calls.map(([c]) => Object.values(c as Record<string, number>).reduce((a, b) => a + b, 0))
    expect(ticks).toEqual(Array.from({ length: 11 }, (_, i) => i + 1))
  })

  it("ends with each place's count correct, then reports done once", () => {
    const list = hops(11)
    const plan = planFlight(list)
    const { onLanded, onDone } = renderFlight(list)

    act(() => jest.advanceTimersByTime(plan.totalMs - 1))
    expect(onDone).not.toHaveBeenCalled()
    expect(lastLanded(onLanded)).toEqual({ fridge: 3, freezer: 3, shelves: 3, basket: 2 })

    act(() => jest.advanceTimersByTime(1))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()
  })

  it('finishes 30 items in under about 4 seconds, the tail landing in batches', () => {
    const { onLanded, onDone } = renderFlight(hops(30))
    act(() => jest.advanceTimersByTime(3999))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(lastLanded(onLanded)).toEqual({ fridge: 8, freezer: 8, shelves: 7, basket: 7 })
  })

  it('a batch chip says how many it carries', () => {
    renderFlight(hops(30))
    // The tail (items 13 on) leaves after the twelfth single; fast-forward to it.
    act(() => jest.advanceTimersByTime(3200))
    const batches = screen.queryAllByTestId('put-away-chip').filter((c) => c.getAttribute('data-batch'))
    for (const b of batches) expect(b).toHaveTextContent(/×\d/)
  })

  it('a tap during the animation jumps to the end state, and the tap is not swallowed', () => {
    const list = hops(30)
    const { onLanded, onDone } = renderFlight(list)
    act(() => jest.advanceTimersByTime(900))
    expect(onDone).not.toHaveBeenCalled()

    const button = document.createElement('button')
    const onClick = jest.fn()
    button.addEventListener('click', onClick)
    document.body.appendChild(button)

    act(() => {
      fireEvent.pointerDown(button)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(lastLanded(onLanded)).toEqual({ fridge: 8, freezer: 8, shelves: 7, basket: 7 })
    expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()

    // The tap went on to its target (the overlay never intercepts it) and nothing replays.
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    act(() => jest.advanceTimersByTime(5000))
    expect(onDone).toHaveBeenCalledTimes(1)
    button.remove()
  })

  it('a key press also skips to the end, for keyboard users', () => {
    const { onDone } = renderFlight(hops(11))
    act(() => jest.advanceTimersByTime(500))
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Enter' })
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('never blocks a tap: the layer takes no pointer events and is hidden from assistive tech', () => {
    renderFlight(hops(5))
    act(() => jest.advanceTimersByTime(1))
    const layer = screen.getByTestId('put-away-flight')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer.className).toContain('pointer-events-none')
    expect(screen.getByTestId('put-away-chip').closest('[data-testid="put-away-flight"]')).toBe(layer)
  })

  it('stops its timers when it unmounts mid-flight (leaving home)', () => {
    const { onLanded, onDone, unmount } = renderFlight(hops(11))
    act(() => jest.advanceTimersByTime(600))
    const calls = onLanded.mock.calls.length
    unmount()
    act(() => jest.advanceTimersByTime(6000))
    expect(onLanded.mock.calls).toHaveLength(calls)
    expect(onDone).not.toHaveBeenCalled()
  })

  describe('reduced motion', () => {
    beforeEach(() => {
      mockReduced = true
    })

    it('flies nothing: no chip is drawn and no element translates', () => {
      const { container } = renderFlight(hops(11))
      act(() => jest.advanceTimersByTime(50))
      expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()
      expect(container.querySelectorAll('[style*="transform"], [style*="translate"]')).toHaveLength(0)
    })

    it('updates the counts at once and is done, with no wait for a sparkle', () => {
      const { onLanded, onDone } = renderFlight(hops(11))
      act(() => jest.advanceTimersByTime(1))
      expect(lastLanded(onLanded)).toEqual({ fridge: 3, freezer: 3, shelves: 3, basket: 2 })
      expect(onDone).toHaveBeenCalledTimes(1)
    })
  })

  it('has nothing to play for an empty list: done at once', () => {
    const { onLanded, onDone } = renderFlight([])
    act(() => jest.advanceTimersByTime(1))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onLanded).not.toHaveBeenCalled()
  })
})
