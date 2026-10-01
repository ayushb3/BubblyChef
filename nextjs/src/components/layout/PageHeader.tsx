'use client'

/**
 * PageHeader: the signature page header, shared (issue #840).
 *
 * The header the kitchen home draws (issue #748, board A): a small uppercase
 * eyebrow over a bold title, then the page's controls at the right. It was
 * `KitchenHeader`'s own markup; `/scan` needed the same strip, so it lives here
 * and `KitchenHeader` composes it. Nunito throughout: pixel lettering is for
 * in-world elements only.
 *
 * Contract for the hosts:
 *  - `title`: the page's `h1`. It never truncates: it steps down to 20px on
 *    narrow phones, and if the controls still do not fit beside it they wrap to
 *    a second row rather than eat it.
 *  - `eyebrow`: the line above it. May be an empty string (the kitchen's is empty
 *    until the client clock is known); the line keeps its height either way, so
 *    nothing shifts. `eyebrowTestId` is a test hook for it.
 *  - `children`: the controls, laid out in a right-aligned row.
 */
import type { ReactNode } from 'react'

export interface PageHeaderProps {
  eyebrow: string
  title: string
  eyebrowTestId?: string
  children?: ReactNode
}

export default function PageHeader({ eyebrow, title, eyebrowTestId, children }: PageHeaderProps) {
  return (
    <header className="flex min-h-[58px] flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-1.5 max-[359px]:px-3">
      <div className="min-w-fit flex-1">
        <p
          data-testid={eyebrowTestId}
          className="h-4 text-xs leading-4 font-bold tracking-wide text-[color:var(--color-text)] uppercase"
        >
          {eyebrow}
        </p>
        <h1 className="text-2xl leading-[30px] font-bold whitespace-nowrap text-[color:var(--color-text)] max-[379px]:text-xl">
          {title}
        </h1>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>
    </header>
  )
}
