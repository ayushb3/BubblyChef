/**
 * Issue #848 — the screen must not sleep mid-cook. `useWakeLock` requests a
 * screen wake lock while active, re-requests it when the tab comes back to the
 * front (the browser releases it whenever the page is hidden), releases it on
 * leave, and is a silent no-op where the API is unsupported.
 */

import React from 'react'
import { act, render } from '@testing-library/react'
import { useWakeLock } from '@/hooks/useWakeLock'

function Probe({ active = true }: { active?: boolean }) {
  useWakeLock(active)
  return null
}

interface FakeSentinel {
  released: boolean
  release: jest.Mock
  addEventListener: jest.Mock
  fireRelease: () => void
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useWakeLock (issue #848)', () => {
  let request: jest.Mock
  let sentinels: FakeSentinel[]

  beforeEach(() => {
    sentinels = []
    request = jest.fn().mockImplementation(async () => {
      let onRelease: (() => void) | undefined
      const s: FakeSentinel = {
        released: false,
        release: jest.fn().mockImplementation(async () => {
          s.released = true
        }),
        addEventListener: jest.fn().mockImplementation((_: string, cb: () => void) => {
          onRelease = cb
        }),
        fireRelease: () => {
          s.released = true
          onRelease?.()
        },
      }
      sentinels.push(s)
      return s
    })
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  afterEach(() => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock
  })

  it('requests a screen wake lock on mount', async () => {
    render(<Probe />)
    await act(async () => {})
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('does nothing while inactive', async () => {
    render(<Probe active={false} />)
    await act(async () => {})
    expect(request).not.toHaveBeenCalled()
  })

  it('re-requests when the tab becomes visible again after the browser released it', async () => {
    render(<Probe />)
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(1)

    // The browser releases the lock when the page is hidden.
    act(() => {
      sentinels[0].fireRelease()
      setVisibility('hidden')
    })
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not stack a second lock when one is still held on return', async () => {
    render(<Probe />)
    await act(async () => {})
    act(() => setVisibility('visible'))
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('releases the lock on unmount', async () => {
    const { unmount } = render(<Probe />)
    await act(async () => {})
    unmount()
    await act(async () => {})
    expect(sentinels[0].release).toHaveBeenCalled()
  })

  it('releases a lock that resolves after the page has already left', async () => {
    const { unmount } = render(<Probe />)
    unmount()
    await act(async () => {})
    expect(sentinels.length).toBeGreaterThan(0)
    expect(sentinels.every((s) => s.release.mock.calls.length > 0)).toBe(true)
  })

  it('is a silent no-op where the Wake Lock API is unsupported', async () => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock
    expect(() => render(<Probe />)).not.toThrow()
    await act(async () => {})
  })

  it('swallows a rejected request (e.g. low battery)', async () => {
    request.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
    expect(() => render(<Probe />)).not.toThrow()
    await act(async () => {})
  })
})
