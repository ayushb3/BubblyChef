'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Shared drag-and-drop wiring for the receipt-scan upload zones — issue
 * #403. Both `ScanTab` (the pantry add-sheet's "scan" tab) and the
 * full-page `/scan` route render an identical dropzone whose copy reads
 * "Drop your receipt here", but until now neither actually listened for
 * drag events: it was a `<button>` that opened the file picker on click,
 * so dragging a file onto it fell through to the browser's own default
 * (navigate to/open the file) instead of being ingested. This hook owns
 * just the drag lifecycle and handoff to the caller's existing
 * `handleFileSelect`, so both call sites stay on the exact same upload
 * path a picked file already uses — no duplicated upload logic.
 *
 * Getting `dragover` wrong is the usual reason drop silently fails:
 * `drop` only fires, and the browser only skips its own "open this file"
 * behaviour, if `dragover` calls `preventDefault()` on *every* fire (it
 * fires repeatedly while the pointer moves over the target, not once).
 * `dragenter`/`dragleave` are what drive the visible "armed" state — they
 * can fire on child elements as the pointer moves within the dropzone, so
 * a plain counter (rather than a boolean flip) is used to avoid the
 * state flickering off while still over the zone but between children.
 */

interface UseFileDropzoneOptions {
  /** Invoked with the first accepted file dropped (or picked). */
  onFile: (file: File) => void
  /** Matches the file input's own `accept="image/*"` — only images pass. */
  accept?: (file: File) => boolean
}

export interface FileDropzoneHandlers {
  onDragEnter: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

const defaultAccept = (file: File) => file.type.startsWith('image/')

export function useFileDropzone({ onFile, accept = defaultAccept }: UseFileDropzoneOptions): {
  isDragActive: boolean
  dropzoneHandlers: FileDropzoneHandlers
} {
  const [isDragActive, setIsDragActive] = useState(false)
  // Counts nested enter/leave pairs rather than toggling a boolean directly
  // — dragenter/dragleave fire for the dropzone's own children (the mascot
  // image, the two <p> lines) as the pointer crosses between them, and a
  // naive boolean would flicker the armed state off mid-hover.
  const dragCounter = useRef(0)

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only arm for an actual file drag, not e.g. dragging selected text.
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounter.current += 1
      setIsDragActive(true)
    }
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    // Required on every fire, not just dragenter/drop — a dragover handler
    // that never calls preventDefault() is what makes the browser treat the
    // element as an invalid drop target and fall through to its own default
    // (navigating to/opening the dropped file) once the pointer is released.
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDragActive(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      // Prevents the browser's default "open the dropped file" navigation —
      // without this the drop event still fires, but so does the browser's
      // own handling of it.
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragActive(false)

      const files = Array.from(e.dataTransfer?.files ?? [])
      // Multiple files dropped at once: take the first accepted one rather
      // than erroring — matches "drop your receipt" being a single-item
      // affordance everywhere else in this flow.
      const file = files.find(accept)
      if (file) onFile(file)
      // A non-image (PDF, folder, etc.) is silently ignored, mirroring what
      // `accept="image/*"` already does for the file picker — the browser
      // never even offers non-images there, so drop shouldn't behave worse
      // than pick by uploading garbage.
    },
    [accept, onFile],
  )

  return { isDragActive, dropzoneHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
