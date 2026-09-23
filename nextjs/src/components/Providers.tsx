'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ThemeProvider } from './ThemeProvider'
import { TourProvider } from './onboarding/TourProvider'
import { TourOverlay } from './onboarding/TourOverlay'

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
        <TourProvider>
          {children}
          <TourOverlay />
        </TourProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
