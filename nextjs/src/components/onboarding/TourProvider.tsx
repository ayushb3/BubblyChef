'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TOUR_STEPS } from './steps'

const TOTAL_STEPS = TOUR_STEPS.length

interface TourContextValue {
  isOpen: boolean
  stepIndex: number
  openTour: () => void
  closeTour: () => void
  goNext: () => void
  goBack: () => void
  totalSteps: number
}

const TourContext = createContext<TourContextValue | null>(null)

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used inside TourProvider')
  return ctx
}

/**
 * Marks the current Supabase user as having completed onboarding.
 * Verifies a session exists before calling updateUser so the flag is
 * actually persisted for first-run guests (whose anonymous session may
 * have been in flight when the tour opened). Swallows all errors — the
 * tour is UX, not critical data.
 */
async function markOnboardingComplete(): Promise<void> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.auth.updateUser({ data: { onboarding_completed: true } })
  } catch {
    // non-fatal
  }
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const pathname = usePathname()
  // Prevent re-triggering auto-open when the flag is already set for this mount.
  const hasAutoOpenedRef = useRef(false)

  // Auto-open the first time '/' is reached and the flag is not set.
  // Uses usePathname() so a user who lands first on another route (e.g. /login)
  // and then SPA-navigates into '/' still gets it — the ref is only set once we
  // actually reach '/'. It does NOT re-open on a later return to '/' within the
  // same mount (by design: once per mount; the persisted flag governs re-visits).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (pathname !== '/') return
    // Only attempt once per provider mount — don't re-check on every re-render.
    if (hasAutoOpenedRef.current) return
    hasAutoOpenedRef.current = true

    const run = async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        const completed = user?.user_metadata?.onboarding_completed === true
        if (!completed) {
          setIsOpen(true)
          setStepIndex(0)
        }
      } catch {
        // non-fatal — skip auto-open
      }
    }
    run()
  }, [pathname])

  const openTour = useCallback(() => {
    setStepIndex(0)
    setIsOpen(true)
  }, [])

  const closeTour = useCallback(async () => {
    setIsOpen(false)
    await markOnboardingComplete()
  }, [])

  const goNext = useCallback(async () => {
    if (stepIndex >= TOTAL_STEPS - 1) {
      // "Done" — finish
      setIsOpen(false)
      await markOnboardingComplete()
    } else {
      setStepIndex((i) => i + 1)
    }
  }, [stepIndex])

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  return (
    <TourContext.Provider
      value={{ isOpen, stepIndex, openTour, closeTour, goNext, goBack, totalSteps: TOTAL_STEPS }}
    >
      {children}
    </TourContext.Provider>
  )
}
