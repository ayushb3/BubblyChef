/**
 * Issue #439 — closing the add-to-pantry sheet mid-scan and reopening it to
 * start a new scan let the abandoned scan's `finally` clear the shared
 * `scanProcessing` lock once it eventually settled, even though a newer scan
 * was still running. Reproduced in a running build: start a scan, close the
 * sheet before it finishes, reopen and start a second scan, then let the
 * first (abandoned) scan's slow response land — it silently unlocked the
 * Type tab out from under the second scan.
 *
 * `scanProcessing` lives in the parent (`PantryAddSheet`) and survives the
 * sheet's inner content unmounting/remounting on close/reopen, so the two
 * scans here are modelled as two separate `ScanTab` mounts sharing the same
 * `onProcessingChange` callback — exactly what happens across a close+reopen.
 */

import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react'
import ScanTab from '@/components/pantry/ScanTab'
import * as scanApi from '@/lib/api/scan'
import type { ScanResult } from '@/types/scan'

jest.mock('@/lib/api/scan', () => {
  const actual = jest.requireActual('@/lib/api/scan')
  return {
    ...actual,
    uploadReceipt: jest.fn(),
  }
})

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

const SCAN_RESULT: ScanResult = {
  ocr_text: '',
  ready_to_add: [],
  needs_review: [],
  skipped: [],
  total_items: 0,
  warnings: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

function selectFile(container: HTMLElement) {
  const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [file] } })
}

it('an abandoned scan settling does not clear processing while a newer scan is running', async () => {
  let resolveA!: (result: ScanResult) => void
  let resolveB!: (result: ScanResult) => void
  mockUploadReceipt
    .mockReturnValueOnce(new Promise<ScanResult>((resolve) => { resolveA = resolve }))
    .mockReturnValueOnce(new Promise<ScanResult>((resolve) => { resolveB = resolve }))

  const onProcessingChange = jest.fn()

  // Scan A starts, then the sheet is closed (ScanTab A unmounts) before it settles.
  const { container: containerA, unmount: unmountA } = render(
    <ScanTab onItemsReady={jest.fn()} onProcessingChange={onProcessingChange} />,
  )
  selectFile(containerA)
  await waitFor(() => expect(mockUploadReceipt).toHaveBeenCalledTimes(1))
  expect(onProcessingChange).toHaveBeenLastCalledWith(true)

  unmountA()

  // The sheet reopens: a fresh ScanTab mount (B), sharing the same
  // onProcessingChange callback (it lives on the persistent parent).
  const { container: containerB } = render(
    <ScanTab onItemsReady={jest.fn()} onProcessingChange={onProcessingChange} />,
  )
  selectFile(containerB)
  await waitFor(() => expect(mockUploadReceipt).toHaveBeenCalledTimes(2))
  expect(onProcessingChange).toHaveBeenLastCalledWith(true)

  // A's abandoned request finally settles — must NOT clear the lock B holds.
  resolveA(SCAN_RESULT)
  await Promise.resolve()
  await Promise.resolve()
  expect(onProcessingChange).not.toHaveBeenCalledWith(false)

  // B settling does clear it.
  resolveB(SCAN_RESULT)
  await waitFor(() => expect(onProcessingChange).toHaveBeenCalledWith(false))
})
