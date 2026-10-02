/**
 * Issue #642 (visual half) — every scan failure and empty state is drawn in the
 * pixel language, in BOTH entry points (`/scan` and the add sheet's `ScanTab`):
 * a `PixelPanel` with Bubbles' worried or thinking sprite, the copy from
 * `scan-error-copy.ts`, and a `SpringButton` keycap to try again. The logic from
 * PR #699 (recovery paths, Cancel scan, retry without a reload) is covered by
 * `scan-failure-paths.test.tsx`; this file pins what each state looks like and
 * that it is enabled and free of raw server text.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanPage from '@/app/scan/page'
import ScanTab from '@/components/pantry/ScanTab'
import ScanFailureNotice from '@/components/scan/ScanFailureNotice'
import * as scanApi from '@/lib/api/scan'
import { scanErrorCopy, SCAN_NO_ITEMS_CODE } from '@/lib/scan-error-copy'
import type { ScanResult } from '@/types/scan'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/api/scan', () => ({
  ...jest.requireActual('@/lib/api/scan'),
  uploadReceipt: jest.fn(),
}))
jest.mock('@/lib/api/pantry')

const mockUpload = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

const ZERO_ITEMS: ScanResult = {
  ocr_text: '', ready_to_add: [], needs_review: [], skipped: [], total_items: 0, warnings: [],
}

/** Raw text a server or the network could put in an error: must never reach the screen. */
const RAW = 'GeminiProvider(model=gemini-3.1-flash-lite): 502 upstream connect error'

type Failure = { name: string; code: string; sprite: 'worried' | 'thinking'; trigger: 'reject' | 'empty' }

const FAILURES: Failure[] = [
  { name: 'network error', code: scanApi.SCAN_NETWORK_ERROR_CODE, sprite: 'worried', trigger: 'reject' },
  { name: 'client timeout', code: scanApi.SCAN_CLIENT_TIMEOUT_CODE, sprite: 'worried', trigger: 'reject' },
  { name: 'server timeout', code: 'scan_timeout', sprite: 'worried', trigger: 'reject' },
  { name: 'provider unavailable', code: 'vision_provider_unavailable', sprite: 'worried', trigger: 'reject' },
  { name: 'rate limited', code: 'scan_rate_limited', sprite: 'worried', trigger: 'reject' },
  { name: 'session expired', code: 'scan_auth_expired', sprite: 'worried', trigger: 'reject' },
  { name: 'file too large', code: 'scan_file_too_large', sprite: 'worried', trigger: 'reject' },
  { name: 'malformed response', code: 'scan_failed', sprite: 'worried', trigger: 'reject' },
  { name: 'unrecognized code', code: 'some_future_code', sprite: 'worried', trigger: 'reject' },
  { name: 'unreadable photo', code: 'unreadable_image', sprite: 'thinking', trigger: 'reject' },
  { name: 'not an image', code: scanApi.SCAN_NOT_AN_IMAGE_CODE, sprite: 'thinking', trigger: 'reject' },
  { name: 'nothing found', code: SCAN_NO_ITEMS_CODE, sprite: 'thinking', trigger: 'empty' },
]

describe('ScanFailureNotice', () => {
  it.each(FAILURES)('$name: friendly copy in a pixel panel, enabled keycap', ({ code, sprite }) => {
    const onRetry = jest.fn()
    render(<ScanFailureNotice code={code} onRetry={onRetry} />)

    const notice = screen.getByRole('alert')
    expect(notice).toHaveAttribute('data-pixel-panel')
    expect(within(notice).getByText(scanErrorCopy(code))).toBeInTheDocument()
    expect(within(notice).getByAltText(`Bubbly ${sprite}`)).toBeInTheDocument()

    const retry = within(notice).getByRole('button', { name: /choose a photo/i })
    expect(retry).toBeEnabled()
    expect(retry).toHaveAttribute('data-keycap', 'primary')
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows the copy for the code, never the code itself', () => {
    render(<ScanFailureNotice code="scan_rate_limited" onRetry={jest.fn()} />)
    expect(document.body.textContent).not.toMatch(/scan_rate_limited/)
  })
})

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

const ENTRY_POINTS: Array<{ name: string; mount: () => HTMLElement }> = [
  { name: '/scan page', mount: () => render(withClient(<ScanPage />)).container },
  { name: 'add-sheet ScanTab', mount: () => render(<ScanTab onParsed={jest.fn()} />).container },
]

function pick(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], 'receipt.png', { type: 'image/png' })] } })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpload.mockReset()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

describe.each(ENTRY_POINTS)('$name', ({ mount }) => {
  it.each(FAILURES)('$name: pixel failure panel, copy, enabled controls, no raw text', async (f) => {
    if (f.trigger === 'empty') mockUpload.mockResolvedValueOnce(ZERO_ITEMS)
    else mockUpload.mockRejectedValueOnce(new scanApi.ScanError(RAW, f.code))
    const container = mount()

    pick(container)

    const notice = await screen.findByRole('alert')
    expect(notice).toHaveAttribute('data-pixel-panel')
    expect(within(notice).getByText(scanErrorCopy(f.code))).toBeInTheDocument()
    expect(within(notice).getByAltText(`Bubbly ${f.sprite}`)).toBeInTheDocument()

    // Every control is live: the keycap, and the dropzone it sits above.
    expect(within(notice).getByRole('button', { name: /choose a photo/i })).toBeEnabled()
    // Both entry points (#840): the zone is a pixel panel holding its own keycap.
    const zone = screen.getByText(/Drop your receipt here/).closest('[data-pixel-panel]')
    expect(
      within(zone as HTMLElement).getByRole('button', { name: /choose a photo/i }),
    ).toBeEnabled()

    // Copy only: no raw server text, no error code, no spinner left behind.
    expect(document.body.textContent).not.toContain(RAW)
    expect(document.body.textContent).not.toMatch(/gemini|502|upstream|scan_|client_timeout/i)
    expect(screen.queryByText(/Scanning receipt…/)).not.toBeInTheDocument()
  })

  it('a plain (non-ScanError) failure gets the generic panel, not its message', async () => {
    mockUpload.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const container = mount()

    pick(container)

    const notice = await screen.findByRole('alert')
    expect(within(notice).getByText(scanErrorCopy(undefined))).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Failed to fetch')
  })

  it('the keycap opens the file picker again (retry without a reload)', async () => {
    mockUpload.mockRejectedValueOnce(new scanApi.ScanError(RAW, 'scan_failed'))
    const container = mount()
    pick(container)
    const notice = await screen.findByRole('alert')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const click = jest.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(within(notice).getByRole('button', { name: /choose a photo/i }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('picking a photo clears the failure panel while the next scan runs', async () => {
    mockUpload.mockRejectedValueOnce(new scanApi.ScanError(RAW, 'scan_failed'))
    const container = mount()
    pick(container)
    await screen.findByRole('alert')

    mockUpload.mockReturnValueOnce(new Promise(() => {})) // stays in flight
    pick(container)

    await waitFor(() => expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Cancel scan is an enabled keycap while a scan is in flight', async () => {
    mockUpload.mockReturnValueOnce(new Promise(() => {}))
    const container = mount()

    pick(container)

    const cancel = await screen.findByRole('button', { name: /cancel scan/i })
    expect(cancel).toBeEnabled()
    expect(cancel).toHaveAttribute('data-keycap', 'secondary')
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
