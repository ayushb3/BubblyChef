'use client'

/**
 * The kitchen home's header (issue #748; board A): a "<Weekday> <part of day>"
 * eyebrow over the title "Your kitchen", then the pixel bubbles counter. The
 * notification bell and profile button stay, at the right (the board omits them;
 * with the Pantry tab going, they are how Profile stays reachable).
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
 * The header is `relative z-10` so it paints over the wall below it: the counter's
 * "+N" tag hangs under the counter, over the wall's top edge (issue #839).
 */
import BubblesCounter from '@/components/ui/BubblesCounter'
import NotificationBell from '@/components/layout/NotificationBell'
import ProfileHeaderButton from '@/components/layout/ProfileHeaderButton'

export interface KitchenHeaderProps {
  eyebrow: string
  balance: number | null
}

export default function KitchenHeader({ eyebrow, balance }: KitchenHeaderProps) {
  return (
    <header className="relative z-10 flex min-h-[58px] flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-1.5 max-[359px]:px-3">
      {/* The title never truncates: it steps down to 20px on narrow phones, and
          if the counter still does not fit beside it (a 4-digit balance on a
          320px screen) the controls wrap to a second row rather than eat it. */}
      <div className="min-w-fit flex-1">
        <p
          data-testid="kitchen-eyebrow"
          className="h-4 text-xs leading-4 font-bold tracking-wide text-[color:var(--color-text)] uppercase"
        >
          {eyebrow}
        </p>
        <h1 className="text-2xl leading-[30px] font-bold whitespace-nowrap text-[color:var(--color-text)] max-[379px]:text-xl">
          Your kitchen
        </h1>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <div className="mr-1 flex min-w-[76px] justify-end" data-testid="kitchen-bubbles-balance-group">
          {balance !== null && (
            <BubblesCounter value={balance} testId="kitchen-bubbles-balance" />
          )}
        </div>
        <NotificationBell />
        <ProfileHeaderButton />
      </div>
    </header>
  )
}
