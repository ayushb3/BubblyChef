/**
 * Issue #840: the add sheet's scan tab shows the same idle, upload and
 * processing surfaces as `/scan` (`ScanDropzone`): a PixelPanel dropzone with a
 * Choose a photo keycap, and a processing panel with stepped dots. `/scan`'s own
 * side is pinned in scan-page-signature.test.tsx; the tab's state machine
 * (guards, cancel, hand-off) in the scan-tab-* and scan-handoff tests.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScanTab from '@/components/pantry/ScanTab'
import * as scanApi from '@/lib/api/scan'

jest.mock('@/lib/api/scan', () => {
  const actual = jest.requireActual('@/lib/api/scan')
  return { ...actual, uploadReceipt: jest.fn() }
})

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

describe('add-sheet scan tab signature restyle', () => {
  it('draws the dropzone as a pixel panel with a Choose a photo keycap, no dashed border', () => {
    const { container } = render(<ScanTab onParsed={jest.fn()} />)
    const panel = container.querySelector('[data-pixel-panel]')
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(screen.getByText(/Drop your receipt here/))
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Choose a photo' }))
    expect(container.querySelector('.border-dashed')).toBeNull()
  })

  it('the Choose a photo keycap opens the file picker', () => {
    const { container } = render(<ScanTab onParsed={jest.fn()} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const click = jest.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Choose a photo' }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('a file dropped on the panel starts the scan, and dragging over it arms the copy', async () => {
    mockUploadReceipt.mockReturnValue(new Promise(() => {}))
    const { container } = render(<ScanTab onParsed={jest.fn()} />)
    const panel = container.querySelector('[data-pixel-panel]') as HTMLElement

    fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'] } })
    expect(screen.getByText(/Drop it here!/)).toBeInTheDocument()
    fireEvent.dragLeave(panel)
    expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()

    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' })
    fireEvent.drop(panel, { dataTransfer: { files: [file], types: ['Files'] } })
    await waitFor(() => expect(mockUploadReceipt).toHaveBeenCalledWith(file, expect.anything()))
  })

  it('processing is a pixel panel with the preview, stepped dots and Cancel scan', async () => {
    mockUploadReceipt.mockReturnValue(new Promise(() => {}))
    const { container } = render(<ScanTab onParsed={jest.fn()} />)
    const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })

    await waitFor(() => expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument())
    const panel = container.querySelector('[data-pixel-panel]')
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(screen.getByAltText('Receipt preview'))
    expect(panel).toContainElement(screen.getByTestId('keycap-loading-dots'))
    expect(panel).toContainElement(screen.getByRole('button', { name: /cancel scan/i }))
  })
})
