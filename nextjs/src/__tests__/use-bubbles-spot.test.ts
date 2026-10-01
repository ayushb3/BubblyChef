/**
 * `useBubblesSpot` (issue #752): the three signals (a scan or put-away open, a cook
 * session in storage, food going off) in, a spot and "cooking" out, kept current
 * as another tab starts or ends a cook.
 */
import { act, renderHook } from '@testing-library/react'
import { useBubblesSpot } from '@/hooks/useBubblesSpot'
import { summarizePlaces, emptyPlaceSummaries } from '@/lib/kitchen/places'
import { startGuidedCookSession, endCookSession, clearActiveCookSession } from '@/lib/cook-session'
import {
  startMealCookSession,
  endMealCookSession,
  clearActiveMealCookSession,
} from '@/lib/meal-cook-session'

const TODAY = '2026-10-01'
const wilting = () => summarizePlaces([{ location: 'fridge', expiry_date: '2026-10-02' }], TODAY)
const fresh = () => summarizePlaces([{ location: 'fridge', expiry_date: '2027-01-01' }], TODAY)

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('useBubblesSpot (#752)', () => {
  it('rests at the stove with nothing going on, and while the pantry is unknown', () => {
    expect(renderHook(() => useBubblesSpot({ places: null })).result.current).toEqual({
      spot: 'stove',
      cooking: false,
    })
    expect(renderHook(() => useBubblesSpot({ places: emptyPlaceSummaries() })).result.current.spot).toBe('stove')
    expect(renderHook(() => useBubblesSpot({ places: fresh() })).result.current.spot).toBe('stove')
  })

  it('goes to the fridge when something is going off', () => {
    const { result } = renderHook(() => useBubblesSpot({ places: wilting() }))
    expect(result.current).toEqual({ spot: 'fridge', cooking: false })
  })

  it('goes to the door while a scan or put-away is open, whatever else is going on', () => {
    startGuidedCookSession('r1')
    const { result } = renderHook(() => useBubblesSpot({ places: wilting(), scanOpen: true }))
    expect(result.current.spot).toBe('door')
  })

  it('stands at the stove, cooking, when a cook session is already in storage on arrival', () => {
    startGuidedCookSession('r1')
    const { result } = renderHook(() => useBubblesSpot({ places: wilting() }))
    expect(result.current).toEqual({ spot: 'stove', cooking: true })
  })

  it('follows a cook started in another tab (storage event) and back to the fridge when it is cleared', () => {
    const { result } = renderHook(() => useBubblesSpot({ places: wilting() }))
    expect(result.current.spot).toBe('fridge')

    act(() => {
      startGuidedCookSession('r1')
      window.dispatchEvent(new StorageEvent('storage', { key: 'bubblychef:cook:activeSession' }))
    })
    expect(result.current).toEqual({ spot: 'stove', cooking: true })

    act(() => {
      endCookSession('r1')
      window.dispatchEvent(new StorageEvent('storage', { key: 'bubblychef:cook:endedRecipeId' }))
    })
    expect(result.current).toEqual({ spot: 'fridge', cooking: false })
  })

  it('catches up when the tab is shown again, since a hidden tab may have missed the event', () => {
    const { result } = renderHook(() => useBubblesSpot({ places: null }))
    expect(result.current.cooking).toBe(false)
    act(() => {
      startGuidedCookSession('r1')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.cooking).toBe(true)
    act(() => {
      endCookSession('r1')
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current.cooking).toBe(false)
  })

  // Issue #837: the `storage` event only reaches OTHER tabs, so a cook ended in
  // this tab (the home card's "I finished it", any end path) must tell the scene
  // itself. Each case below ends the session with no event dispatched by the test.
  describe('a cook ended in this same tab (#837)', () => {
    const mealStart = () => startMealCookSession('m-1', ['d-1'], Date.now(), ['sig'])

    it.each([
      ['a guided cook is marked cooked (endCookSession)', () => startGuidedCookSession('r1'), () => endCookSession('r1')],
      ['a guided cook is abandoned (clearActiveCookSession)', () => startGuidedCookSession('r1'), () => clearActiveCookSession('r1')],
      ['a meal cook is marked cooked or its pantry update skipped (endMealCookSession)', mealStart, () => endMealCookSession('m-1')],
      ['a meal cook is abandoned (clearActiveMealCookSession)', mealStart, () => clearActiveMealCookSession('m-1')],
    ])('stops cooking when %s', (_name, start, end) => {
      start()
      const { result } = renderHook(() => useBubblesSpot({ places: wilting() }))
      expect(result.current).toEqual({ spot: 'stove', cooking: true })

      act(() => end())
      expect(result.current).toEqual({ spot: 'fridge', cooking: false })
    })

    it('starts cooking when a cook begins in this tab', () => {
      const { result } = renderHook(() => useBubblesSpot({ places: null }))
      expect(result.current.cooking).toBe(false)
      act(() => startGuidedCookSession('r1'))
      expect(result.current.cooking).toBe(true)
    })
  })
})
