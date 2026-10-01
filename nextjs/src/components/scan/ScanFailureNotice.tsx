'use client'

import BubblesMascot, { type BubblesState } from '@/components/ui/BubblesMascot'
import PixelPanel from '@/components/ui/PixelPanel'
import SpringButton from '@/components/ui/SpringButton'
import { SCAN_NOT_AN_IMAGE_CODE } from '@/lib/api/scan'
import { scanErrorCopy, SCAN_NO_ITEMS_CODE } from '@/lib/scan-error-copy'

/**
 * ScanFailureNotice: every scan failure and empty state, in the pixel language
 * (issue #642, visual half).
 *
 * Presentation-only, shared by both scan entry points (the `/scan` route and the
 * add sheet's `ScanTab`), the way `ReviewSurface` is shared (issue #259): a
 * `PixelPanel` with Bubbles beside the message and one `SpringButton` keycap to
 * try again. The words come from `scanErrorCopy` and nowhere else, so a raw
 * server or network string cannot reach the screen through here. It owns no scan
 * state: the host decides when it shows and what "try again" does.
 *
 * Contract for the hosts:
 *  - `code`: the scan failure code (a `ScanError.code`, `SCAN_NO_ITEMS_CODE` for a
 *    scan that parsed nothing, or any string: unknown codes get the generic copy).
 *  - `onRetry`: runs when the keycap is pressed. Both hosts open the file picker.
 *
 * It is a `role="alert"` so a screen reader hears the failure when it appears.
 * Bubbles looks worried when the service or the connection failed, and thinks
 * when the photo is the problem (nothing found, unreadable, not a photo).
 */

const PHOTO_PROBLEM_CODES = new Set<string>([
  SCAN_NO_ITEMS_CODE,
  'unreadable_image',
  SCAN_NOT_AN_IMAGE_CODE,
])

export function scanFailureSprite(code: string): BubblesState {
  return PHOTO_PROBLEM_CODES.has(code) ? 'thinking' : 'worried'
}

interface ScanFailureNoticeProps {
  code: string
  onRetry: () => void
}

export default function ScanFailureNotice({ code, onRetry }: ScanFailureNoticeProps) {
  return (
    <PixelPanel entrance role="alert" className="mb-5" data-testid="scan-failure">
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <BubblesMascot state={scanFailureSprite(code)} size={56} />
        </div>
        <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-[var(--color-text)]">
          {scanErrorCopy(code)}
        </p>
      </div>
      <div className="mt-3">
        <SpringButton variant="primary" fullWidth onClick={onRetry}>
          Choose a photo
        </SpringButton>
      </div>
    </PixelPanel>
  )
}
