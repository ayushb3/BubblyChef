/**
 * Issue #403 — the scan dropzone's copy ("Drop your receipt here / or tap to
 * upload") promised drag-and-drop, but the element was a plain click button:
 * dragging a file onto it fell through to the browser's own default (open/
 * navigate to the file) instead of being ingested. Covers both the shared
 * `useFileDropzone` hook and its wiring into `ScanTab`, the pantry add-sheet's
 * scan tab — `/scan` (`app/scan/page.tsx`) uses the identical hook and is not
 * re-tested here since the hook itself is what's under test.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react'
import ScanTab from '@/components/pantry/ScanTab'
import { useFileDropzone } from '@/hooks/useFileDropzone'
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

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

function makeDataTransfer(files: File[]) {
  return {
    files,
    types: ['Files'],
    dropEffect: 'none',
  } as unknown as DataTransfer
}

describe('useFileDropzone', () => {
  it('calls onFile with a dropped image and prevents the browser default', () => {
    const onFile = jest.fn()
    const { result } = renderHook(() => useFileDropzone({ onFile }))

    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' })
    const preventDefault = jest.fn()
    const stopPropagation = jest.fn()

    act(() => {
      result.current.dropzoneHandlers.onDrop({
        preventDefault,
        stopPropagation,
        dataTransfer: makeDataTransfer([file]),
      } as unknown as React.DragEvent)
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('calls preventDefault on dragover on every fire, not just once', () => {
    const { result } = renderHook(() => useFileDropzone({ onFile: jest.fn() }))
    const preventDefault = jest.fn()

    act(() => {
      result.current.dropzoneHandlers.onDragOver({
        preventDefault,
        stopPropagation: jest.fn(),
        dataTransfer: { dropEffect: 'none' },
      } as unknown as React.DragEvent)
      result.current.dropzoneHandlers.onDragOver({
        preventDefault,
        stopPropagation: jest.fn(),
        dataTransfer: { dropEffect: 'none' },
      } as unknown as React.DragEvent)
    })

    expect(preventDefault).toHaveBeenCalledTimes(2)
  })

  it('ignores a non-image drop rather than passing it through', () => {
    const onFile = jest.fn()
    const { result } = renderHook(() => useFileDropzone({ onFile }))
    const pdf = new File(['bytes'], 'receipt.pdf', { type: 'application/pdf' })

    act(() => {
      result.current.dropzoneHandlers.onDrop({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: makeDataTransfer([pdf]),
      } as unknown as React.DragEvent)
    })

    expect(onFile).not.toHaveBeenCalled()
  })

  it('takes the first accepted image when multiple files are dropped', () => {
    const onFile = jest.fn()
    const { result } = renderHook(() => useFileDropzone({ onFile }))
    const pdf = new File(['bytes'], 'notes.pdf', { type: 'application/pdf' })
    const image1 = new File(['bytes'], 'first.png', { type: 'image/png' })
    const image2 = new File(['bytes'], 'second.png', { type: 'image/png' })

    act(() => {
      result.current.dropzoneHandlers.onDrop({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: makeDataTransfer([pdf, image1, image2]),
      } as unknown as React.DragEvent)
    })

    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(image1)
  })

  it('arms on dragenter and resets on dragleave', () => {
    const { result } = renderHook(() => useFileDropzone({ onFile: jest.fn() }))

    act(() => {
      result.current.dropzoneHandlers.onDragEnter({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { types: ['Files'] },
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragActive).toBe(true)

    act(() => {
      result.current.dropzoneHandlers.onDragLeave({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragActive).toBe(false)
  })

  it('resets the armed state after a drop', () => {
    const { result } = renderHook(() => useFileDropzone({ onFile: jest.fn() }))
    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' })

    act(() => {
      result.current.dropzoneHandlers.onDragEnter({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { types: ['Files'] },
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragActive).toBe(true)

    act(() => {
      result.current.dropzoneHandlers.onDrop({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: makeDataTransfer([file]),
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragActive).toBe(false)
  })
})

describe('ScanTab drag-and-drop', () => {
  const SCAN_RESULT: ScanResult = {
    ocr_text: 'MILK 4.29',
    ready_to_add: [
      {
        name: 'Whole Milk',
        original_name: 'whole milk',
        source_line: 'MILK 4.29',
        price: 4.29,
        quantity: 1,
        unit: 'gallon',
        category: 'dairy',
        location: 'fridge',
        confidence: 0.95,
      },
    ],
    needs_review: [],
    skipped: [],
    total_items: 1,
    warnings: [],
  }

  it('a dropped file reaches the same upload path as the file picker', async () => {
    mockUploadReceipt.mockResolvedValue(SCAN_RESULT)
    render(<ScanTab onItemsReady={jest.fn()} />)

    const dropzone = screen.getByText(/Drop your receipt here/).closest('button')
    expect(dropzone).not.toBeNull()

    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' })
    fireEvent.drop(dropzone as HTMLButtonElement, {
      dataTransfer: { files: [file], types: ['Files'] },
    })

    await waitFor(() => expect(mockUploadReceipt).toHaveBeenCalledWith(file))
    await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())
  })

  it('shows an armed visual state on dragenter and clears it on dragleave', () => {
    render(<ScanTab onItemsReady={jest.fn()} />)
    const dropzone = screen.getByText(/Drop your receipt here/).closest('button') as HTMLButtonElement

    fireEvent.dragEnter(dropzone, { dataTransfer: { types: ['Files'] } })
    expect(screen.getByText(/Drop it here!/)).toBeInTheDocument()

    fireEvent.dragLeave(dropzone)
    expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
  })

  it('click-to-upload still works unchanged', async () => {
    mockUploadReceipt.mockResolvedValue(SCAN_RESULT)
    render(<ScanTab onItemsReady={jest.fn()} />)

    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())
  })
})
