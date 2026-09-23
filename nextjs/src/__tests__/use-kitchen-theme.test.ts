/**
 * Tests for `useKitchenTheme` (issue #523; added per the post-merge review
 * on PR #594, finding 3 — this hook shipped with no tests at all).
 *
 * Covers findings 1, 2 and 4 from that review: a threshold crossed
 * mid-session fires the unlock card, the newest unseen theme is announced
 * (not the oldest), a stored-but-locked theme falls back to pastel, the
 * card never repeats once dismissed, and a failed persistence write reverts
 * the selection and surfaces an error instead of showing a false checkmark.
 */
import { renderHook, act } from '@testing-library/react'
import { useKitchenTheme } from '@/hooks/useKitchenTheme'
import { hasSeenThemeUnlock } from '@/lib/kitchen/theme-unlock-seen'

const updateUser = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { updateUser },
  }),
}))

describe('useKitchenTheme', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    updateUser.mockResolvedValue({ data: {}, error: null })
  })

  describe('theme resolution', () => {
    it('trusts the stored key immediately while balance is unknown (no flash)', () => {
      const { result } = renderHook(() => useKitchenTheme('night_kitchen', null))
      expect(result.current.theme.key).toBe('night_kitchen')
    })

    it('falls back to pastel once balance resolves and the stored theme is actually locked', () => {
      const { result, rerender } = renderHook(
        ({ balance }) => useKitchenTheme('night_kitchen', balance),
        { initialProps: { balance: null as number | null } },
      )
      expect(result.current.theme.key).toBe('night_kitchen')

      rerender({ balance: 0 })
      expect(result.current.theme.key).toBe('pastel')
    })

    it('falls back to pastel for an unknown stored key', () => {
      const { result } = renderHook(() => useKitchenTheme('not_a_real_theme', 100000))
      expect(result.current.theme.key).toBe('pastel')
    })
  })

  describe('unlock moment (review findings 1)', () => {
    it('fires when a threshold is crossed mid-session, not only on the first known balance', () => {
      const { result, rerender } = renderHook(
        ({ balance }) => useKitchenTheme(null, balance),
        { initialProps: { balance: 0 as number | null } },
      )
      expect(result.current.newlyUnlocked).toBeNull()

      // Balance crosses the cozy_cottage threshold (500) mid-session.
      rerender({ balance: 500 })
      expect(result.current.newlyUnlocked?.key).toBe('cozy_cottage')
    })

    it('announces the newest unseen unlocked theme, not the oldest', () => {
      const { result } = renderHook(() => useKitchenTheme(null, 1400))
      expect(result.current.newlyUnlocked?.key).toBe('seasonal')
    })

    it('never repeats an announcement for a theme already dismissed', () => {
      const { result, rerender } = renderHook(
        ({ balance }) => useKitchenTheme(null, balance),
        { initialProps: { balance: 500 as number | null } },
      )
      expect(result.current.newlyUnlocked?.key).toBe('cozy_cottage')

      act(() => {
        result.current.dismissUnlock()
      })
      expect(result.current.newlyUnlocked).toBeNull()
      expect(hasSeenThemeUnlock('cozy_cottage')).toBe(true)

      // Re-render with the same balance again (e.g. a React Query refetch
      // that resolves to the same number) must not resurrect the card.
      rerender({ balance: 500 })
      expect(result.current.newlyUnlocked).toBeNull()
    })

    it('does not announce a theme already marked seen on a prior visit', () => {
      // Simulates a returning browser that already saw this theme's toast.
      localStorage.setItem('bubbly-kitchen-themes-seen', JSON.stringify(['cozy_cottage']))
      const { result } = renderHook(() => useKitchenTheme(null, 500))
      expect(result.current.newlyUnlocked).toBeNull()
    })
  })

  describe('persistence (review finding 4)', () => {
    it('selects a theme optimistically and calls updateUser', async () => {
      const { result } = renderHook(() => useKitchenTheme(null, 500))

      await act(async () => {
        result.current.selectTheme('cozy_cottage')
      })

      expect(result.current.theme.key).toBe('cozy_cottage')
      expect(updateUser).toHaveBeenCalledWith({ data: { kitchen_theme: 'cozy_cottage' } })
      expect(result.current.error).toBeNull()
    })

    it('reverts the selection and surfaces an error when the write fails', async () => {
      updateUser.mockResolvedValueOnce({ data: null, error: new Error('network down') })
      const { result } = renderHook(() => useKitchenTheme(null, 500))

      await act(async () => {
        result.current.selectTheme('cozy_cottage')
      })

      // Reverted to the default (no prior selection) rather than staying on
      // the failed pick — a failed write must never leave a false checkmark.
      expect(result.current.theme.key).toBe('pastel')
      expect(result.current.error).not.toBeNull()
    })

    it('ignores a select for a theme that is not currently unlocked', async () => {
      const { result } = renderHook(() => useKitchenTheme(null, 0))

      await act(async () => {
        result.current.selectTheme('night_kitchen')
      })

      expect(result.current.theme.key).toBe('pastel')
      expect(updateUser).not.toHaveBeenCalled()
    })
  })
})
