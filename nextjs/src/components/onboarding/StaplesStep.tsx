'use client'

/**
 * First-run "Tick what you usually have" (issue #853).
 *
 * A sheet shown once, before the coach-mark tour (and again whenever the user
 * opens it from Profile): about two dozen common staples in four groups to tap,
 * plus household size, which is the default servings. One confirm button writes
 * exactly what was ticked; Skip (or closing the sheet) writes nothing.
 *
 * Nothing is saved until the user confirms. Items already in the pantry show as
 * "in your kitchen" and are never added a second time, so reopening this from
 * Profile does not duplicate lots.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PixelSheet from '@/components/ui/PixelSheet'
import BubblesMascot from '@/components/ui/BubblesMascot'
import Chip from '@/components/ui/Chip'
import SpringButton from '@/components/ui/SpringButton'
import { useTour } from './TourProvider'
import { bulkAddPantryItems, fetchPantryItems } from '@/lib/api/pantry'
import { fetchHouseholdSize, saveHouseholdSize } from '@/lib/api/profile'
import { HOUSEHOLD_SIZES, householdSizeLabel } from '@/lib/household'
import { STAPLE_GROUPS, stapleKey, staplesToBulkItems } from '@/lib/staples'

const ADD_ERROR = "Couldn't add your staples. Nothing was added, so try again in a moment."
const HOUSEHOLD_ERROR = "Couldn't save your household size. Nothing was added, so try again."

function householdAria(n: number): string {
  if (n === 1) return '1 person'
  return n >= 6 ? '6 or more people' : `${n} people`
}

/** Mounts the sheet while it is open, so each opening starts from a clean slate. */
export default function StaplesStep() {
  const { staplesOpen } = useTour()
  return staplesOpen ? <StaplesSheet /> : null
}

function StaplesSheet() {
  const { closeStaples } = useTour()
  const queryClient = useQueryClient()
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const [household, setHousehold] = useState<number | null>(null)
  // Whether the user has touched the picker: a late-arriving saved value must
  // not overwrite a choice made while it loaded.
  const [householdTouched, setHouseholdTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pantry = useQuery({ queryKey: ['pantry', 'staples-check'], queryFn: fetchPantryItems })

  useEffect(() => {
    let cancelled = false
    void fetchHouseholdSize().then((saved) => {
      if (!cancelled && saved !== null) {
        setHousehold((current) => (current === null ? saved : current))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const inKitchen = useMemo(() => {
    const names = new Set<string>()
    for (const item of pantry.data ?? []) {
      if (item.quantity > 0) names.add(stapleKey(item.name))
    }
    return names
  }, [pantry.data])

  // Ticked staples that are not already stocked: what "Add N" really adds.
  const toAdd = useMemo(() => {
    const names = new Set<string>()
    for (const key of ticked) if (!inKitchen.has(key)) names.add(key)
    return names
  }, [ticked, inKitchen])
  const count = toAdd.size

  function toggle(name: string) {
    const key = stapleKey(name)
    setError(null)
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function pickHousehold(n: number) {
    setError(null)
    setHouseholdTouched(true)
    setHousehold(n)
  }

  function skip() {
    if (!submitting) closeStaples()
  }

  async function confirm() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      // Household first: it is idempotent, so a failed add can be retried without
      // writing it twice, and a failure here leaves the pantry untouched.
      if (householdTouched && household !== null) {
        try {
          await saveHouseholdSize(household)
        } catch {
          setError(HOUSEHOLD_ERROR)
          return
        }
        // The chat starter pills read it as the default servings.
        void queryClient.invalidateQueries({ queryKey: ['pantry', 'starter-context'] })
      }
      if (count > 0) {
        try {
          await bulkAddPantryItems(staplesToBulkItems(toAdd))
        } catch {
          setError(ADD_ERROR)
          return
        }
        void queryClient.invalidateQueries({ queryKey: ['pantry'] })
      }
      closeStaples()
    } finally {
      setSubmitting(false)
    }
  }

  const canConfirm = count > 0 || (householdTouched && household !== null)
  const label = submitting
    ? 'Adding…'
    : count > 0
      ? `Add ${count}`
      : canConfirm
        ? 'Save'
        : 'Pick a few to add'

  return (
    <PixelSheet
      open
      onClose={skip}
      closeDisabled={submitting}
      title="Tick what you usually have"
      subtitle="So Bubbles can plan from day one. Skip any time."
      icon={<BubblesMascot state="happy" size={36} animate={false} />}
      testId="staples-step"
      footer={
        <div className="flex flex-col gap-1.5">
          {error && (
            <p
              role="alert"
              className="rounded-xl border-2 border-[color:var(--color-expired-text)] bg-[var(--color-expired)] px-3 py-2 text-[13px] font-bold text-[color:var(--color-expired-text)]"
            >
              {error}
            </p>
          )}
          <SpringButton
            fullWidth
            loading={submitting}
            disabled={!canConfirm}
            onClick={() => void confirm()}
            data-testid="staples-confirm"
          >
            {label}
          </SpringButton>
          <button
            type="button"
            onClick={skip}
            disabled={submitting}
            className="min-h-[44px] self-center rounded-full px-3 text-sm font-extrabold text-[color:var(--color-text)] underline disabled:opacity-60"
          >
            Skip for now
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section aria-labelledby="staples-household-label">
          <h3
            id="staples-household-label"
            className="mb-2 text-sm font-extrabold text-[color:var(--color-text)]"
          >
            How many do you cook for?
          </h3>
          <div role="group" aria-labelledby="staples-household-label" className="flex flex-wrap gap-2">
            {HOUSEHOLD_SIZES.map((n) => (
              <Chip
                key={n}
                selected={household === n}
                pressed={household === n}
                ariaLabel={householdAria(n)}
                onClick={() => pickHousehold(n)}
              >
                {householdSizeLabel(n)}
              </Chip>
            ))}
          </div>
        </section>

        {STAPLE_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`staples-${group.id}`}>
            <h3
              id={`staples-${group.id}`}
              className="mb-2 text-sm font-extrabold text-[color:var(--color-text)]"
            >
              {group.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              {group.items.map((staple) => {
                const key = stapleKey(staple.name)
                if (inKitchen.has(key)) {
                  return (
                    <Chip
                      key={staple.name}
                      emoji={staple.emoji}
                      ariaLabel={`${staple.name}, already in your kitchen`}
                      title="Already in your kitchen"
                    >
                      {staple.name}
                    </Chip>
                  )
                }
                const on = ticked.has(key)
                return (
                  <Chip
                    key={staple.name}
                    emoji={staple.emoji}
                    selected={on}
                    pressed={on}
                    onClick={() => toggle(staple.name)}
                  >
                    {staple.name}
                  </Chip>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </PixelSheet>
  )
}
