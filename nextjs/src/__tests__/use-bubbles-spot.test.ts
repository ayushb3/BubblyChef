/**
 * `useBubblesSpot` (issue #752): the three signals (a scan or put-away open, a cook
 * session in storage, food going off) in, a spot and "cooking" out, kept current
 * as another tab starts or ends a cook.
 */
import { act, renderHook } from '@testing-library/react'
import { useBubblesSpot } from '@/hooks/useBubblesSpot'
import { summarizePlaces, emptyPlaceSummaries } from '@/lib/kitchen/places'
import { startGuidedCookSession, endCookSession } from '@/lib/cook-session'

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
})
