'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ThemeProvider } from './ThemeProvider'
import { TourProvider } from './onboarding/TourProvider'
import { TourOverlay } from './onboarding/TourOverlay'
import BubblePop from './ui/BubblePop'
import { CookingTimersProvider } from '@/lib/useCookingTimers'
import TimerDock from './timers/TimerDock'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CookingTimersProvider>
          <TourProvider>
            {children}
            <TourOverlay />
          </TourProvider>
          {/* Mounted alongside routed content (not inside it) so timers
              survive navigation and the dock stays visible on every route
              (issue #495). */}
          <TimerDock />
        </CookingTimersProvider>
      </ThemeProvider>
      <BubblePop />
    </QueryClientProvider>
  )
}
