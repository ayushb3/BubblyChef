'use client'

/**
 * Hand a parsed receipt scan to the kitchen (issue #753).
 *
 * Both scan entry points (the `/scan` page and the pantry add sheet's scan tab)
 * end here: the parsed result is kept as the pending put-away and the user goes
 * to home, where the put-away sheet opens over the scene. Nothing is written to
 * the pantry: that happens on "Put away", and only then.
 */
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { ScanResult } from '@/types/scan'
import { pendingFromScan, savePendingPutAway } from '@/lib/kitchen/pending-putaway'

export function useScanHandOff(): (result: ScanResult) => void {
  const router = useRouter()
  return useCallback(
    (result: ScanResult) => {
      savePendingPutAway(pendingFromScan(result))
      router.push('/')
    },
    [router],
  )
}
