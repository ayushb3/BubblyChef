'use client'

/**
 * Selected kitchen theme + unlock-toast state (issue #523; revised per the
 * post-merge review on PR #594 — see findings 1/2/4 there).
 *
 * The *selected* theme is stored in Supabase auth `user_metadata.kitchen_theme`
 * via `supabase.auth.updateUser({ data: { kitchen_theme } })` — same
 * convention as the editable display name (`DisplayNameField`'s
 * `user_metadata.username`), and it works for guests, who have no
 * `user_profiles` row. `initialThemeKey` comes from the server component
 * that already reads `user_metadata` for the display name (`app/page.tsx`).
 *
 * No flash of the wrong theme (review finding 2): `resolveKitchenThemeOptimistic`
 * (`lib/kitchen/themes.ts`) trusts the stored key immediately, before the
 * balance is known, rather than defaulting to a `0` balance that would falsely
 * lock every non-default theme for a beat. See that function's docstring for
 * why trusting it is safe — a stored key was only ever written once already
 * unlocked, and the balance it was validated against never decreases.
 *
 * Which themes are *unlocked* is derived from the balance, not stored
 * (`unlockedThemes` in `lib/kitchen/themes.ts`) — once the balance is known,
 * the resolved theme is re-validated against it (belt-and-braces against a
 * stale key from a future catalog change), so a locked/unknown stored key
 * still can never render past that point.
 */
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  resolveKitchenThemeOptimistic,
  unlockedThemes,
  type KitchenTheme,
} from '@/lib/kitchen/themes'
import { hasSeenThemeUnlock, markThemeUnlockSeen } from '@/lib/kitchen/theme-unlock-seen'

export interface UseKitchenThemeResult {
  /** The theme to actually render — always a real theme. */
  theme: KitchenTheme
  /** Every theme unlocked at the current balance, ascending by threshold. */
  unlocked: KitchenTheme[]
  /** True while a `selectTheme` call is in flight. */
  saving: boolean
  /** Persist a newly-picked theme. No-ops (and doesn't throw) if `key` isn't currently unlocked. */
  selectTheme: (key: string) => void
  /**
   * A theme that just became unlocked and hasn't been shown to this browser
   * yet — render the "New kitchen theme unlocked" card while this is
   * non-null. Always the *newest* (highest-threshold) unseen unlocked theme,
   * not the oldest. `null` once dismissed or once there's nothing new to show.
   */
  newlyUnlocked: KitchenTheme | null
  /** Dismisses `newlyUnlocked` and records it as seen so it won't reappear. */
  dismissUnlock: () => void
  /**
   * Set when the last `selectTheme` call's persistence failed — the
   * selection was reverted, and this should be surfaced inline (picker
   * sheet). `null` once a selection succeeds or another is attempted.
   */
  error: string | null
}

/**
 * @param initialThemeKey `user_metadata.kitchen_theme` as read server-side, or
 *   `undefined`/`null` if never set.
 * @param balance Lifetime bubbles balance (#520), or `null` while unknown.
 */
export function useKitchenTheme(
  initialThemeKey: string | null | undefined,
  balance: number | null,
): UseKitchenThemeResult {
  const [selectedKey, setSelectedKey] = useState<string | null | undefined>(initialThemeKey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newlyUnlocked, setNewlyUnlocked] = useState<KitchenTheme | null>(null)

  // `resolveKitchenThemeOptimistic` trusts `selectedKey` while `balance` is
  // still `null` (review finding 2) rather than resolving against an assumed
  // `0`. `unlocked` (for the picker's lock state) still treats an unknown
  // balance as "only pastel" — that list is about what's *selectable*, not
  // what's already rendering, so it has no flash to avoid.
  const theme = resolveKitchenThemeOptimistic(selectedKey, balance)
  const unlocked = unlockedThemes(balance ?? 0)

  // Fire the unlock card whenever the balance changes and names an unlocked,
  // non-default theme this browser hasn't been shown yet — recomputed fresh
  // from `balance` every time it changes (review finding 1: the old
  // `checkedRef` latch only ever ran once, on the first non-null balance, so
  // a threshold crossed mid-session — a React Query refetch pushing the
  // balance past 500 — never surfaced anything). Among unseen unlocked
  // themes this always picks the *newest* (highest threshold), not the
  // first found, so a user who is already far past several thresholds is
  // told about the one they just reached rather than their oldest.
  const previousBalanceRef = useRef<number | null>(null)
  useEffect(() => {
    if (balance === null) return
    if (previousBalanceRef.current === balance) return
    previousBalanceRef.current = balance
    const candidates = unlockedThemes(balance).filter(
      (t) => t.threshold > 0 && !hasSeenThemeUnlock(t.key),
    )
    if (candidates.length === 0) return
    const newest = candidates.reduce((a, b) => (b.threshold > a.threshold ? b : a))
    // Reading localStorage (via hasSeenThemeUnlock above) is an external,
    // impure source that can't be reproduced during render — this can't be
    // hoisted out of the effect the way a plain derived value would be,
    // same justification as ThemeProvider's own localStorage-driven setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewlyUnlocked((current) => (current?.key === newest.key ? current : newest))
  }, [balance])

  const selectTheme = (key: string) => {
    if (!unlocked.some((t) => t.key === key)) return
    const previousKey = selectedKey
    setSelectedKey(key)
    setSaving(true)
    setError(null)
    const supabase = createClient()
    supabase.auth
      .updateUser({ data: { kitchen_theme: key } })
      .then(({ error: updateError }) => {
        if (updateError) throw updateError
      })
      .catch(() => {
        // Persistence failed — revert to what was actually saved rather
        // than leaving the picker showing a selection that will silently
        // disappear on the next reload (review finding 4).
        setSelectedKey(previousKey)
        setError('Could not save your theme — try again')
      })
      .finally(() => setSaving(false))
  }

  const dismissUnlock = () => {
    if (newlyUnlocked) markThemeUnlockSeen(newlyUnlocked.key)
    setNewlyUnlocked(null)
  }

  return { theme, unlocked, saving, selectTheme, newlyUnlocked, dismissUnlock, error }
}
