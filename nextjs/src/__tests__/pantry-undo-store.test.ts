/**
 * Issue #851 — "Used it" waits five seconds before it is written, so it can be
 * undone. The commit is deferred (not an optimistic delete that is later
 * re-created): until it fires, nothing has been written, so an undo restores the
 * very same row, with its events and bubbles untouched. The queue lives outside
 * any component, so a navigation does not cancel it or its undo.
 */
import * as pantryApi from '@/lib/api/pantry'
import {
  UNDO_WINDOW_MS,
  deferResolve,
  flushDeferredResolves,
  getDeferredResolves,
  onResolveSettled,
  resetDeferredResolvesForTests,
  undoResolve,
} from '@/lib/pantry-undo'

jest.mock('@/lib/api/pantry')
const mockResolve = pantryApi.resolvePantryItem as jest.MockedFunction<
  typeof pantryApi.resolvePantryItem
>

const BASIL = { id: 'basil-1', name: 'Basil' }

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  resetDeferredResolvesForTests()
  mockResolve.mockResolvedValue({ id: BASIL.id, name: 'Basil', outcome: 'used', resolved: true })
})
afterEach(() => {
  jest.useRealTimers()
})

describe('deferred resolve (#851)', () => {
  it('writes nothing at first and hides the item right away', () => {
    deferResolve(BASIL, 'used')
    expect(mockResolve).not.toHaveBeenCalled()
    expect(getDeferredResolves().map((d) => d.id)).toEqual(['basil-1'])
  })

  it('commits once the undo window has passed', async () => {
    deferResolve(BASIL, 'used')
    jest.advanceTimersByTime(UNDO_WINDOW_MS - 1)
    expect(mockResolve).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1)
    expect(mockResolve).toHaveBeenCalledWith('basil-1', 'used')
    await jest.runAllTimersAsync()
    expect(getDeferredResolves()).toEqual([])
  })

  it('the window is five seconds', () => {
    expect(UNDO_WINDOW_MS).toBe(5000)
  })

  it('undo restores the item and never writes it', async () => {
    deferResolve(BASIL, 'used')
    jest.advanceTimersByTime(2000)
    undoResolve('basil-1')
    expect(getDeferredResolves()).toEqual([])

    await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('undo still works after the component that started it is long gone (the queue is module state)', () => {
    // No component involved at all: start it, "navigate" (nothing to unmount), undo.
    deferResolve(BASIL, 'used')
    jest.advanceTimersByTime(4000)
    expect(getDeferredResolves()).toHaveLength(1)
    undoResolve('basil-1')
    expect(getDeferredResolves()).toEqual([])
  })

  it('tells listeners when the write lands, before the item is released', async () => {
    const seen: Array<{ ids: string[]; ok: boolean; stillHidden: number }> = []
    const off = onResolveSettled((e) =>
      seen.push({ ids: e.ids, ok: e.ok, stillHidden: getDeferredResolves().length }),
    )
    deferResolve(BASIL, 'used')
    await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    off()
    expect(seen).toEqual([{ ids: ['basil-1'], ok: true, stillHidden: 1 }])
    expect(getDeferredResolves()).toEqual([])
  })

  it('a failed write brings the item back and says so', async () => {
    mockResolve.mockRejectedValueOnce(new Error('nope'))
    const seen: Array<{ ok: boolean; name: string }> = []
    const off = onResolveSettled((e) => seen.push({ ok: e.ok, name: e.name }))

    deferResolve(BASIL, 'used')
    await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    off()

    expect(seen).toEqual([{ ok: false, name: 'Basil' }])
    expect(getDeferredResolves()).toEqual([])
  })

  it('flushing commits everything at once (the tab is closing)', async () => {
    deferResolve(BASIL, 'used')
    deferResolve({ id: 'milk-1', name: 'Milk' }, 'used')
    await flushDeferredResolves()
    expect(mockResolve).toHaveBeenCalledTimes(2)
    // And the timers are gone: nothing is written twice.
    await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2)
    expect(mockResolve).toHaveBeenCalledTimes(2)
  })

  it('a second "Used it" on the same item does not queue a second write', async () => {
    deferResolve(BASIL, 'used')
    deferResolve(BASIL, 'used')
    await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    expect(mockResolve).toHaveBeenCalledTimes(1)
  })
})
