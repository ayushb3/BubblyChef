'use client'

import { useState } from 'react'
import Link from 'next/link'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import PixelPanel from '@/components/ui/PixelPanel'
import PixelSheet from '@/components/ui/PixelSheet'
import SpringButton from '@/components/ui/SpringButton'
import GroceryAddForm from '@/components/grocery/GroceryAddForm'
import GroceryLineRow from '@/components/grocery/GroceryLineRow'
import { useGroceryList } from '@/hooks/useGroceryList'
import { groupByHeading } from '@/lib/grocery-view'

/**
 * `/grocery` (issue #497, Spec B.5): the grocery list on its own page.
 *
 * Generated from the pantry (what ran out, what is about to expire), grouped by
 * food category, checkable, editable in place, shareable as plain text. The
 * list lives in this browser (`lib/grocery-store.ts`); nothing here writes to
 * the pantry or the database. Reached from the storage list's "Add to list",
 * the notification bell and the "N to buy" lines on a meal or recipe; it is not
 * a bottom-nav tab.
 */

const HEADING =
  'flex items-baseline gap-2 pb-1 text-base leading-[22px] font-bold text-[color:var(--color-text)]'

export default function GroceryPage() {
  const list = useGroceryList()
  const [notice, setNotice] = useState<string | null>(null)
  // The text to copy by hand, when neither sharing nor the clipboard worked.
  const [manualText, setManualText] = useState<string | null>(null)

  const toBuy = list.lines.filter((l) => !l.checked)
  const gotIt = list.lines.filter((l) => l.checked)
  const groups = groupByHeading(toBuy)

  async function onShare() {
    setNotice(null)
    const { result, text } = await list.share()
    if (result === 'copied') setNotice('Copied your list. Paste it into a message.')
    else if (result === 'unavailable') setManualText(text)
  }

  async function onRegenerate() {
    setNotice(null)
    await list.regenerate()
  }

  return (
    <div className="min-h-screen pb-24">
      <BubblesHeader
        rightSlot={
          <Link
            href="/"
            className="text-sm text-[var(--color-muted)] underline transition-colors hover:text-[var(--color-text)]"
          >
            Kitchen
          </Link>
        }
      />

      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 pt-4">
        <div>
          <h2 className="text-xl font-bold leading-[26px] text-[color:var(--color-text)]">
            <span aria-hidden="true">🛒 </span>
            Grocery list
          </h2>
          {list.status === 'ready' && (
            <p
              data-testid="grocery-count"
              className="text-[13px] leading-[18px] font-bold tabular-nums text-[color:var(--color-text)]"
            >
              {list.toBuyCount} to buy
            </p>
          )}
        </div>

        {list.status === 'loading' && (
          <div
            data-testid="grocery-loading"
            role="status"
            aria-busy="true"
            className="flex flex-col gap-3"
          >
            <span className="sr-only">Loading your grocery list</span>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden="true"
                className="block h-14 animate-pulse rounded-2xl motion-reduce:animate-none"
                style={{ background: 'var(--color-border)' }}
              />
            ))}
          </div>
        )}

        {list.status === 'signed-out' && (
          <p className="text-sm font-bold text-[color:var(--color-text)]">
            Sign in to use your grocery list.
          </p>
        )}

        {list.status === 'ready' && (
          <>
            <div className="flex gap-2">
              <SpringButton
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={onRegenerate}
                loading={list.regenerating}
                disabled={list.regenerating}
              >
                Regenerate
              </SpringButton>
              <SpringButton
                variant="primary"
                size="sm"
                className="flex-1"
                onClick={onShare}
                disabled={toBuy.length === 0}
              >
                Share
              </SpringButton>
            </div>

            {list.pantryError && (
              <p
                role="alert"
                className="rounded-xl border-2 px-3 py-2 text-[13px] leading-[18px] font-bold text-[color:var(--color-text)]"
                style={{
                  borderColor: 'var(--color-expired-text)',
                  background: 'var(--color-expired)',
                }}
              >
                Couldn&apos;t check your pantry just now, so this is your saved list. Try
                Regenerate again in a moment.
              </p>
            )}
            {notice && (
              <p role="status" className="text-[13px] leading-[18px] font-bold text-[color:var(--color-text)]">
                {notice}
              </p>
            )}

            <GroceryAddForm onAdd={list.add} />

            {list.lines.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-8 text-center text-[color:var(--color-text)]">
                <div className="mb-2">
                  <BubblesMascot state="happy" size={88} />
                </div>
                <p className="text-base font-bold">Nothing on your list</p>
                <p className="text-sm font-semibold opacity-80">
                  Everything is stocked. Add anything you want to pick up.
                </p>
              </div>
            )}

            {groups.map((g) => {
              const id = `grocery-group-${g.label.toLowerCase().replace(/[^a-z]+/g, '-')}`
              return (
                <PixelPanel key={g.label} as="section" aria-labelledby={id} contentClassName="px-3 py-2">
                  <h3 id={id} className={HEADING}>
                    {g.label}
                    <span className="text-[13px] font-extrabold tabular-nums">{g.lines.length}</span>
                  </h3>
                  <ul>
                    {g.lines.map((line) => (
                      <GroceryLineRow
                        key={line.key}
                        line={line}
                        onToggle={(checked) => list.setChecked(line.key, checked)}
                        onSetAmount={(q, u) => list.setAmount(line.key, q, u)}
                        onRemove={() => list.remove(line.key)}
                      />
                    ))}
                  </ul>
                </PixelPanel>
              )
            })}

            {gotIt.length > 0 && (
              <PixelPanel as="section" aria-labelledby="grocery-got-it" contentClassName="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="grocery-got-it" className={HEADING}>
                    Got it
                    <span className="text-[13px] font-extrabold tabular-nums">{gotIt.length}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={list.clearChecked}
                    className="min-h-[44px] shrink-0 px-2.5 text-[13px] font-extrabold text-[color:var(--color-text)] underline underline-offset-[3px]"
                  >
                    Clear got it
                  </button>
                </div>
                <ul>
                  {gotIt.map((line) => (
                    <GroceryLineRow
                      key={line.key}
                      line={line}
                      onToggle={(checked) => list.setChecked(line.key, checked)}
                      onSetAmount={(q, u) => list.setAmount(line.key, q, u)}
                      onRemove={() => list.remove(line.key)}
                    />
                  ))}
                </ul>
              </PixelPanel>
            )}
          </>
        )}
      </div>

      <PixelSheet
        open={manualText !== null}
        onClose={() => setManualText(null)}
        title="Copy your list"
        subtitle="Sharing isn't available. Copy it here."
      >
        <textarea
          readOnly
          aria-label="Your grocery list"
          value={manualText ?? ''}
          rows={Math.min(12, Math.max(4, (manualText ?? '').split('\n').length + 1))}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-xl border-2 bg-[var(--color-surface)] p-3 text-[14px] font-bold text-[color:var(--color-text)]"
          style={{ borderColor: 'var(--color-text)' }}
        />
      </PixelSheet>
    </div>
  )
}
