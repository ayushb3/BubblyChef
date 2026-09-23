/**
 * Tests for the theme-unlock "seen" localStorage helper (issue #523).
 */
import { hasSeenThemeUnlock, markThemeUnlockSeen } from '@/lib/kitchen/theme-unlock-seen'

describe('theme-unlock-seen', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is unseen by default', () => {
    expect(hasSeenThemeUnlock('night_kitchen')).toBe(false)
  })

  it('marks a theme as seen', () => {
    markThemeUnlockSeen('night_kitchen')
    expect(hasSeenThemeUnlock('night_kitchen')).toBe(true)
  })

  it('tracks multiple themes independently', () => {
    markThemeUnlockSeen('night_kitchen')
    expect(hasSeenThemeUnlock('cozy_cottage')).toBe(false)
    markThemeUnlockSeen('cozy_cottage')
    expect(hasSeenThemeUnlock('cozy_cottage')).toBe(true)
    expect(hasSeenThemeUnlock('night_kitchen')).toBe(true)
  })

  it('marking the same theme twice does not throw or duplicate', () => {
    markThemeUnlockSeen('night_kitchen')
    expect(() => markThemeUnlockSeen('night_kitchen')).not.toThrow()
    expect(hasSeenThemeUnlock('night_kitchen')).toBe(true)
  })

  it('survives a corrupt localStorage value without throwing', () => {
    localStorage.setItem('bubbly-kitchen-themes-seen', '{not valid json')
    expect(() => hasSeenThemeUnlock('night_kitchen')).not.toThrow()
    expect(hasSeenThemeUnlock('night_kitchen')).toBe(false)
    expect(() => markThemeUnlockSeen('night_kitchen')).not.toThrow()
  })
})
