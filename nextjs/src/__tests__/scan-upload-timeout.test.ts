/**
 * Issue #402 prerequisite — `uploadReceipt` must not hang forever. It should
 * abort the request after a bounded deadline and throw a `ScanError` the UI
 * can distinguish from other failures via `code`, not by matching on
 * `message` text.
 */

import { uploadReceipt, ScanError, SCAN_CLIENT_TIMEOUT_CODE } from '@/lib/api/scan'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  jest.useRealTimers()
})

it('aborts and throws a ScanError with the client-timeout code when the request hangs', async () => {
  jest.useFakeTimers()

  global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new DOMException('The operation was aborted.', 'AbortError')
        reject(err)
      })
    }) as Promise<Response>
  }) as typeof fetch

  const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
  const promise = uploadReceipt(file)

  // Attach a rejection handler before advancing timers so Node doesn't flag
  // the eventual rejection as unhandled while the timer is pending.
  const assertion = expect(promise).rejects.toMatchObject({
    code: SCAN_CLIENT_TIMEOUT_CODE,
  })

  await jest.advanceTimersByTimeAsync(60_000)

  await assertion
  await expect(promise).rejects.toBeInstanceOf(ScanError)
})

it('does not leave the timeout running after a successful, fast response', async () => {
  jest.useFakeTimers()
  const clearSpy = jest.spyOn(global, 'clearTimeout')

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ocr_text: '',
      ready_to_add: [],
      needs_review: [],
      skipped: [],
      total_items: 0,
      warnings: [],
    }),
  }) as unknown as typeof fetch

  const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
  await uploadReceipt(file)

  expect(clearSpy).toHaveBeenCalled()
})
