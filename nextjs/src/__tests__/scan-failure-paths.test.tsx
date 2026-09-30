/**
 * Issue #642 — every failure path, in BOTH scan entry points (`/scan` and the
 * pantry add sheet's `ScanTab`), must end in a recoverable state: friendly
 * copy, no stuck spinner, controls usable, and a retry that works without a
 * reload. The two entry points own separate state machines (#259), so the
 * same contract is run against each through a small harness.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanPage from '@/app/scan/page'
import ScanTab from '@/components/pantry/ScanTab'
import * as scanApi from '@/lib/api/scan'
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

const ITEM = {
  name: 'Milk', original_name: 'milk', source_line: 'MILK', price: 2, quantity: 1,
  unit: 'item', category: 'dairy', location: 'fridge', confidence: 0.95,
}
const ONE_ITEM: ScanResult = {
  ocr_text: '', ready_to_add: [ITEM], needs_review: [], skipped: [], total_items: 1, warnings: [],
}
const ZERO_ITEMS: ScanResult = {
  ocr_text: '', ready_to_add: [], needs_review: [], skipped: [], total_items: 0, warnings: [],
}

interface Harness {
  name: string
  mount: () => { container: HTMLElement; unmount: () => void; onProcessingChange: jest.Mock }
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

const harnesses: Harness[] = [
  {
    name: '/scan page',
    mount: () => {
      const r = render(withClient(<ScanPage />))
      return { container: r.container, unmount: r.unmount, onProcessingChange: jest.fn() }
    },
  },
  {
    name: 'add-sheet ScanTab',
    mount: () => {
      const onProcessingChange = jest.fn()
      const r = render(<ScanTab onItemsReady={jest.fn()} onProcessingChange={onProcessingChange} />)
      return { container: r.container, unmount: r.unmount, onProcessingChange }
    },
  },
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

const FAILURES: Array<[string, () => Error, RegExp]> = [
  ['network error', () => new scanApi.ScanError('offline', 'scan_network_error'), /connection/i],
  ['client timeout', () => new scanApi.ScanError('t', scanApi.SCAN_CLIENT_TIMEOUT_CODE), /taking too long/i],
  ['429 rate limited', () => new scanApi.ScanError('r', 'scan_rate_limited'), /busy|too many/i],
  ['5xx provider down', () => new scanApi.ScanError('p', 'vision_provider_unavailable'), /temporarily unavailable/i],
  ['malformed response', () => new scanApi.ScanError('bad json', 'scan_failed'), /add items manually/i],
]

describe.each(harnesses)('$name', ({ mount }) => {
  it.each(FAILURES)('%s -> friendly copy, no stuck spinner, retry works', async (_n, makeErr, copy) => {
    mockUpload.mockRejectedValueOnce(makeErr())
    const { container, onProcessingChange } = mount()

    pick(container)
    await waitFor(() => expect(screen.getByText(copy)).toBeInTheDocument())

    expect(screen.queryByText(/Scanning receipt…/)).not.toBeInTheDocument()
    expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
    if (onProcessingChange.mock.calls.length) {
      expect(onProcessingChange).toHaveBeenLastCalledWith(false)
    }
    expect(document.body.textContent).not.toMatch(/scan_|TypeError|Failed to fetch/)

    // Retry without a reload.
    mockUpload.mockResolvedValueOnce(ONE_ITEM)
    pick(container)
    await waitFor(() => expect(screen.getByText(/Found/)).toBeInTheDocument())
    expect(screen.queryByText(copy)).not.toBeInTheDocument()
  })

  it('zero items parsed -> a friendly "nothing found" state, not an empty review', async () => {
    mockUpload.mockResolvedValueOnce(ZERO_ITEMS)
    const { container, onProcessingChange } = mount()

    pick(container)
    await waitFor(() => expect(screen.getByText(/couldn't find any items/i)).toBeInTheDocument())

    expect(screen.queryByText(/Found/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Scanning receipt…/)).not.toBeInTheDocument()
    expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
    if (onProcessingChange.mock.calls.length) {
      expect(onProcessingChange).toHaveBeenLastCalledWith(false)
    }

    mockUpload.mockResolvedValueOnce(ONE_ITEM)
    pick(container)
    await waitFor(() => expect(screen.getByText(/Found/)).toBeInTheDocument())
  })

  it('closing/navigating away mid-scan aborts the request', async () => {
    let signal: AbortSignal | undefined
    mockUpload.mockImplementationOnce((_f, opts) => {
      signal = opts?.signal
      return new Promise<ScanResult>(() => {})
    })
    const { container, unmount } = mount()
    pick(container)
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    expect(signal).toBeDefined()
    expect(signal!.aborted).toBe(false)

    unmount()
    expect(signal!.aborted).toBe(true)
  })

  it('a scan that settles after unmount is ignored without throwing', async () => {
    let resolve!: (r: ScanResult) => void
    mockUpload.mockImplementationOnce(() => new Promise<ScanResult>((r) => { resolve = r }))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { container, unmount, onProcessingChange } = mount()
    pick(container)
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => { resolve(ONE_ITEM) })
    expect(errorSpy).not.toHaveBeenCalled()
    expect(onProcessingChange).not.toHaveBeenCalledWith(false)
    errorSpy.mockRestore()
  })

  it('a double submit while processing sends one request', async () => {
    mockUpload.mockImplementation(() => new Promise<ScanResult>(() => {}))
    const { container } = mount()
    // Same input element thrice: the exit animation can leave it mounted, and
    // a double tap / drop lands before React has re-rendered anyway.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'receipt.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(input, { target: { files: [file] } })
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('Cancel scan aborts the request and returns to a usable upload state without an error', async () => {
    let signal: AbortSignal | undefined
    let rejectScan!: (e: Error) => void
    mockUpload.mockImplementationOnce((_f, opts) => {
      signal = opts?.signal
      return new Promise<ScanResult>((_r, rej) => { rejectScan = rej })
    })
    const { container, onProcessingChange } = mount()
    pick(container)
    await waitFor(() => expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /cancel scan/i }))

    expect(signal!.aborted).toBe(true)
    await waitFor(() => expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument())
    expect(screen.queryByText(/Scanning receipt…/)).not.toBeInTheDocument()
    if (onProcessingChange.mock.calls.length) {
      expect(onProcessingChange).toHaveBeenLastCalledWith(false)
    }

    // The aborted request rejecting afterwards must not surface a "too long" error.
    await act(async () => {
      rejectScan(new scanApi.ScanError('aborted', scanApi.SCAN_CLIENT_TIMEOUT_CODE))
    })
    expect(screen.queryByText(/taking too long/i)).not.toBeInTheDocument()

    // And a fresh scan works.
    mockUpload.mockResolvedValueOnce(ONE_ITEM)
    pick(container)
    await waitFor(() => expect(screen.getByText(/Found/)).toBeInTheDocument())
  })
})
