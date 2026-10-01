/**
 * Issue #642 — every way the scan request can fail must come out of
 * `uploadReceipt` as a `ScanError` carrying a stable code, so the UI never
 * has to interpret a raw status, a parse error or a fetch `TypeError`.
 */

import { uploadReceipt, ScanError } from '@/lib/api/scan'
import { scanErrorCopy } from '@/lib/scan-error-copy'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

const file = () => new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })

// jsdom has no `Response`, so hand back the minimal shape `uploadReceipt` reads.
function respond(status: number, body: string, _contentType = 'application/json') {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
  }) as unknown as typeof fetch
}

describe('non-2xx responses map to a stable code even with no usable body', () => {
  it.each([
    [429, 'scan_rate_limited'],
    [503, 'vision_provider_unavailable'],
    [502, 'vision_provider_unavailable'],
    [504, 'scan_timeout'],
    [401, 'scan_auth_expired'],
    [413, 'scan_file_too_large'],
    [500, 'scan_failed'],
  ])('status %i with an HTML body -> %s', async (status, code) => {
    respond(status, '<html>Bad gateway</html>', 'text/html')
    await expect(uploadReceipt(file())).rejects.toMatchObject({ name: 'ScanError', code })
  })

  it('keeps the sanitized code the AI service sent over the status default', async () => {
    respond(503, JSON.stringify({ error: 'x', code: 'unreadable_image' }))
    await expect(uploadReceipt(file())).rejects.toMatchObject({ code: 'unreadable_image' })
  })
})

describe('other failure shapes', () => {
  it('a 200 whose body is not JSON is a ScanError, not a raw SyntaxError', async () => {
    respond(200, '<html>oops</html>', 'text/html')
    const p = uploadReceipt(file())
    await expect(p).rejects.toBeInstanceOf(ScanError)
    await expect(p).rejects.toMatchObject({ code: 'scan_failed' })
  })

  it('a 200 whose JSON is not a scan result is a ScanError', async () => {
    respond(200, 'null')
    await expect(uploadReceipt(file())).rejects.toMatchObject({ code: 'scan_failed' })
  })

  it('a 200 with missing item arrays is normalized to empty tiers', async () => {
    respond(200, JSON.stringify({ ocr_text: '' }))
    const result = await uploadReceipt(file())
    expect(result.ready_to_add).toEqual([])
    expect(result.needs_review).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('the fetch itself throwing (offline) is a ScanError with a network code', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
    const p = uploadReceipt(file())
    await expect(p).rejects.toBeInstanceOf(ScanError)
    await expect(p).rejects.toMatchObject({ code: 'scan_network_error' })
  })

  it('a non-image file is rejected before any upload', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const pdf = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
    await expect(uploadReceipt(pdf)).rejects.toMatchObject({ code: 'scan_not_an_image' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a file with an empty MIME type (some HEIC pickers) is still uploaded', async () => {
    respond(
      200,
      JSON.stringify({ ocr_text: '', ready_to_add: [], needs_review: [], skipped: [], total_items: 0, warnings: [] }),
    )
    await expect(uploadReceipt(new File(['x'], 'r.heic', { type: '' }))).resolves.toBeDefined()
  })
})

describe('copy for every code', () => {
  const codes = [
    'scan_rate_limited',
    'scan_auth_expired',
    'scan_file_too_large',
    'scan_network_error',
    'scan_not_an_image',
    'no_items_found',
  ]

  it.each(codes)('%s has its own friendly copy, distinct from the generic fallback', (code) => {
    const copy = scanErrorCopy(code)
    expect(copy).not.toBe(scanErrorCopy('scan_failed'))
    expect(copy).not.toBe(scanErrorCopy(undefined))
    expect(copy.length).toBeGreaterThan(20)
  })
})
