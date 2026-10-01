'use client'

import BubblesMascot from '@/components/ui/BubblesMascot'
import PixelPanel from '@/components/ui/PixelPanel'
import SpringButton, { PixelDots } from '@/components/ui/SpringButton'
import type { FileDropzoneHandlers } from '@/hooks/useFileDropzone'

/**
 * The scan surfaces for the idle, processing and hand-off steps, in the pixel
 * language (issue #840). Presentation-only and shared by both scan entry points,
 * the `/scan` route and the add sheet's `ScanTab`, the way `ScanFailureNotice`
 * and `ReviewSurface` are: each host keeps its own state machine (upload,
 * guards, cancel, hand-off) and just draws these.
 *
 * `ScanDropzone` (idle): a `PixelPanel` that is the drop target, with Bubbles,
 * a line of copy and a "Choose a photo" keycap that is the tap target (a button
 * cannot hold a button, so the zone itself is no longer a button).
 *  - `dropzoneHandlers` / `isDragActive`: from `useFileDropzone`. Armed, the panel
 *    scales 1.02 (not under reduced motion), Bubbles looks surprised and the copy
 *    reads "Drop it here!".
 *  - `onChoose`: the keycap's tap; hosts open the file picker.
 *  - `hasError`: a failure notice is showing above. The notice carries the primary
 *    key, so this one steps back to secondary: one primary action on screen.
 *
 * `ScanProcessingPanel`: the receipt preview in an ink frame, thinking Bubbles,
 * the keycap's stepped dots and "Cancel scan" (`onCancel`).
 *
 * `ScanHandoffPanel`: the brief "taking your shopping to the kitchen" beat
 * (`role="status"`).
 */

interface ScanDropzoneProps {
  isDragActive: boolean
  dropzoneHandlers: FileDropzoneHandlers
  onChoose: () => void
  hasError?: boolean
}

export default function ScanDropzone({
  isDragActive,
  dropzoneHandlers,
  onChoose,
  hasError = false,
}: ScanDropzoneProps) {
  return (
    <PixelPanel
      {...dropzoneHandlers}
      data-drag-active={isDragActive || undefined}
      className={`text-center transition-transform motion-reduce:transition-none ${
        isDragActive ? 'scale-[1.02]' : ''
      }`}
      contentClassName="p-6"
    >
      <div className="flex justify-center mb-3">
        <BubblesMascot state={isDragActive ? 'surprised' : 'happy'} size={72} />
      </div>
      <p className="font-extrabold text-[var(--color-text)] mb-1">
        {isDragActive ? 'Drop it here!' : 'Drop your receipt here'}
      </p>
      <p className="text-sm text-[var(--color-muted)] mb-4">
        Bubbles reads the items; nothing goes in until you say so.
      </p>
      <SpringButton variant={hasError ? 'secondary' : 'primary'} fullWidth onClick={onChoose}>
        Choose a photo
      </SpringButton>
    </PixelPanel>
  )
}

export function ScanProcessingPanel({
  preview,
  onCancel,
}: {
  preview: string | null
  onCancel: () => void
}) {
  return (
    <PixelPanel className="text-center" contentClassName="p-6">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Receipt preview"
          className="mb-4 max-h-48 w-full border-[3px] border-[var(--color-text)] bg-[var(--color-bg)] object-contain"
        />
      )}
      <div className="flex justify-center mb-3">
        <BubblesMascot state="thinking" size={64} />
      </div>
      <div className="flex items-center justify-center gap-3 text-[var(--color-text)]">
        <PixelDots />
        <p className="font-extrabold">Scanning receipt…</p>
      </div>
      <p className="text-sm text-[var(--color-muted)] mt-2">Bubbles is reading your items</p>
      <div className="mt-4 flex justify-center">
        <SpringButton variant="secondary" size="sm" onClick={onCancel}>
          Cancel scan
        </SpringButton>
      </div>
    </PixelPanel>
  )
}

export function ScanHandoffPanel() {
  return (
    <PixelPanel className="text-center" contentClassName="p-6">
      <div className="flex justify-center mb-3">
        <BubblesMascot state="happy" size={72} />
      </div>
      <p className="font-extrabold text-[var(--color-text)]">
        Taking your shopping to the kitchen…
      </p>
    </PixelPanel>
  )
}
