'use client'

/**
 * The kitchen home's header (issue #748; board A): a "<Weekday> <part of day>"
 * eyebrow over the title "Your kitchen", then the pixel bubbles counter. The
 * notification bell and profile button stay, at the right (the board omits them;
 * with the Pantry tab going, they are how Profile stays reachable).
 *
 * The strip itself is the shared `PageHeader` (also `/scan`'s, issue #840).
 *
 * `eyebrow` is empty until the client's clock is known: the weekday and part of
 * day depend on the viewer's timezone, so the server and the first client pass
 * render the same neutral (empty) line, and `HeroHome` fills it in after
 * hydration. The line keeps its height either way, so nothing shifts.
 *
 * `balance` is `null` while it is unknown (loading or failed): the counter is
 * hidden rather than flashing a `0`. Its slot is reserved, so the title does not
 * jump when the balance lands.
 *
 * The header is `relative z-10` (passed to `PageHeader`) so it paints over the wall
 * below it: the counter's "+N" tag hangs under the counter, over the wall's top edge
 * (issue #839).
 */
import BubblesCounter from '@/components/ui/BubblesCounter'
import PageHeader from '@/components/layout/PageHeader'
import NotificationBell from '@/components/layout/NotificationBell'
import ProfileHeaderButton from '@/components/layout/ProfileHeaderButton'

export interface KitchenHeaderProps {
  eyebrow: string
  balance: number | null
}

export default function KitchenHeader({ eyebrow, balance }: KitchenHeaderProps) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      eyebrowTestId="kitchen-eyebrow"
      title="Your kitchen"
      className="relative z-10"
    >
      <div className="mr-1 flex min-w-[76px] justify-end" data-testid="kitchen-bubbles-balance-group">
        {balance !== null && <BubblesCounter value={balance} testId="kitchen-bubbles-balance" />}
      </div>
      <NotificationBell />
      <ProfileHeaderButton />
    </PageHeader>
  )
}
