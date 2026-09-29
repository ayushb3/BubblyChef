// DEV-ONLY fixture page for issue #649 (meal scheduler + timeline table).
// Renders MealTimelineTable against the realistic fixture meals in
// @/lib/meal-fixtures, with a start-now / serve-at toggle, so the scheduler
// and table are verifiable end to end before the real meal screen (a later
// ticket) exists. The meal screen mounts the same MealTimelineTable with
// real data. Hidden in production — see the client component's own notice.
import { notFound } from 'next/navigation'
import MealTimelineDemoClient from './Client'

export default function MealTimelineDemoPage() {
  // VERCEL_ENV, not NODE_ENV like cook-prototype: verify runs a production
  // build and Vercel previews need the page. It serves pure fixtures (no auth,
  // no data), so a non-Vercel production build showing it is harmless.
  if (process.env.VERCEL_ENV === 'production') {
    notFound()
  }
  return <MealTimelineDemoClient />
}
