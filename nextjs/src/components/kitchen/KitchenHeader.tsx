'use client'

/**
 * The kitchen home's header (issue #748; board A): a "<Weekday> <part of day>"
 * eyebrow over the title "Your kitchen". The notification bell and profile button
 * sit at the right (the board omits them; with the Pantry tab going, they are how
 * Profile stays reachable). The bubbles counter is not here: it is the scene's HUD,
 * in the wall's top-right corner (issue #907, `KitchenBalance`).
 *
 * The strip itself is the shared `PageHeader` (also `/scan`'s, issue #840).
 *
 * `eyebrow` is empty until the client's clock is known: the weekday and part of
 * day depend on the viewer's timezone, so the server and the first client pass
 * render the same neutral (empty) line, and `HeroHome` fills it in after
 * hydration. The line keeps its height either way, so nothing shifts.
 */
import PageHeader from '@/components/layout/PageHeader'
import NotificationBell from '@/components/layout/NotificationBell'
import ProfileHeaderButton from '@/components/layout/ProfileHeaderButton'

export interface KitchenHeaderProps {
  eyebrow: string
}

export default function KitchenHeader({ eyebrow }: KitchenHeaderProps) {
  return (
    <PageHeader eyebrow={eyebrow} eyebrowTestId="kitchen-eyebrow" title="Your kitchen">
      <NotificationBell />
      <ProfileHeaderButton />
    </PageHeader>
  )
}
