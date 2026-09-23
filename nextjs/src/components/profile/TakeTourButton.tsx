'use client'

import { useRouter } from 'next/navigation'
import { useTour } from '@/components/onboarding/TourProvider'
import SpringButton from '@/components/ui/SpringButton'

/**
 * Rendered inside the (server) profile page.
 * Calls openTour() from TourContext then navigates to `/` so the
 * globally-mounted TourOverlay is visible on the home route.
 */
export default function TakeTourButton() {
  const { openTour } = useTour()
  const router = useRouter()

  const handleClick = () => {
    openTour()
    router.push('/')
  }

  return (
    <SpringButton
      onClick={handleClick}
      className="w-full text-sm font-semibold px-4 py-3 rounded-2xl text-white"
      style={{ background: 'var(--color-primary)' }}
    >
      Take the tour ✨
    </SpringButton>
  )
}
