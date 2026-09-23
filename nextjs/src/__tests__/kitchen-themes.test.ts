/**
 * Tests for the kitchen theme config/helpers (issue #523).
 */
import {
  KITCHEN_THEMES,
  DEFAULT_KITCHEN_THEME_KEY,
  getDefaultKitchenTheme,
  unlockedThemes,
  isThemeUnlocked,
  resolveKitchenTheme,
} from '@/lib/kitchen/themes'

describe('KITCHEN_THEMES', () => {
  it('includes exactly the four art-pack keys', () => {
    expect(KITCHEN_THEMES.map((t) => t.key).sort()).toEqual(
      ['cozy_cottage', 'night_kitchen', 'pastel', 'seasonal'].sort(),
    )
  })

  it('has unique keys', () => {
    const keys = KITCHEN_THEMES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is ascending by threshold', () => {
    const thresholds = KITCHEN_THEMES.map((t) => t.threshold)
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b))
  })

  it('pastel is the only threshold-0 (always unlocked) theme', () => {
    const zeroThreshold = KITCHEN_THEMES.filter((t) => t.threshold === 0)
    expect(zeroThreshold.map((t) => t.key)).toEqual(['pastel'])
  })
})

describe('getDefaultKitchenTheme', () => {
  it('returns the pastel entry', () => {
    expect(getDefaultKitchenTheme().key).toBe(DEFAULT_KITCHEN_THEME_KEY)
    expect(getDefaultKitchenTheme().key).toBe('pastel')
  })
})

describe('unlockedThemes', () => {
  it('returns only pastel below the first real threshold', () => {
    expect(unlockedThemes(0).map((t) => t.key)).toEqual(['pastel'])
    expect(unlockedThemes(499).map((t) => t.key)).toEqual(['pastel'])
  })

  it('adds cozy_cottage at its threshold', () => {
    expect(unlockedThemes(500).map((t) => t.key)).toEqual(['pastel', 'cozy_cottage'])
  })

  it('unlocks everything at or above the highest threshold', () => {
    const highest = KITCHEN_THEMES[KITCHEN_THEMES.length - 1].threshold
    expect(unlockedThemes(highest).map((t) => t.key)).toEqual(
      KITCHEN_THEMES.map((t) => t.key),
    )
  })
})

describe('isThemeUnlocked', () => {
  it('is true for pastel at any balance', () => {
    expect(isThemeUnlocked('pastel', 0)).toBe(true)
    expect(isThemeUnlocked('pastel', 10000)).toBe(true)
  })

  it('is false for a real theme below its threshold', () => {
    expect(isThemeUnlocked('night_kitchen', 0)).toBe(false)
  })

  it('is true for a real theme at or above its threshold', () => {
    const nightKitchen = KITCHEN_THEMES.find((t) => t.key === 'night_kitchen')!
    expect(isThemeUnlocked('night_kitchen', nightKitchen.threshold)).toBe(true)
  })

  it('is false for an unknown key', () => {
    expect(isThemeUnlocked('not_a_real_theme', 100000)).toBe(false)
  })
})

describe('resolveKitchenTheme', () => {
  it('falls back to pastel for a null/undefined stored key', () => {
    expect(resolveKitchenTheme(null, 0).key).toBe('pastel')
    expect(resolveKitchenTheme(undefined, 100000).key).toBe('pastel')
  })

  it('falls back to pastel for an unknown stored key', () => {
    expect(resolveKitchenTheme('not_a_real_theme', 100000).key).toBe('pastel')
  })

  it('falls back to pastel for a real theme not yet unlocked at this balance', () => {
    expect(resolveKitchenTheme('night_kitchen', 0).key).toBe('pastel')
  })

  it('returns the stored theme once it is unlocked', () => {
    const nightKitchen = KITCHEN_THEMES.find((t) => t.key === 'night_kitchen')!
    expect(resolveKitchenTheme('night_kitchen', nightKitchen.threshold).key).toBe(
      'night_kitchen',
    )
  })

  it('never throws for a malformed stored key', () => {
    expect(() => resolveKitchenTheme('', 100000)).not.toThrow()
    expect(resolveKitchenTheme('', 100000).key).toBe('pastel')
  })
})
