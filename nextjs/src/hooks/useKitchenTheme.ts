'use client'

/**
 * Selected kitchen theme + unlock-toast state (issue #523).
 *
 * The *selected* theme is stored in Supabase auth `user_metadata.kitchen_theme`
 * via `supabase.auth.updateUser({ data: { kitchen_theme } })` — same
 * convention as the editable display name (`DisplayNameField`'s
 * `user_metadata.username`), and it works for guests, who have no
 * `user_profiles` row. `initialThemeKey` comes from the server component
 * that already reads `user_metadata` for the display name (`app/page.tsx`),
 * so there's no extra round trip and no flash of the wrong theme on load.
 *
 * Which themes are *unlocked* is derived from the balance, not stored
 * (`unlockedThemes`/`resolveKitchenTheme` in `lib/kitchen/themes.ts`) — this
 * hook just resolves the current theme against the current balance every
 * render, so a stale/locked stored key always falls back to `pastel`
 * (acceptance criterion in #523) without needing its own guard here.
 */
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  resolveKitchenTheme,
  unlockedThemes,
  type KitchenTheme,
} from '@/lib/kitchen/themes'
import { hasSeenThemeUnlock, markThemeUnlockSeen } from '@/lib/kitchen/theme-unlock-seen'

export interface UseKitchenThemeResult {
  /** The theme to actually render — always a real, currently-unlocked theme. */
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
   * non-null. `null` once dismissed or once there's nothing new to show.
   */
  newlyUnlocked: KitchenTheme | null
  /** Dismisses `newlyUnlocked` and records it as seen so it won't reappear. */
  dismissUnlock: () => void
}

/**
 * @param initialThemeKey `user_metadata.kitchen_theme` as read server-side, or
 *   `undefined`/`null` if never set.
 * @param balance Lifetime bubbles balance (#520), or `null` while unknown —
 *   treated as `0` (only `pastel` unlocked) until it resolves.
 */
export function useKitchenTheme(
  initialThemeKey: string | null | undefined,
  balance: number | null,
): UseKitchenThemeResult {
  const [selectedKey, setSelectedKey] = useState<string | null | undefined>(initialThemeKey)
  const [saving, setSaving] = useState(false)
  const [newlyUnlocked, setNewlyUnlocked] = useState<KitchenTheme | null>(null)

  const resolvedBalance = balance ?? 0
  const unlocked = unlockedThemes(resolvedBalance)
  const theme = resolveKitchenTheme(selectedKey, resolvedBalance)

  // Fire the one-time unlock toast: once the balance is known, check every
  // unlocked non-default theme against the "seen" list and surface the
  // first one this browser hasn't been shown yet. Only runs once balance
  // moves off `null` (loading) — never floods on every render.
  const checkedRef = useRef(false)
  useEffect(() => {
    if (balance === null || checkedRef.current) return
    checkedRef.current = true
    const candidate = unlocked.find((t) => t.threshold > 0 && !hasSeenThemeUnlock(t.key))
    if (candidate) setNewlyUnlocked(candidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance])

  const selectTheme = (key: string) => {
    if (!unlocked.some((t) => t.key === key)) return
    setSelectedKey(key)
    setSaving(true)
    const supabase = createClient()
    supabase.auth
      .updateUser({ data: { kitchen_theme: key } })
      .catch(() => {
        // Best-effort persistence — the local pick still applies for this
        // session even if the write fails; it'll retry next selection.
      })
      .finally(() => setSaving(false))
  }

  const dismissUnlock = () => {
    if (newlyUnlocked) markThemeUnlockSeen(newlyUnlocked.key)
    setNewlyUnlocked(null)
  }

  return { theme, unlocked, saving, selectTheme, newlyUnlocked, dismissUnlock }
}
